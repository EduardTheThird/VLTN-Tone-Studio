// Demucs inference around one fixed-length model call, ported from demucs 4 (facebookresearch/demucs, MIT):
// demucs.api's Separator normalises the track by the mean/std of its mono mix; apply_model(split=True, overlap,
// shifts) cuts it into `segment`-long chunks every `stride` samples, pads the last (short) chunk around its centre
// with the audio before it (TensorChunk.padded), trims the model output back (center_trim) and blends the chunks
// with a triangular transition weight. With shifts, the track is padded by up to MAX_SHIFT (0.5 s) of silence on
// the left, separated, shifted back and the results averaged. The shifts are drawn from a seeded generator (demucs
// uses `random`), so a split is reproducible. Checked against PyTorch apply_model on a 30 s mix (shifts=0): max
// difference 2.6e-4. Pure, so it is tested without the model.

/** Demucs segment (model.segment = 39/5 s at 44.1 kHz), the exports' fixed input length. */
export const SEGMENT = 343_980;
/** apply_model's max_shift: int(0.5 * samplerate) */
export const MAX_SHIFT = 22_050;
/** apply_model's default overlap */
export const OVERLAP = 0.25;

/** One model call: planar stereo [2 × segment] in, planar [sources × 2 × segment] out. */
export type RunSegment = (mix: Float32Array) => Promise<Float32Array>;

export interface Normalisation {
  mean: number;
  std: number;
}

export interface SeparateOptions {
  /** Source rows of one model output */
  sources: number;
  /** The rows to keep, in the order they are returned */
  rows: readonly number[];
  /** Fraction of a segment consecutive chunks share (apply_model's overlap) */
  overlap: number;
  /** Random shifts to average (0: none) */
  shifts: number;
  /** Seed of the shift offsets */
  seed?: number;
  segment?: number;
  maxShift?: number;
}

export interface SeparateCallbacks {
  /** Called after each chunk with the finished fraction (0..1] */
  onProgress?: (fraction: number) => void;
  /** Checked between chunks; true stops the split with an AbortError */
  cancelled?: () => boolean;
}

const DEFAULT_SEED = 0x5eed;

/** Mean and (unbiased) standard deviation + 1e-8 of the mono mix, as demucs.api's `ref = wav.mean(0)`. */
export function mixStats(channels: Float32Array[]): Normalisation {
  const n = channels[0].length;
  const inv = 1 / channels.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const ch of channels) m += ch[i];
    sum += m * inv;
  }
  const mean = n ? sum / n : 0;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const ch of channels) m += ch[i];
    const d = m * inv - mean;
    sq += d * d;
  }
  const std = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;
  return { mean, std: std + 1e-8 };
}

/** apply_model's transition weight: a triangle peaking at 1 in the middle of the segment. */
export function transitionWeight(segment: number): Float32Array {
  const half = Math.floor(segment / 2);
  const w = new Float32Array(segment);
  for (let i = 0; i < half; i++) w[i] = i + 1;
  for (let i = half; i < segment; i++) w[i] = segment - i;
  const max = Math.max(half, segment - half);
  for (let i = 0; i < segment; i++) w[i] /= max;
  return w;
}

/** Chunk start offsets: range(0, length, stride) with stride = int((1 - overlap) * segment). */
export function chunkOffsets(length: number, segment = SEGMENT, overlap = OVERLAP): number[] {
  const stride = Math.floor((1 - overlap) * segment);
  const offsets: number[] = [];
  for (let o = 0; o < length; o += stride) offsets.push(o);
  return offsets;
}

/**
 * Silence each shift puts before the track: max_shift - offset for demucs' offset = random.randint(0, max_shift),
 * from a seeded generator (mulberry32). No shifts: one pass without padding.
 */
export function shiftPads(shifts: number, maxShift = MAX_SHIFT, seed = DEFAULT_SEED): number[] {
  if (shifts <= 0) return [0];
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  return Array.from({ length: shifts }, () => maxShift - Math.floor(random() * (maxShift + 1)));
}

/** Model calls a split makes: chunks of the (padded) track, summed over the shifts. */
export function chunkCount(length: number, shifts: number, overlap: number, segment = SEGMENT, maxShift = MAX_SHIFT): number {
  return shiftPads(shifts, maxShift).reduce((n, pad) => n + chunkOffsets(length + pad, segment, overlap).length, 0);
}

/**
 * The model input for the chunk at `offset` (TensorChunk(mix, offset, segment).padded(segment)), normalised:
 * planar [2 × segment]. The track is seen with `pad` samples of silence before it. A short last chunk is
 * centred, with real audio on its left and zeros past the end. Returns the input and where the chunk starts
 * inside it (center_trim's left cut).
 */
export function chunkInput(channels: Float32Array[], norm: Normalisation, offset: number, segment = SEGMENT, pad = 0): { input: Float32Array; lead: number; length: number } {
  const total = channels[0].length + pad;
  const length = Math.min(segment, total - offset);
  const lead = Math.floor((segment - length) / 2);
  const start = offset - lead;
  const input = new Float32Array(2 * segment);
  const from = Math.max(pad, start);
  const to = Math.min(total, start + segment);
  for (let c = 0; c < 2; c++) {
    const src = channels[c];
    const dst = c * segment;
    for (let i = from; i < to; i++) input[dst + i - start] = (src[i - pad] - norm.mean) / norm.std;
  }
  return { input, lead, length };
}

/** apply_model's sum_weight over a track of `length` samples: what each sample's chunk outputs are divided by. */
function weightSums(length: number, offsets: number[], weight: Float32Array): Float32Array {
  const sums = new Float32Array(length);
  for (const offset of offsets) {
    const n = Math.min(weight.length, length - offset);
    for (let i = 0; i < n; i++) sums[offset + i] += weight[i];
  }
  return sums;
}

/**
 * Separate stereo `channels` (44.1 kHz) with `run` once per entry of `pads` (silence before the track, see
 * shiftPads) and average: planar output [row][channel] for each of `opts.rows`, each the length of the input,
 * back at the input's level (the normalisation undone).
 */
export async function separatePadded(channels: Float32Array[], run: RunSegment, opts: SeparateOptions, pads: number[], cb: SeparateCallbacks = {}): Promise<Float32Array[][]> {
  if (channels.length !== 2 || channels[1].length !== channels[0].length) throw new Error("Separation needs stereo audio with equal channels.");
  const segment = opts.segment ?? SEGMENT;
  const total = channels[0].length;
  const norm = mixStats(channels);
  const weight = transitionWeight(segment);
  const out = opts.rows.map(() => [new Float32Array(total), new Float32Array(total)]);
  const plans = pads.map((pad) => ({ pad, offsets: chunkOffsets(total + pad, segment, opts.overlap) }));
  const calls = plans.reduce((n, p) => n + p.offsets.length, 0);
  const expected = opts.sources * 2 * segment;
  let done = 0;
  for (const { pad, offsets } of plans) {
    const sums = weightSums(total + pad, offsets, weight);
    for (const offset of offsets) {
      if (cb.cancelled?.()) throw new DOMException("Separation cancelled", "AbortError");
      const { input, lead, length } = chunkInput(channels, norm, offset, segment, pad);
      const res = await run(input);
      if (res.length !== expected) throw new Error(`The model returned ${res.length} samples, expected ${expected}.`);
      // Samples inside the padding are cut off: the shift back.
      const skip = Math.max(0, pad - offset);
      for (let r = 0; r < opts.rows.length; r++)
        for (let c = 0; c < 2; c++) {
          const src = (opts.rows[r] * 2 + c) * segment + lead;
          const dst = out[r][c];
          for (let i = skip; i < length; i++) {
            const at = offset + i;
            dst[at - pad] += (weight[i] * res[src + i]) / (sums[at] * pads.length);
          }
        }
      cb.onProgress?.(++done / calls);
    }
  }
  for (const row of out) for (const ch of row) for (let i = 0; i < total; i++) ch[i] = ch[i] * norm.std + norm.mean;
  return out;
}

/** Separate stereo `channels` (44.1 kHz) with apply_model's overlap and shifts: planar [row][channel] for each of `opts.rows`. */
export function separate(channels: Float32Array[], run: RunSegment, opts: SeparateOptions, cb: SeparateCallbacks = {}): Promise<Float32Array[][]> {
  return separatePadded(channels, run, opts, shiftPads(opts.shifts, opts.maxShift, opts.seed), cb);
}
