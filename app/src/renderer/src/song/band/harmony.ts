// Harmony for the generated bass: which chord sounds on each beat of the song. The chart's chords are used when it has any timed chord,
// otherwise the chords detected from the audio. Each beat takes the chord that covers most of it, and a one-beat blip between two
// identical chords is folded into them. Everything here is pure; the chart and the beat grid come in as values.

import type { Cue } from "../performance/chart";
import type { Chord } from "../performance/chords";
import { chordPattern } from "../performance/reader";
import type { BeatGrid } from "./beat-grid";

/** A chord on a chart line that has no following timed line lasts this many seconds, per chord on the line. */
export const LAST_CHORD_SECONDS = 2;

export type ChordQuality = "major" | "minor" | "dim" | "aug" | "sus2" | "sus4" | "power";
export type ChordSeventh = "none" | "dom7" | "maj7" | "min7" | "dim7" | "half-dim";

export interface ParsedChord {
  /** Pitch class of the root, 0 (C) to 11 (B). */
  root: number;
  quality: ChordQuality;
  seventh: ChordSeventh;
  /** Pitch class of the bass note: the slash note for `D/F#`, otherwise the root. */
  bass: number;
  /** The chord name as written, such as `D/F#`. */
  name: string;
}

/** A chord name and the time it starts, from the chart or from detection. */
export interface ChordEvent {
  time: number;
  name: string;
}

export interface ChordAtBeat {
  /** Index into `grid.beats`. */
  beat: number;
  time: number;
  /** Null before the first chord, on `N`, and on a name that cannot be parsed. */
  chord: ParsedChord | null;
}

const NATURAL_PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** The common suffixes, as the chart and the chord detector write them. Other suffixes are derived by `deriveQuality` and `deriveSeventh`. */
const SUFFIXES = new Map<string, { quality: ChordQuality; seventh: ChordSeventh }>([
  ["", { quality: "major", seventh: "none" }],
  ["maj", { quality: "major", seventh: "none" }],
  ["m", { quality: "minor", seventh: "none" }],
  ["min", { quality: "minor", seventh: "none" }],
  ["-", { quality: "minor", seventh: "none" }],
  ["7", { quality: "major", seventh: "dom7" }],
  ["maj7", { quality: "major", seventh: "maj7" }],
  ["M7", { quality: "major", seventh: "maj7" }],
  ["m7", { quality: "minor", seventh: "min7" }],
  ["min7", { quality: "minor", seventh: "min7" }],
  ["-7", { quality: "minor", seventh: "min7" }],
  ["dim", { quality: "dim", seventh: "none" }],
  ["dim7", { quality: "dim", seventh: "dim7" }],
  ["m7b5", { quality: "dim", seventh: "half-dim" }],
  ["aug", { quality: "aug", seventh: "none" }],
  ["+", { quality: "aug", seventh: "none" }],
  ["sus2", { quality: "sus2", seventh: "none" }],
  ["sus4", { quality: "sus4", seventh: "none" }],
  ["sus", { quality: "sus4", seventh: "none" }],
  ["5", { quality: "power", seventh: "none" }],
]);

/** Root letter, optional sharp or flat, suffix, then an optional slash bass with its own optional accidental. */
const CHORD_NAME = /^([A-G])(#|b)?([^/]*)(?:\/([A-G])(#|b)?)?$/;

function pitchClass(letter: string, accidental: string | undefined): number {
  return ((((NATURAL_PITCH[letter] ?? 0) + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0)) % 12) + 12) % 12;
}

/**
 * The quality of a suffix that is not in the table. Alterations such as `#9` or `b13` do not change it. A sus anywhere wins, then
 * diminished and augmented, then minor, and anything else is major.
 */
function deriveQuality(suffix: string): ChordQuality {
  if (suffix.includes("sus2")) return "sus2";
  if (suffix.includes("sus")) return "sus4";
  if (/^(dim|°|ø)/.test(suffix)) return "dim";
  if (/^(aug|\+)/.test(suffix)) return "aug";
  if (/^(m|-)/.test(suffix) && !suffix.startsWith("maj")) return "minor";
  if (suffix === "5") return "power";
  return "major";
}

/**
 * The seventh of a suffix that is not in the table. Half-diminished and diminished sevenths come first, then a major seventh (`maj7`,
 * `M9`, `(maj7)`). Any other 7, 9, 11 or 13 is a dominant seventh, or a minor seventh on a minor chord. `add` tones and a bare 6 have none.
 */
function deriveSeventh(suffix: string, quality: ChordQuality): ChordSeventh {
  if (/m7b5|ø/.test(suffix)) return "half-dim";
  if (/dim7|°7/.test(suffix)) return "dim7";
  if (/(maj|M)(7|9|11|13)/.test(suffix)) return "maj7";
  if (/7|9|11|13/.test(suffix.replace(/add\d+/g, ""))) return quality === "minor" ? "min7" : "dom7";
  return "none";
}

/**
 * Parses a chord name such as `Am7`, `F#m`, `Bb7`, `D/F#`, `E5`, `C9` or `Dm(maj7)`. A suffix that is not in the table is derived from its
 * text. Returns null for `N`, for a name whose root (or slash bass) does not parse, and for anything else that is not a chord name.
 */
export function parseChordName(name: string): ParsedChord | null {
  const text = name.trim();
  if (text === "N") return null;
  const match = CHORD_NAME.exec(text);
  if (!match) return null;
  const known = SUFFIXES.get(match[3]);
  const quality = known?.quality ?? deriveQuality(match[3]);
  const seventh = known?.seventh ?? deriveSeventh(match[3], quality);
  const root = pitchClass(match[1], match[2]);
  const bass = match[4] ? pitchClass(match[4], match[5]) : root;
  return { root, quality, seventh, bass, name: text };
}

/**
 * The chord tokens of the chart's timed lines, each with a time. Several chords on a line are spread evenly from the line's time to the
 * next timed line's time. Triggers have no song time and are skipped. The last line lasts LAST_CHORD_SECONDS per chord.
 */
export function chartChordEvents(cues: readonly Cue[]): ChordEvent[] {
  const lines = cues.filter((cue) => !cue.trigger).sort((a, b) => a.time - b.time);
  return lines.flatMap((line) => {
    const names = [...line.text.matchAll(chordPattern)].map((match) => match[1]);
    if (!names.length) return [];
    const next = lines.find((other) => other.time > line.time);
    const end = next ? next.time : line.time + LAST_CHORD_SECONDS * names.length;
    return names.map((name, k) => ({ time: line.time + ((end - line.time) * k) / names.length, name }));
  });
}

/**
 * One entry per beat. Each beat takes the chord that covers most of the span from that beat to the next, and the last beat runs to
 * `songEnd`. A chord runs until the next event, and the last one runs to `songEnd`. A beat that no event covers takes the chord that
 * was already sounding at its start, so a beat with zero length at the end of the song still gets a chord.
 */
export function chordsPerBeat(grid: BeatGrid, events: readonly ChordEvent[], songEnd: number): ChordAtBeat[] {
  const timeline = [...events].sort((a, b) => a.time - b.time);
  return grid.beats.map((time, beat) => {
    const end = beat + 1 < grid.beats.length ? grid.beats[beat + 1] : songEnd;
    let chosen: string | undefined = undefined,
      bestOverlap = 0;
    for (let i = 0; i < timeline.length; i++) {
      const until = i + 1 < timeline.length ? timeline[i + 1].time : songEnd;
      const overlap = Math.min(end, until) - Math.max(time, timeline[i].time);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        chosen = timeline[i].name;
      }
    }
    if (chosen === undefined) chosen = timeline.findLast((event) => event.time <= time)?.name;
    return { beat, time, chord: chosen === undefined ? null : parseChordName(chosen) };
  });
}

/**
 * Folds a one-beat blip into its neighbours. A beat is changed only when it has a chord, both neighbours have the same chord, and that
 * chord differs from the beat's own. A blip at the start or the end of the song, or next to a rest, is kept.
 */
export function mergeShortChords(perBeat: readonly ChordAtBeat[]): ChordAtBeat[] {
  return perBeat.map((entry, i) => {
    if (i === 0 || i + 1 >= perBeat.length) return entry;
    const before = perBeat[i - 1].chord,
      after = perBeat[i + 1].chord;
    if (!entry.chord || !before || !after || before.name !== after.name || entry.chord.name === before.name) return entry;
    return { ...entry, chord: before };
  });
}

/**
 * The times of the beats where the chord changes, for `pickDownbeat`. A chord starting after a rest counts as a change. The first beat
 * never does, since there is nothing before it to change from.
 */
export function chordChangeTimes(perBeat: readonly ChordAtBeat[]): number[] {
  const times: number[] = [];
  perBeat.forEach((entry, i) => {
    if (i > 0 && entry.chord?.name !== perBeat[i - 1].chord?.name) times.push(entry.time);
  });
  return times;
}

/**
 * The chord on each beat of the song. The chart's chords are used when it has any timed chord, including `N`. Otherwise the detected
 * chords are used, ignoring their confidence. The result is snapped to the beats and short blips are merged.
 */
export function harmonyForSong(grid: BeatGrid, cues: readonly Cue[], detected: readonly Chord[], songEnd: number): ChordAtBeat[] {
  const fromChart = chartChordEvents(cues);
  const events = fromChart.length ? fromChart : detected.map(({ time, name }) => ({ time, name }));
  return mergeShortChords(chordsPerBeat(grid, events, songEnd));
}
