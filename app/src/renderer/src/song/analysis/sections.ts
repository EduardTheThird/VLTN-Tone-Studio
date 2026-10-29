// Suggests a song's sections from its audio: named spans (Intro, Verse, Chorus …) that start and end on bar lines where the music allows.
// Everything here is pure. The worker (sections-worker.ts) measures each unit of the song, a bar or a short time frame, and hands the
// measurements here. The detector finds where the music changes (a self-similarity novelty curve), then names the spans by how they
// repeat, how loud they are and whether vocals are in them.

import { MAX_SECTIONS, type Section } from "../performance/sections";

/** What the detector knows about one unit of the song: a bar, or a time frame when the song has no beat grid. */
export interface SectionUnit {
  /** Song time of the unit's start, in seconds. */
  start: number;
  /** Song time of the unit's end, in seconds. */
  end: number;
  /** Pitch-class energy of the harmony over the unit, C to B. Need not be normalised. */
  chroma: readonly number[];
  /** RMS level of the mix over the unit, linear. */
  energy: number;
  /** Whether vocals are present in the unit. */
  vocals: boolean;
}

export interface DetectOptions {
  /** Boundaries prefer multiples of this many units from the start. Use 4 for bars, and 1 for time frames (no snapping). */
  snap: number;
  /** The shortest section, in units. A boundary closer than this to another boundary or to the song's ends is dropped. */
  minUnits: number;
  /** Half the width of the novelty kernel, in units. */
  halfKernel: number;
}

/** Bars: an 8-bar kernel, sections of at least 4 bars, and boundaries on 4-bar lines where the music allows. */
export const BAR_DETECT: DetectOptions = { snap: 4, minUnits: 4, halfKernel: 4 };
/** Time frames of 2 seconds (see `timeUnitSpans`): a 16-second kernel, sections of at least 8 seconds, and no snapping. */
export const TIME_DETECT: DetectOptions = { snap: 1, minUnits: 4, halfKernel: 8 };
/** The length of one time frame in the fallback, in seconds. */
export const TIME_FRAME_S = 2;

export interface DetectedSection {
  start: number;
  end: number;
  name: string;
}

/** A peak is a boundary only when it is at least this share of the strongest peak. Smaller bumps are changes inside a section. */
export const PEAK_SHARE = 0.3;
/** A boundary off a multiple of `snap` keeps this share of its strength, so an on-grid boundary of similar strength wins. */
const OFF_GRID_WEIGHT = 0.7;
/** Sections whose average features match at least this closely (cosine) are the same kind of section. */
export const SAME_KIND = 0.9;
/** Weight of the loudness in the feature vector, against the unit's chroma (which has length 1). */
const ENERGY_WEIGHT = 0.5;
/** Weight of the vocal flag in the feature vector. */
const VOCAL_WEIGHT = 0.5;
/** A section with no vocals is a solo when it is at least this many times as loud as the average section. */
const SOLO_ENERGY = 1.1;

/** A span of units, `from` inclusive and `to` exclusive. */
interface Span {
  from: number;
  to: number;
}

interface SpanInfo extends Span {
  vector: number[];
  energy: number;
  vocals: boolean;
  kind: number;
}

/** The unit spans cut at the given times. `cuts` are sorted, and the song starts at `start` and ends at `end`. */
export function spansBetween(cuts: readonly number[], start: number, end: number): Array<{ start: number; end: number }> {
  const edges = [start, ...cuts.filter((t) => t > start && t < end), end];
  return edges.slice(1).map((edge, i) => ({ start: edges[i], end: edge }));
}

/**
 * The bar lines of a song, as the unit spans of one bar each: a bar starts at every `beatsPerBar`th beat from the first downbeat. The
 * song starts at 0, so a pickup before the first downbeat is a unit of its own. Returns null when the grid has too few beats to bar.
 */
export function barUnitSpans(beats: readonly number[], downbeat: number, beatsPerBar: number, duration: number): Array<{ start: number; end: number }> | null {
  if (!(beatsPerBar >= 1) || beats.length < beatsPerBar) return null;
  const first = ((downbeat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  const lines: number[] = [];
  for (let i = first; i < beats.length; i += beatsPerBar) {
    if (beats[i] > 0 && beats[i] < duration) lines.push(beats[i]);
  }
  return spansBetween(lines, 0, duration);
}

/** Fixed frames of `TIME_FRAME_S` seconds, for a song with no beat grid. */
export function timeUnitSpans(duration: number): Array<{ start: number; end: number }> {
  const cuts: number[] = [];
  for (let t = TIME_FRAME_S; t < duration; t += TIME_FRAME_S) cuts.push(t);
  return spansBetween(cuts, 0, duration);
}

/** The cosine of the angle between two vectors, from -1 to 1. A zero vector matches nothing. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

/** The feature vector of one unit: its chroma at unit length, then its loudness relative to the loudest unit, then the vocal flag. */
function featureVector(unit: SectionUnit, peakEnergy: number): number[] {
  const norm = Math.hypot(...unit.chroma) || 1;
  const loud = peakEnergy > 0 ? unit.energy / peakEnergy : 0;
  return [...unit.chroma.map((value) => value / norm), ENERGY_WEIGHT * loud, unit.vocals ? VOCAL_WEIGHT : 0];
}

/**
 * The checkerboard novelty of each unit boundary: how much the music before the boundary differs from the music after it. A boundary
 * between two sections that each repeat their own material scores high; a boundary inside a section scores near zero. Entry `i` is the
 * boundary before unit `i`, and entry 0 is always 0.
 */
export function noveltyCurve(vectors: readonly number[][], halfKernel: number): number[] {
  const n = vectors.length;
  const novelty = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let a = -halfKernel; a < halfKernel; a++) {
      for (let b = -halfKernel; b < halfKernel; b++) {
        const p = i + a;
        const q = i + b;
        if (p < 0 || q < 0 || p >= n || q >= n) continue;
        // Same side of the boundary is positive, across it negative.
        const sign = (a < 0) === (b < 0) ? 1 : -1;
        sum += sign * cosine(vectors[p], vectors[q]);
        count++;
      }
    }
    novelty[i] = count ? sum / count : 0;
  }
  return novelty;
}

/**
 * The unit indices where a section starts (never 0 and never the end). A boundary is a local peak of the novelty curve that is at
 * least `PEAK_SHARE` of the strongest peak. Peaks are taken strongest first; one closer than `minUnits` to a kept boundary, or to either
 * end of the song, is dropped. Peaks on a multiple of `snap` are preferred. At most `MAX_SECTIONS − 1` boundaries are kept.
 */
export function pickBoundaries(novelty: readonly number[], options: DetectOptions): number[] {
  const n = novelty.length;
  const strongest = Math.max(0, ...novelty);
  const candidates: Array<{ at: number; score: number }> = [];
  for (let i = 1; i < n - 1; i++) {
    const peak = novelty[i] >= novelty[i - 1] && novelty[i] > novelty[i + 1];
    if (!peak || novelty[i] < PEAK_SHARE * strongest || novelty[i] <= 0) continue;
    if (i < options.minUnits || n - i < options.minUnits) continue;
    const onGrid = i % options.snap === 0;
    candidates.push({ at: i, score: onGrid ? novelty[i] : novelty[i] * OFF_GRID_WEIGHT });
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept: number[] = [];
  for (const { at } of candidates) {
    if (kept.length >= MAX_SECTIONS - 1) break;
    if (kept.every((other) => Math.abs(other - at) >= options.minUnits)) kept.push(at);
  }
  return kept.sort((a, b) => a - b);
}

/** Turns cut positions (unit indices) into the spans between them, covering all `count` units. */
function spansFromCuts(cuts: readonly number[], count: number): Span[] {
  const edges = [0, ...cuts, count];
  return edges.slice(1).map((to, i) => ({ from: edges[i], to }));
}

/** Averages the feature vectors of a span, and reads how loud it is, whether it has vocals, and how it compares to the rest. */
function summarise(span: Span, units: readonly SectionUnit[], vectors: readonly number[][]): Omit<SpanInfo, "kind"> {
  const width = span.to - span.from;
  const vector = new Array<number>(vectors[0].length).fill(0);
  let energy = 0;
  let vocalUnits = 0;
  for (let i = span.from; i < span.to; i++) {
    vectors[i].forEach((value, k) => (vector[k] += value / width));
    energy += units[i].energy / width;
    if (units[i].vocals) vocalUnits++;
  }
  return { ...span, vector, energy, vocals: vocalUnits * 2 > width };
}

/**
 * Groups the spans into kinds of section: a span joins the first kind whose first member it matches at `SAME_KIND`, and starts a new
 * kind otherwise. Sets each span's `kind` to its kind's index.
 */
function assignKinds(infos: Array<Omit<SpanInfo, "kind">>): SpanInfo[] {
  const heads: number[][] = [];
  return infos.map((info) => {
    const found = heads.findIndex((head) => cosine(head, info.vector) >= SAME_KIND);
    if (found >= 0) return { ...info, kind: found };
    heads.push(info.vector);
    return { ...info, kind: heads.length - 1 };
  });
}

/**
 * Names each span by its role. The first span is an Intro when it has no vocals and vocals come later; the last is an Outro in the
 * same way. Among vocal spans, the kind that repeats most (with loudness as the tie-break) is the Chorus, the next repeated kind is a
 * Verse, and any other vocal span is a Bridge when a Chorus exists, else a Verse. A span with no vocals and above-average loudness is a
 * Solo. Everything else is a Section. Names that occur more than once are numbered in song order: Verse 1, Verse 2.
 */
export function nameSections(infos: readonly SpanInfo[]): string[] {
  const repeats = new Map<number, { count: number; energy: number }>();
  for (const info of infos) {
    const seen = repeats.get(info.kind) ?? { count: 0, energy: 0 };
    repeats.set(info.kind, { count: seen.count + 1, energy: seen.energy + info.energy });
  }
  const repeated = [...repeats.entries()]
    .filter(([kind, stats]) => stats.count >= 2 && infos.some((info) => info.kind === kind && info.vocals))
    .sort(([, a], [, b]) => b.count - a.count || b.energy - a.energy)
    .map(([kind]) => kind);
  const chorus = repeated[0];
  const verse = repeated[1];
  const averageEnergy = infos.reduce((sum, info) => sum + info.energy, 0) / infos.length;
  const names = infos.map((info, i) => {
    if (i === 0 && !info.vocals && infos.slice(1).some((other) => other.vocals)) return "Intro";
    if (i === infos.length - 1 && !info.vocals && infos.slice(0, -1).some((other) => other.vocals)) return "Outro";
    if (info.vocals) {
      if (info.kind === chorus) return "Chorus";
      if (info.kind === verse) return "Verse";
      return chorus === undefined ? "Verse" : "Bridge";
    }
    if (info.energy > SOLO_ENERGY * averageEnergy) return "Solo";
    return "Section";
  });
  return numberRepeats(names);
}

/** Numbers each name that occurs more than once, in song order: Verse 1, Verse 2. A name that occurs once is left alone. */
function numberRepeats(names: readonly string[]): string[] {
  const total = new Map<string, number>();
  for (const name of names) total.set(name, (total.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((name) => {
    if ((total.get(name) ?? 0) < 2) return name;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return `${name} ${n}`;
  });
}

/**
 * Suggests the sections of a song from its units, in song order. Returns nothing for a song too short to hold two sections. The result
 * covers the whole song, from the first unit's start to the last unit's end, with no gaps.
 */
export function detectSections(units: readonly SectionUnit[], options: DetectOptions): DetectedSection[] {
  if (units.length < 2 * options.minUnits) return [];
  const peakEnergy = Math.max(...units.map((unit) => unit.energy));
  const vectors = units.map((unit) => featureVector(unit, peakEnergy));
  const cuts = pickBoundaries(noveltyCurve(vectors, options.halfKernel), options);
  const infos = assignKinds(spansFromCuts(cuts, units.length).map((span) => summarise(span, units, vectors)));
  const names = nameSections(infos);
  return infos.map((info, i) => ({ start: units[info.from].start, end: units[info.to - 1].end, name: names[i] }));
}

/**
 * The sections a song gets from a detection. Each one is a new section with its stored mode set to continue, marked as detected. `newId`
 * gives each section its id; the default is a fresh random id.
 */
export function sectionsFromDetected(detected: readonly DetectedSection[], newId: () => string = () => crypto.randomUUID()): Section[] {
  return detected.map((section) => ({ id: newId(), name: section.name, start: section.start, end: section.end, mode: "continue", source: "detected" }));
}

/**
 * What a finished detection does to a song's sections. A song with no sections takes the detected ones. A song that already has sections
 * keeps them, and this returns null: the performer replaces them from the section editor, where Undo is offered.
 */
export function sectionsToApply(current: readonly Section[], detected: readonly DetectedSection[] | undefined, newId?: () => string): Section[] | null {
  if (current.length || !detected?.length) return null;
  return sectionsFromDetected(detected, newId);
}

/**
 * How many of the `truth` boundaries have a `found` boundary within `tolerance` seconds. Each found boundary counts for at most one truth
 * boundary. Used to measure the detector on fixtures with known boundaries.
 */
export function boundaryHits(found: readonly number[], truth: readonly number[], tolerance: number): number {
  const free = [...found];
  let hits = 0;
  for (const t of truth) {
    const near = free.findIndex((f) => Math.abs(f - t) <= tolerance);
    if (near >= 0) {
      hits++;
      free.splice(near, 1);
    }
  }
  return hits;
}
