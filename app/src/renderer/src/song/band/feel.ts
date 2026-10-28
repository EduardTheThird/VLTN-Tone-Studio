// Follow my playing (spec 50, B1): the generated parts take their accents from one stem the band already plays. The stem's onset curve is
// read at each step of a section's bars, which gives the section an accent profile. Quiet beats are stops, and a loud beat after a stop
// is a hit. Pure: the band worker runs these on the follow stem, and nothing here touches audio output or the store.

import type { FollowSource, SectionPlan } from "./arrangement";
import type { BeatGrid, OnsetStrength } from "./beat-grid";
import { KICK, SNARE } from "./note";
import { findStyle } from "./styles";
import { BUSY_FROM, playsAt, type DrumGroove } from "./styles/types";
import { barBeats, barStarts, beatSpan, planIndexAt, stepAt } from "./timing";

/** A step takes the strongest onset within this many seconds of its time, since a strum lands a little before or after the grid. */
export const ACCENT_WINDOW_SECONDS = 0.025;
/** A profile step at or above this weight is a strong accent. */
export const STRONG_ACCENT = 0.7;
/** A bass step at or above this weight is part of the bass rhythm. */
export const BASS_ACCENT = 0.5;
/** Auto follows a song only when some section's accents repeat this well (0 to 1, the mean correlation of its bars). */
export const MIN_CONFIDENCE = 0.3;
/** Most extra kicks a bar may get from accents. */
export const MAX_PUSHES = 2;
/** Pushes are added from this complexity up. */
export const PUSH_FROM = BUSY_FROM;
/** A beat whose loudest onset is below this share of the song's median beat is silent: a stop. */
export const STOP_SHARE = 0.2;
/** A beat right after a stop is a hit when its loudest onset is at least this many times the median beat. */
export const HIT_SHARE = 1.5;
/** A strong accent on a step that no kick or snare plays costs this much of its weight in the groove score. */
export const UNCOVERED_PENALTY = 1;
/** The follow sources that are stems. "mix" is the song's own audio, the last resort. */
export const FOLLOW_STEMS = ["guitar", "piano", "other"] as const;
/** Auto takes the first of these that exists. */
const AUTO_ORDER: readonly string[] = [...FOLLOW_STEMS, "mix"];

/** One section's accents: a weight per step of its bar, the strongest being 1, and how well its bars repeat one another (0 to 1). */
export interface AccentProfile {
  weights: Float64Array;
  confidence: number;
}

/** What the follow stem says about the song, for the generators. */
export interface Feel {
  /** One profile per plan, in plan order. */
  profiles: AccentProfile[];
  /** Beat indices where the band stops. The generated parts are silent on them. */
  stops: ReadonlySet<number>;
  /** Beat indices where the band comes back after a stop. The generated parts take a hit there. */
  hits: ReadonlySet<number>;
}

const EPSILON = 1e-12;

/** The loudest onset in the frames within `window` seconds of `time`. Negative onsets count as silence. */
function peakNear(onset: ArrayLike<number>, frameRate: number, time: number): number {
  const centre = time * frameRate;
  const reach = ACCENT_WINDOW_SECONDS * frameRate;
  const from = Math.max(0, Math.ceil(centre - reach));
  const to = Math.min(onset.length - 1, Math.floor(centre + reach));
  let peak = 0;
  for (let frame = from; frame <= to; frame++) peak = Math.max(peak, onset[frame]);
  return peak;
}

/** The loudest onset in the frames whose time falls in [from, to). Negative onsets count as silence. */
function peakBetween(onset: ArrayLike<number>, frameRate: number, from: number, to: number): number {
  const first = Math.max(0, Math.ceil(from * frameRate));
  const last = Math.min(onset.length - 1, Math.ceil(to * frameRate) - 1);
  let peak = 0;
  for (let frame = first; frame <= last; frame++) peak = Math.max(peak, onset[frame]);
  return peak;
}

/** The Pearson correlation of two equal-length vectors. Zero when either is flat, so a flat pattern does not look consistent. */
function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  if (n === 0) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA <= EPSILON || varB <= EPSILON) return 0;
  return cov / Math.sqrt(varA * varB);
}

/** The sum scaled so its largest weight is 1. A silent profile stays all zeros. */
function normalise(sums: Float64Array): Float64Array {
  let max = 0;
  for (const value of sums) max = Math.max(max, value);
  return max > 0 ? sums.map((value) => value / max) : new Float64Array(sums.length);
}

/**
 * How well the bars repeat: the mean of each bar's positive correlation with the other bars' sum. The bar is left out of its own
 * comparison, since a bar in a sum of four would otherwise score about a half even when its pattern is noise. A section with one bar
 * has nothing to repeat, so its consistency is zero.
 */
function consistency(bars: readonly Float64Array[], sums: Float64Array): number {
  if (bars.length < 2) return 0;
  let total = 0;
  for (const bar of bars) {
    const others = sums.map((value, step) => value - bar[step]);
    total += Math.max(0, correlation(bar, others));
  }
  return total / bars.length;
}

/**
 * The accent profile of each plan: for every step of the plan's bar, the onset at that step's time, summed over the plan's bars and
 * normalised. A step's grid follows its plan's style, so a triplet section and a straight one each get their own step count.
 */
export function accentProfile(onset: ArrayLike<number>, frameRate: number, grid: BeatGrid, plans: readonly SectionPlan[]): AccentProfile[] {
  const beats = grid.beats;
  const perBar = barBeats(grid);
  const starts = barStarts(grid);
  const planOf = starts.map((start) => planIndexAt(plans, beats[start]));
  return plans.map((plan, index) => {
    const style = findStyle(plan.style);
    const steps = perBar * (style?.meter.stepsPerBeat ?? 4);
    const sums = new Float64Array(steps);
    const bars: Float64Array[] = [];
    if (style) {
      starts.forEach((start, k) => {
        if (planOf[k] !== index) return;
        const bar = new Float64Array(steps);
        for (let step = 0; step < steps; step++) {
          const point = stepAt(beats, style, start, step, steps, perBar, 0);
          if (point.beat < beats.length) bar[step] = peakNear(onset, frameRate, point.time);
          sums[step] += bar[step];
        }
        bars.push(bar);
      });
    }
    return { weights: normalise(sums), confidence: consistency(bars, sums) };
  });
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Stops and hits, as beat indices. A beat is quiet when its loudest onset is below STOP_SHARE of the song's median beat. Every quiet beat
 * is a stop (a beat of silence or more). A hit is a loud beat right after a stop, at HIT_SHARE of the median or more.
 */
export function stopsAndHits(onset: ArrayLike<number>, frameRate: number, grid: BeatGrid): { stops: number[]; hits: number[] } {
  const beats = grid.beats;
  const levels = beats.map((time, beat) => peakBetween(onset, frameRate, time, time + beatSpan(beats, beat)));
  const typical = median(levels);
  const quiet = (beat: number) => typical > 0 && levels[beat] < STOP_SHARE * typical;
  const stops: number[] = [];
  const hits: number[] = [];
  beats.forEach((_, beat) => {
    if (quiet(beat)) stops.push(beat);
    else if (beat > 0 && quiet(beat - 1) && levels[beat] >= HIT_SHARE * typical) hits.push(beat);
  });
  return { stops, hits };
}

/** The feel of a song from its follow stem, or null when auto finds no section with clear enough accents to follow. */
export function followFeel(onset: OnsetStrength, grid: BeatGrid, plans: readonly SectionPlan[], auto: boolean): { feel: Feel | null; confidence: number } {
  const profiles = accentProfile(onset.onset, onset.frameRate, grid, plans);
  const confidence = profiles.reduce((best, profile) => Math.max(best, profile.confidence), 0);
  if (auto && confidence < MIN_CONFIDENCE) return { feel: null, confidence };
  const { stops, hits } = stopsAndHits(onset.onset, onset.frameRate, grid);
  return { feel: { profiles, stops: new Set(stops), hits: new Set(hits) }, confidence };
}

/** True when a profile has any accent at all. A plan with no bars has none, and its parts are generated as before. */
export function isAccented(profile: AccentProfile | undefined): profile is AccentProfile {
  return profile !== undefined && profile.weights.some((weight) => weight > 0);
}

/** The steps of one bar that open a hit beat, on the bar's step grid. `start` is the bar's first beat. */
export function hitSteps(feel: Feel, start: number, perBar: number, steps: number): number[] {
  const out: number[] = [];
  for (let beat = 0; beat < perBar; beat++) {
    if (!feel.hits.has(start + beat)) continue;
    const step = (beat * steps) / perBar;
    if (Number.isInteger(step)) out.push(step);
  }
  return out;
}

/**
 * How well a groove fits the accents: the weight of the steps where its kick or snare plays, less the weight of each strong accent that
 * nothing covers. Only hits that play at this complexity count.
 */
function grooveScore(groove: DrumGroove, weights: ArrayLike<number>, complexity: number): number {
  const covered = new Set<number>();
  for (const hit of groove.hits) {
    if ((hit.pitch === KICK || hit.pitch === SNARE) && playsAt(hit, complexity)) covered.add(hit.step);
  }
  let score = 0;
  for (const step of covered) score += weights[step] ?? 0;
  for (let step = 0; step < weights.length; step++) {
    if (weights[step] >= STRONG_ACCENT && !covered.has(step)) score -= UNCOVERED_PENALTY * weights[step];
  }
  return score;
}

/** The indices of the grooves, best fit first. Ties keep the groove's own order. */
export function rankGrooves(grooves: readonly DrumGroove[], profile: ArrayLike<number>, complexity: number): number[] {
  const scores = grooves.map((groove) => grooveScore(groove, profile, complexity));
  return grooves.map((_, index) => index).sort((a, b) => scores[b] - scores[a] || a - b);
}

/** The index of the groove that best matches the accents. */
export function pickGrooveByAccents(grooves: readonly DrumGroove[], profile: ArrayLike<number>, complexity: number): number {
  return rankGrooves(grooves, profile, complexity)[0] ?? 0;
}

/**
 * Extra kick steps for a bar: strong off-beat accents where the groove has no kick, the strongest first, at most MAX_PUSHES. Only from
 * PUSH_FROM complexity up. Returns the steps in time order.
 */
export function accentPushes(profile: ArrayLike<number>, groove: DrumGroove, complexity: number, stepsPerBeat: number): number[] {
  if (complexity < PUSH_FROM) return [];
  const kicks = new Set<number>();
  for (const hit of groove.hits) if (hit.pitch === KICK && playsAt(hit, complexity)) kicks.add(hit.step);
  const candidates: number[] = [];
  for (let step = 0; step < profile.length; step++) {
    if (step % stepsPerBeat !== 0 && profile[step] >= STRONG_ACCENT && !kicks.has(step)) candidates.push(step);
  }
  candidates.sort((a, b) => profile[b] - profile[a] || a - b);
  return candidates.slice(0, MAX_PUSHES).sort((a, b) => a - b);
}

/** The steps of a bass bar that follow the accents: every step at BASS_ACCENT or more, and always step 0. In time order. */
export function bassRhythmFromAccents(profile: ArrayLike<number>, stepsPerBeat: number, beatsPerBar: number): number[] {
  const steps = beatsPerBar * stepsPerBeat;
  const out = [0];
  for (let step = 1; step < steps; step++) {
    if ((profile[step] ?? 0) >= BASS_ACCENT) out.push(step);
  }
  return out;
}

/** Turns the panel's choice into the stem to read. An explicit stem that is there is used; otherwise auto's order picks one. */
export function resolveFollowSource(choice: FollowSource, available: readonly string[]): string {
  if (choice !== "auto" && available.includes(choice)) return choice;
  return AUTO_ORDER.find((name) => available.includes(name)) ?? "mix";
}

const SOURCE_LABEL: Record<string, string> = { guitar: "guitar", piano: "piano", other: "other stem", mix: "mix" };

/** The panel's line after a render: what was followed, or why the song was not followed. */
export function followStatus(report: { source: string; following: boolean }): string {
  const label = SOURCE_LABEL[report.source] ?? report.source;
  if (report.following) return `Following the ${label} for its accents.`;
  return `Follow my playing: not enough clear rhythm in the ${label}`;
}
