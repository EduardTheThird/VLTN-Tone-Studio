// Offline refinement: search the settings of a fixed amp render (a NAM capture, or any `amp` function) that bring the
// texture of its output closest to the song's guitar stem (loss.ts), without a pedal. Analysis by synthesis:
//
//   source (test signal) --drive--> amp --5-band EQ--> output;  distance(stem texture, output texture) is minimised
//
// The knobs are the input drive (how hard the amp is pushed, so how saturated it gets) and the five EQ bands of the
// proposal's Guitar EQ (same centres), so the result maps onto the preset the proposal builds. The search is
// minimize() (CMA-ES) from flat settings, so the starting point is the unrefined render.
import { describeTexture, textureDistance, type Texture } from "./loss";
import { minimize } from "./optimize";

export const EQ_CENTERS_HZ = [125, 400, 800, 1600, 4000] as const;
export const DRIVE_RANGE_DB = [-12, 24] as const;
export const EQ_RANGE_DB = 12;
const EQ_Q = 1;

export interface ChainSettings {
  /** Gain in front of the amp, dB */
  driveDb: number;
  /** Gain of each EQ band (EQ_CENTERS_HZ), dB */
  eqDb: number[];
}

export const FLAT: ChainSettings = { driveDb: 0, eqDb: EQ_CENTERS_HZ.map(() => 0) };

/** Unit-box vector ↔ settings (drive first, then the EQ bands). */
export function toSettings(u: readonly number[]): ChainSettings {
  const [lo, hi] = DRIVE_RANGE_DB;
  return { driveDb: lo + u[0] * (hi - lo), eqDb: EQ_CENTERS_HZ.map((_, i) => (u[i + 1] * 2 - 1) * EQ_RANGE_DB) };
}
export const toVector = (s: ChainSettings): number[] => [(s.driveDb - DRIVE_RANGE_DB[0]) / (DRIVE_RANGE_DB[1] - DRIVE_RANGE_DB[0]), ...s.eqDb.map((g) => (g / EQ_RANGE_DB + 1) / 2)];

/** RBJ peaking filter, normalised: [b0, b1, b2, a1, a2]. */
function peaking(fc: number, gainDb: number, sampleRate: number): number[] {
  const A = 10 ** (gainDb / 40);
  const w = (2 * Math.PI * fc) / sampleRate;
  const alpha = Math.sin(w) / (2 * EQ_Q);
  const a0 = 1 + alpha / A;
  return [(1 + alpha * A) / a0, (-2 * Math.cos(w)) / a0, (1 - alpha * A) / a0, (-2 * Math.cos(w)) / a0, (1 - alpha / A) / a0];
}

function applyEq(x: Float32Array, eqDb: readonly number[], sampleRate: number): Float32Array {
  let y = x;
  eqDb.forEach((g, i) => {
    if (Math.abs(g) < 0.05) return;
    const [b0, b1, b2, a1, a2] = peaking(EQ_CENTERS_HZ[i], g, sampleRate);
    const out = new Float32Array(y.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let n = 0; n < y.length; n++) {
      const x0 = y[n];
      const v = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      out[n] = v;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = v;
    }
    y = out;
  });
  return y;
}

/** An amp: pushed input in, its output out (a NAM render in the app; sync or async). */
export type Amp = (input: Float32Array) => Float32Array | Promise<Float32Array>;

/** The chain's output for `settings`. */
export async function renderChain(source: Float32Array, rate: number, amp: Amp, settings: ChainSettings): Promise<Float32Array> {
  const g = 10 ** (settings.driveDb / 20);
  return applyEq(await amp(source.map((v) => v * g)), settings.eqDb, rate);
}

export interface RefineOptions {
  /** The stem's texture (describeTexture on the guitar stem) */
  target: Texture;
  /** The test signal to render on, mono, at `rate` */
  source: Float32Array;
  rate: number;
  amp: Amp;
  /** Maximum renders (default 150) */
  budget?: number;
  seed?: number;
  onProgress?: (fraction: number) => void;
}

export interface Refined {
  settings: ChainSettings;
  /** textureDistance of the flat render, and of the refined one */
  initial: number;
  distance: number;
  evaluations: number;
}

/** Find the drive and EQ that bring the amp's output closest to the stem. */
export async function refineOffline(o: RefineOptions): Promise<Refined> {
  const budget = o.budget ?? 150;
  const cost = async (u: number[]) => {
    const out = await renderChain(o.source, o.rate, o.amp, toSettings(u));
    return textureDistance(o.target, describeTexture(out, o.rate)).distance;
  };
  const start = toVector(FLAT);
  const result = await minimize(cost, { start, budget, seed: o.seed, onProgress: (evaluations) => o.onProgress?.(evaluations / budget) });
  o.onProgress?.(1);
  // minimize() evaluates the start first; the flat render is the baseline to beat.
  const initial = result.startValue;
  const useResult = !Number.isFinite(initial) || result.value < initial;
  return { settings: useResult ? toSettings(result.x) : FLAT, initial, distance: useResult ? result.value : initial, evaluations: result.evaluations };
}
