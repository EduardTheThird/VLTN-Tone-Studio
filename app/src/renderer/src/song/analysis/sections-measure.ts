// Measures each unit of a song for the section detector: its harmony (chroma), its loudness and whether it has vocals. The units are bars
// when the song has a beat grid, and time frames when it does not. This file does the signal work; the detector in sections.ts only sees
// the numbers. The worker (sections-worker.ts) runs it off the main thread.

import { fft, hann } from "../tonematch/fft";
import { monoSum } from "../band/beat-grid";
import type { PcmAudio } from "../types";
import { detectSections, type DetectedSection, type DetectOptions, type SectionUnit } from "./sections";

/** The vocals count as present in a unit when their level is above this, relative to the mix (−40 dB). */
export const VOCAL_DB = -40;
/** Length of the FFT the chroma is measured with. About 5 Hz a bin at 44.1 kHz, so semitones near the bottom of the range stay apart. */
const CHROMA_FFT = 8192;
/** The lowest and highest frequencies that count towards the chroma, in Hz. */
const CHROMA_LOW_HZ = 65;
const CHROMA_HIGH_HZ = 2000;

/** What the worker is given: the mix, the stem the harmony is read from, the vocals stem when there is one, and the units to measure. */
export interface SectionsInput {
  mix: PcmAudio;
  harmony: PcmAudio;
  vocals: PcmAudio | null;
  spans: ReadonlyArray<{ start: number; end: number }>;
  options: DetectOptions;
}

/** The mean power of the audio between two sample indices, over all its channels. Zero for an empty range. */
export function rmsOf(audio: PcmAudio, from: number, to: number): number {
  let sum = 0;
  let count = 0;
  for (const channel of audio.channels) {
    const end = Math.min(to, channel.length);
    for (let i = from; i < end; i++) sum += channel[i] * channel[i];
    count += Math.max(0, end - from);
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/**
 * The pitch-class energy of a mono signal between two sample indices, summed over FFT frames of `CHROMA_FFT` samples. Each bin in the
 * chroma band adds its magnitude to the pitch class it is nearest to. The result is not normalised: the detector compares directions.
 */
export function unitChroma(mono: ArrayLike<number>, sampleRate: number, from: number, to: number): number[] {
  const chroma = new Array<number>(12).fill(0);
  const window = hann(CHROMA_FFT);
  const re = new Float64Array(CHROMA_FFT);
  const im = new Float64Array(CHROMA_FFT);
  for (let at = from; at < to; at += CHROMA_FFT) {
    re.fill(0);
    im.fill(0);
    const length = Math.min(CHROMA_FFT, to - at);
    for (let i = 0; i < length; i++) re[i] = (mono[at + i] ?? 0) * window[i];
    fft(re, im);
    for (let k = 1; k < CHROMA_FFT / 2; k++) {
      const hz = (k * sampleRate) / CHROMA_FFT;
      if (hz < CHROMA_LOW_HZ || hz > CHROMA_HIGH_HZ) continue;
      const midi = Math.round(69 + 12 * Math.log2(hz / 440));
      chroma[((midi % 12) + 12) % 12] += Math.hypot(re[k], im[k]);
    }
  }
  return chroma;
}

/**
 * Measures every unit. Loudness is the mix's level over the unit. A unit has vocals when the vocals stem is above `VOCAL_DB` relative to
 * the mix. With no vocals stem, every unit counts as having vocals, so only the repeats and loudness name the sections.
 */
export function measureUnits(input: SectionsInput): SectionUnit[] {
  const { mix, vocals, spans } = input;
  const sampleRate = mix.sampleRate;
  const harmony = monoSum([input.harmony]);
  const floor = 10 ** (VOCAL_DB / 20);
  return spans.map(({ start, end }) => {
    const from = Math.floor(start * sampleRate);
    const to = Math.ceil(end * sampleRate);
    const level = rmsOf(mix, from, to);
    const hasVocals = vocals ? level > 0 && rmsOf(vocals, from, to) > level * floor : true;
    return { start, end, chroma: unitChroma(harmony, sampleRate, from, to), energy: level, vocals: hasVocals };
  });
}

/** Finds the sections of a song from its measured units. Pure, so the worker is only a thin shell around this. */
export function detectSongSections(input: SectionsInput): DetectedSection[] {
  return detectSections(measureUnits(input), input.options);
}
