import { chromaFrames, type ChromaSpan } from "../analysis/chroma";
import { chordAt } from "../analysis/chord-templates";
import type { PcmAudio } from "../types";

export interface Chord {
  time: number;
  name: string;
  confidence: number;
}

/**
 * What the chord detector reads. `harmony` carries the chords (guitar, piano and the other stems, or the mix); `bass` is the bass stem
 * when it has a signal; `beats` are the beat times of the song's grid, when one is known, and the chords then change only on beats.
 */
export interface ChordsInput {
  harmony: PcmAudio;
  bass: PcmAudio | null;
  beats: number[] | null;
}

/** Without a beat grid, the chords are read on a fixed hop of this many seconds. */
export const HOP_SECONDS = 0.25;

/** A one-window blip between identical neighbours is usually leakage or an attack transient. */
export function smoothChordFrames(frames: Chord[]): Chord[] {
  const stable = frames.map((frame, i) =>
    i > 0 && i + 1 < frames.length && frame.name !== "N" && frames[i - 1].name === frames[i + 1].name && frames[i - 1].name !== "N"
      ? { ...frame, name: frames[i - 1].name, confidence: Math.min(frames[i - 1].confidence, frames[i + 1].confidence) }
      : frame,
  );
  return stable.filter((frame, i) => i === 0 || frame.name !== stable[i - 1].name);
}

/**
 * The spans the chords are read over: beat to beat when the song has a grid (with the time before the first beat as one span), else
 * `HOP_SECONDS` steps. Each span's start is the time its chord is given.
 */
export function chordFrameSpans(beats: readonly number[] | null, duration: number): ChromaSpan[] {
  if (beats && beats.length >= 2) {
    const spans: ChromaSpan[] = [];
    if (beats[0] > 0) spans.push({ start: 0, end: beats[0] });
    beats.forEach((start, i) => spans.push({ start, end: i + 1 < beats.length ? beats[i + 1] : duration }));
    return spans.filter((span) => span.end > span.start && span.start < duration);
  }
  const spans: ChromaSpan[] = [];
  for (let start = 0; start < duration; start += HOP_SECONDS) spans.push({ start, end: Math.min(duration, start + HOP_SECONDS) });
  return spans;
}

/** Estimates the chords of a song, one per span (see `chordFrameSpans`), from the harmony and, when there is one, the bass. */
export function detectChords(input: ChordsInput): Chord[] {
  const harmony = input.harmony;
  const length = harmony.channels[0]?.length ?? 0;
  const duration = length / harmony.sampleRate;
  const spans = chordFrameSpans(input.beats, duration);
  const { treble, bass } = chromaFrames(harmony, spans, input.bass);
  const frames = spans.map((span, i) => ({ time: span.start, ...chordAt(treble[i], bass ? bass[i] : null) }));
  return smoothChordFrames(frames);
}
