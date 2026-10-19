// SnapTone match: how close a NAM capture gets to the song's guitar, so Tone Match can build a SnapTone from the
// closest one the user has. Everything here is plain data in, plain data out (it runs in capture-worker.ts).
//
// Excitation: seconds 50–70 of Valeton's test signal (nam_input_wav.wav, the file every SnapTone is rendered and fit
// with). That part is a guitar DI recording (single notes and chords from low E, peaks near 0 dBFS); it is the segment
// Valeton fits the SnapTone's final IR on, so a capture is heard on the same playing its SnapTone is measured with.
// It is deterministic and the same for every capture, which is all a ranking needs.
//
// What is compared is the capture as it would play: its render (NAM output, ×0.31 like the conversion) and, for a
// capture without a cab, that render through the cab IR designed for it (irdesign.ts: stem LTAS − render LTAS, the IR
// the SnapTone would get). The same features as the stem analysis are taken from it: the gain score (gain.ts) and the
// 1/3-octave LTAS (ltas.ts). Distance:
//
//   D = |gain score − stem gain score| / GAIN_STEP + spectral residual (dB) / SPECTRUM_STEP_DB
//
// The residual is the RMS difference of the two LTAS from RESIDUAL_LO_HZ to RESIDUAL_HI_HZ after both are levelled at
// their 200 Hz–4 kHz mean (as the IR design does). GAIN_STEP 0.1 is under half a gain class (0.25 wide), and 6 dB of
// residual counts the same: the gain dominates because an IR can reshape the spectrum but not the distortion. For a
// cab-less capture the IR already takes the spectrum most of the way, so its residual is what the IR can't fix (beyond
// ±15 dB, outside 80 Hz–8 kHz). Match score = 100·e^(−D/3).
import { SIGNAL_RATE } from "@shared/host/snaptone";
import { gearIncludesCab } from "@shared/tone3000";
import { convertSampleRate } from "@/snaptone/htkpa";
import { applyCabIr, parseNamModel, renderNam, type KernelSource } from "@/snaptone/pipeline";
import { estimateTone, type ToneEstimate } from "./analyse";
import { estimateGain, type GainEstimate } from "./gain";
import { IR_RATE, matchIr, type MatchedIr } from "./irdesign";
import { bandMean, ltas, type Ltas } from "./ltas";

/** The guitar DI part of Valeton's test signal, seconds */
export const EXCITATION_FROM_S = 50;
export const EXCITATION_TO_S = 70;
/** Gain-score difference worth one unit of distance */
export const GAIN_STEP = 0.1;
/** Spectral residual worth one unit of distance, dB */
export const SPECTRUM_STEP_DB = 6;
export const RESIDUAL_LO_HZ = 100;
export const RESIDUAL_HI_HZ = 6300;
const SCORE_SCALE = 3;

/** What the song's guitar stem says, from its analysis (analyse.ts). */
export interface StemTarget {
  ltas: Ltas;
  gainScore: number;
  tone: ToneEstimate;
}

/** How a capture's output compares with the stem. */
export interface RenderFit {
  /** The capture includes a cab: compared as it is, no IR designed */
  includesCab: boolean;
  /** Of the capture as it would play (through the matched IR when it has no cab) */
  gain: GainEstimate;
  tone: ToneEstimate;
  /** Capture gain score − stem gain score */
  gainDelta: number;
  /** RMS LTAS difference, dB (see the header) */
  residualDb: number;
  distance: number;
  /** 0..100, higher is closer */
  score: number;
  /** The cab IR designed for a cab-less capture; null when it includes a cab */
  ir: MatchedIr | null;
}

export interface CaptureFit extends RenderFit {
  arch: "A1" | "A2";
  /** The capture's sample rate */
  rate: number;
}

/** Seconds 50–70 of the test signal (channel 0 as readSignalWav returns it), at SIGNAL_RATE. */
export function excitationSegment(signal: Int16Array): Float32Array {
  const from = EXCITATION_FROM_S * SIGNAL_RATE;
  const to = EXCITATION_TO_S * SIGNAL_RATE;
  if (signal.length < to) throw new Error("This isn't Valeton's 70-second test signal.");
  return Float32Array.from(signal.subarray(from, to), (v) => v / 32768);
}

/** RMS of stem − capture over RESIDUAL_LO_HZ..RESIDUAL_HI_HZ, both levelled at their 200 Hz–4 kHz mean; dB. */
export function spectralResidualDb(stem: Ltas, capture: Ltas): number {
  const stemRef = bandMean(stem, 200, 4000);
  const capRef = bandMean(capture, 200, 4000);
  if (!Number.isFinite(stemRef) || !Number.isFinite(capRef)) throw new Error("There's not enough signal to compare the capture with the song.");
  let sum = 0;
  let count = 0;
  stem.centers.forEach((fc, i) => {
    const d = stem.db[i] - stemRef - (capture.db[i] - capRef);
    if (fc < RESIDUAL_LO_HZ || fc > RESIDUAL_HI_HZ || !Number.isFinite(d)) return;
    sum += d * d;
    count++;
  });
  return count ? Math.sqrt(sum / count) : NaN;
}

export const matchDistance = (gainDelta: number, residualDb: number) => Math.abs(gainDelta) / GAIN_STEP + residualDb / SPECTRUM_STEP_DB;
export const matchScore = (distance: number) => Math.round(100 * Math.exp(-distance / SCORE_SCALE));

/**
 * Compare a capture's render (mono, `rate`) with the stem: a cab-less capture goes through the cab IR designed from
 * stem vs render first (designed at IR_RATE, resampled to `rate`). Throws a user-facing Error when the render is silent.
 */
export function evaluateRender(render: Float32Array, rate: number, target: StemTarget, includesCab: boolean): RenderFit {
  const dry = ltas(render, rate);
  if (dry.activeFrames === 0) throw new Error("This capture puts out no sound for the test signal.");
  const ir = includesCab ? null : matchIr(target.ltas, dry);
  const played = ir ? applyCabIr(render, rate === IR_RATE ? ir.ir : convertSampleRate(ir.ir, IR_RATE, rate)) : render;
  const spectrum = ir ? ltas(played, rate) : dry;
  const gain = estimateGain(played, rate);
  const gainDelta = gain.score - target.gainScore;
  const residualDb = spectralResidualDb(target.ltas, spectrum);
  const distance = matchDistance(gainDelta, Number.isFinite(residualDb) ? residualDb : SPECTRUM_STEP_DB * 3);
  return { includesCab, gain, tone: estimateTone(spectrum), gainDelta, residualDb, distance, score: matchScore(distance), ir };
}

/** NAM metadata gear_type (e.g. "amp_cab"), read without parsing the whole file; null when absent. */
export function namGearType(namText: string): string | null {
  return /"gear_type"\s*:\s*"([^"]*)"/.exec(namText)?.[1] ?? null;
}

/** The capture's gear includes a cab, by its TONE3000 gear or its NAM metadata. */
export const captureIncludesCab = (gear: string | null, namText: string) => gearIncludesCab(gear) || gearIncludesCab(namGearType(namText));

/**
 * Render a capture on the excitation and compare it with the stem. `excitationAt(rate)` gives excitationSegment at
 * the capture's rate (the caller caches the resampling); `onProgress` gets 0..1 of the render.
 */
export async function evaluateCapture(
  namText: string,
  gear: string | null,
  excitationAt: (rate: number) => Float32Array,
  kernel: KernelSource,
  target: StemTarget,
  onProgress?: (fraction: number) => void,
): Promise<CaptureFit> {
  const model = parseNamModel(namText);
  const render = await renderNam(model, excitationAt(model.rate), kernel, onProgress);
  return { ...evaluateRender(render, model.rate, target, captureIncludesCab(gear, namText)), arch: model.arch, rate: model.rate };
}

/** A cache of the excitation at each capture rate, from the test signal's channel 0. */
export function excitationCache(signal: Int16Array): (rate: number) => Float32Array {
  const base = excitationSegment(signal);
  const byRate = new Map<number, Float32Array>([[SIGNAL_RATE, base]]);
  return (rate) => {
    let x = byRate.get(rate);
    if (!x) {
      x = convertSampleRate(base, SIGNAL_RATE, rate);
      byRate.set(rate, x);
    }
    return x;
  };
}
