// Tone distance between two guitar signals that are NOT the same performance (the song's stem vs a render of a
// candidate chain on a test signal), so frames can't be compared one to one. What is compared are statistics of the
// signal's texture, taken over the frames that pass the silence gate (ltas.ts):
//
//  - the mean level over frames per 1/3-octave band (the LTAS shape), smoothed over SMOOTH_BANDS bands (one octave:
//    the harmonics of the notes played would otherwise make two performances of the same tone differ by more than
//    two tones differ), after levelling both at their 200 Hz–4 kHz mean;
//  - the spread over frames (std, dB) of the level in three wide bands (COARSE_EDGES_HZ). Saturation compresses
//    the levels towards each other, so a saturated tone has a smaller spread than a clean one with the same LTAS;
//  - the distribution of frame levels (dB under the loud frames): how much the playing dynamics are kept;
//  - the gain score (gain.ts).
//
// Distance (each term in "steps" like capture-match.ts, 1 step ≈ a difference you can hear):
//   D = meanRms / MEAN_STEP_DB + spreadRms / SPREAD_STEP_DB + levelRms / LEVEL_STEP_DB + |Δgain| / GAIN_STEP
// It needs enough playing to average over (hundreds of notes: a whole song's stem, or Valeton's 20 s excitation);
// on a few dozen notes the difference between two performances is larger than between two tones.
// Levels are taken relative to each signal's own loud frames, so the overall volume never counts.
import { hann, powerSpectrum } from "./fft";
import { estimateGain } from "./gain";
import { BAND_CENTERS, bandEdges, bandMean, frameLevels, gateFrames, quantile } from "./ltas";

const FRAME = 2048;
export const TEXTURE_LO_HZ = 100;
export const TEXTURE_HI_HZ = 6300;
export const MEAN_STEP_DB = 6;
export const SPREAD_STEP_DB = 3;
export const LEVEL_STEP_DB = 3;
export const GAIN_STEP = 0.1;
/** Edges of the three wide bands whose spread over frames is compared */
export const COARSE_EDGES_HZ = [100, 400, 1600, 6300] as const;
/** The mean curve is averaged over this many neighbouring 1/3-octave bands (centred) */
export const SMOOTH_BANDS = 3;
const LEVEL_QUANTILES = [0.1, 0.25, 0.5, 0.75] as const;

export interface Texture {
  centers: readonly number[];
  /** Mean band level over active frames, dB (NaN where unavailable) */
  meanDb: Float64Array;
  /** Std over active frames of the level in each wide band (COARSE_EDGES_HZ), dB */
  spreadDb: Float64Array;
  /** Frame levels at LEVEL_QUANTILES, dB under the 95th percentile */
  levels: number[];
  gainScore: number;
  activeFrames: number;
}

/** Texture statistics of mono `x` at `sampleRate`. */
export function describeTexture(x: Float32Array, sampleRate: number): Texture {
  const hop = FRAME / 2;
  const levels = frameLevels(x, FRAME, hop);
  const gate = gateFrames(levels);
  const window = hann(FRAME);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const spec = new Float64Array(FRAME / 2 + 1);
  const binHz = sampleRate / FRAME;
  const bands = BAND_CENTERS.map((fc) => {
    const [lo, hi] = bandEdges(fc);
    const from = Math.max(1, Math.ceil(lo / binHz));
    const to = Math.min(FRAME / 2, Math.floor(hi / binHz));
    return fc >= TEXTURE_LO_HZ && fc <= TEXTURE_HI_HZ && hi < sampleRate / 2 && to >= from ? ([from, to] as const) : null;
  });
  const coarse = COARSE_EDGES_HZ.slice(1).map((hi, i) => [Math.max(1, Math.ceil(COARSE_EDGES_HZ[i] / binHz)), Math.min(FRAME / 2, Math.floor(hi / binHz))] as const);
  const sum = new Float64Array(bands.length);
  const cSum = new Float64Array(coarse.length);
  const cSumSq = new Float64Array(coarse.length);
  let active = 0;
  const kept: number[] = [];
  for (let f = 0; f < levels.length; f++) {
    if (!gate[f] || f * hop + FRAME > x.length) continue;
    powerSpectrum(x.subarray(f * hop, f * hop + FRAME), window, re, im, spec);
    bands.forEach((b, i) => {
      if (!b) return;
      let acc = 0;
      for (let k = b[0]; k <= b[1]; k++) acc += spec[k];
      const db = 10 * Math.log10(acc / (b[1] - b[0] + 1) + 1e-20);
      sum[i] += db;
    });
    coarse.forEach(([from, to], i) => {
      let acc = 0;
      for (let k = from; k <= to; k++) acc += spec[k];
      const db = 10 * Math.log10(acc / (to - from + 1) + 1e-20);
      cSum[i] += db;
      cSumSq[i] += db * db;
    });
    kept.push(levels[f]);
    active++;
  }
  const meanDb = Float64Array.from(bands, (b, i) => (b && active ? sum[i] / active : NaN));
  const spreadDb = Float64Array.from(coarse, (_, i) => (active ? Math.sqrt(Math.max(0, cSumSq[i] / active - (cSum[i] / active) ** 2)) : NaN));
  const top = kept.length ? quantile(kept, 0.95) : 0;
  return {
    centers: BAND_CENTERS,
    meanDb,
    spreadDb,
    levels: LEVEL_QUANTILES.map((q) => (kept.length ? quantile(kept, q) - top : 0)),
    gainScore: estimateGain(x, sampleRate).score,
    activeFrames: active,
  };
}

/** The mean-level curve smoothed over SMOOTH_BANDS bands and levelled at its 200 Hz–4 kHz mean. */
function levelled(t: Texture): Float64Array {
  const half = (SMOOTH_BANDS - 1) / 2;
  const smooth = Float64Array.from(t.meanDb, (v, i) => {
    if (!Number.isFinite(v)) return NaN;
    let acc = 0;
    let n = 0;
    for (let j = i - half; j <= i + half; j++) if (Number.isFinite(t.meanDb[j])) (acc += t.meanDb[j]), n++;
    return acc / n;
  });
  const ref = bandMean({ centers: t.centers, db: smooth }, 200, 4000);
  return Float64Array.from(smooth, (v) => v - ref);
}

const rms = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    if (Number.isFinite(d)) {
      sum += d * d;
      n++;
    }
  }
  return n ? Math.sqrt(sum / n) : NaN;
};

export interface ToneDistance {
  distance: number;
  meanDb: number;
  spreadDb: number;
  levelDb: number;
  gainDelta: number;
}

/** Distance of `candidate` from `target` (see the header); Infinity when either has no signal. */
export function textureDistance(target: Texture, candidate: Texture): ToneDistance {
  const none = { distance: Infinity, meanDb: NaN, spreadDb: NaN, levelDb: NaN, gainDelta: NaN };
  if (!target.activeFrames || !candidate.activeFrames) return none;
  const meanDb = rms(levelled(target), levelled(candidate));
  const spreadDb = rms(target.spreadDb, candidate.spreadDb);
  const levelDb = rms(target.levels, candidate.levels);
  const gainDelta = candidate.gainScore - target.gainScore;
  if (![meanDb, spreadDb, levelDb].every(Number.isFinite)) return none;
  return { distance: meanDb / MEAN_STEP_DB + spreadDb / SPREAD_STEP_DB + levelDb / LEVEL_STEP_DB + Math.abs(gainDelta) / GAIN_STEP, meanDb, spreadDb, levelDb, gainDelta };
}
