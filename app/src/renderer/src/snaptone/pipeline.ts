/**
 * NAM model -> 8840-byte SnapTone clone blob, reproducing Valeton Suite 2.1.0's namConverterCloData:
 *  1. excitation: channel 0 of Suite's nam_input_wav.wav (44.1 kHz, 16-bit, 70 s), resampled to the model rate
 *     with the library's r8brain converter and stored as 24-bit (getConvertNormalWav -> HTCache/<sr>.wav);
 *  2. NAM output: the model (fast tanh, prewarmed) on that excitation, times 0.31, stored as 16-bit (getNamOutput).
 *     A1 renders with a1kernel.wasm; A2 renders its container's last (full-size) submodel with a2kernel.wasm,
 *     because Suite never sets a slimmable size. Our addition: an optional cab IR is convolved into the render
 *     before the 16-bit store (applyCabIr), so the clone's IR2 takes the cab in; without one the path is Suite's;
 *  3. HTKPA::startClone on the two signals as JUCE reads them back.
 * The 16/24-bit round trips are part of the recipe: the clone reacts to single LSBs.
 */
import { SIGNAL_RATE } from "@shared/host/snaptone";
import { DEFAULT_MODEL_RATE, prepareNam } from "@shared/nam";
import { fft } from "@/song/tonematch/fft";
import { parseA2, renderA2, type A2Model } from "./a2";
import { cloneSnapTone, convertSampleRate } from "./htkpa";
import { parseA1, renderA1, type A1Model } from "./wavenet";

/** getNamOutput's fixed output gain (0.31f at 0x19fc28). */
const NAM_OUTPUT_GAIN = Math.fround(0.31);

/** Longest cab IR baked into a render; real cabs ring out well before this. */
export const CAB_IR_MAX_SECONDS = 0.5;
/** Highest peak a cab IR may lift the render to (it is stored as 16-bit, which clips at 1). */
const CAB_PEAK_LIMIT = 0.99;
/** Smallest FFT used for the overlap-add convolution, so short IRs still go in big blocks. */
const MIN_CONV_FFT = 16384;

/**
 * Write `x` as `bits`-bit PCM and read it back, exactly like JUCE's WAV writer and reader:
 * roundToInt(clamp(x) * 0x7fffffff) >> (32 - bits), then int / 2^(bits - 1).
 */
export function pcmRoundTrip(x: Float32Array, bits: 16 | 24): Float32Array {
  const shift = 2 ** (32 - bits);
  const scale = 2 ** (bits - 1);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const c = x[i] < -1 ? -1 : x[i] > 1 ? 1 : x[i];
    out[i] = Math.floor(Math.floor(c * 0x7fffffff + 0.5) / shift) / scale;
  }
  return out;
}

export type ClonePhase = "excitation" | "render" | "clone";

/** The wasm kernel for a model family (a1kernel.wasm or a2kernel.wasm bytes). */
export type KernelSource = (arch: "A1" | "A2") => BufferSource | Promise<BufferSource>;

/** Overlap-add FFT convolution of `x` with `h`, causal, cut to x's length (the tail is dropped). */
function convolve(x: Float32Array, h: Float32Array): Float64Array {
  let n = MIN_CONV_FFT;
  while (n < 2 * h.length) n *= 2;
  const block = n - h.length + 1;
  const hRe = new Float64Array(n);
  const hIm = new Float64Array(n);
  hRe.set(h);
  fft(hRe, hIm);
  const out = new Float64Array(x.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  // h is real, so two blocks go through one complex FFT: block a as the real part, block b as the imaginary part.
  for (let a = 0; a < x.length; a += 2 * block) {
    const b = a + block;
    re.fill(0);
    im.fill(0);
    re.set(x.subarray(a, Math.min(b, x.length)));
    if (b < x.length) im.set(x.subarray(b, Math.min(b + block, x.length)));
    fft(re, im);
    for (let k = 0; k < n; k++) {
      const r = re[k] * hRe[k] - im[k] * hIm[k];
      im[k] = re[k] * hIm[k] + im[k] * hRe[k];
      re[k] = r;
    }
    fft(re, im, true);
    for (let i = 0; i < n && a + i < x.length; i++) out[a + i] += re[i];
    for (let i = 0; i < n && b + i < x.length; i++) out[b + i] += im[i];
  }
  return out;
}

const rms = (x: ArrayLike<number>) => {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / x.length);
};

/**
 * The render through a cab IR at the render's rate: convolved, then scaled to the dry render's RMS, or lower if that
 * would peak above 0.99. A unit Dirac gives the render back unchanged. Throws a user-facing Error for a silent IR.
 */
export function applyCabIr(render: Float32Array, ir: Float32Array): Float32Array {
  const wet = Float32Array.from(convolve(render, ir));
  const wetRms = rms(wet);
  if (wetRms === 0) throw new Error("This cab IR is silent.");
  let peak = 0;
  for (const v of wet) peak = Math.max(peak, Math.abs(v));
  const gain = Math.min(rms(render) / wetRms, CAB_PEAK_LIMIT / peak);
  return gain === 1 ? wet : wet.map((v) => v * gain);
}

/** A cab IR resampled to the model rate and cut to CAB_IR_MAX_SECONDS. */
function cabIrAt(cabIr: { samples: Float32Array; rate: number }, rate: number): Float32Array {
  const ir = cabIr.rate === rate ? cabIr.samples : convertSampleRate(cabIr.samples, cabIr.rate, rate);
  if (ir.length === 0) throw new Error("This cab IR is too short to use.");
  return ir.subarray(0, Math.round(CAB_IR_MAX_SECONDS * rate));
}

/** A NAM A1 or A2 model parsed for the wasm kernels, with the rate it renders at. */
export type NamModel = ({ arch: "A1"; a1: A1Model } | { arch: "A2"; a2: A2Model }) & { rate: number };

/** Check (shared/nam.ts prepareNam) and parse a NAM A1 or A2 model; rate = its `sample_rate`, DEFAULT_MODEL_RATE when missing. */
export function parseNamModel(namText: string): NamModel {
  const { json, check } = prepareNam(namText);
  if (check.arch === "A2") {
    const a2 = parseA2(json);
    return { arch: "A2", a2, rate: a2.sampleRate ?? DEFAULT_MODEL_RATE };
  }
  const a1 = parseA1(json);
  return { arch: "A1", a1, rate: a1.sampleRate ?? DEFAULT_MODEL_RATE };
}

/** `input` (at the model's rate) through the model the way getNamOutput renders it: prewarmed, fast tanh, times 0.31. */
export async function renderNam(model: NamModel, input: Float32Array, kernel: KernelSource, onProgress?: (fraction: number) => void): Promise<Float32Array> {
  const wasm = await kernel(model.arch);
  const rendered = model.arch === "A2" ? await renderA2(wasm, model.a2, input, onProgress) : await renderA1(wasm, model.a1, input, onProgress);
  for (let i = 0; i < rendered.length; i++) rendered[i] = Math.fround(rendered[i] * NAM_OUTPUT_GAIN);
  return rendered;
}

/**
 * Run the whole conversion. `namText` is a NAM A1 or A2 model (checked and, for A1 0.7.x, reshaped by
 * shared/nam.ts prepareNam), `excitation` channel 0 of nam_input_wav.wav (shared/host/snaptone.ts readSignalWav),
 * `cabIr` an optional cab IR (channel 0, any rate) baked into the SnapTone.
 */
export async function namToCloneBlob(
  namText: string,
  excitation: Int16Array,
  kernel: KernelSource,
  onProgress: (phase: ClonePhase, fraction: number) => void = () => {},
  cabIr?: { samples: Float32Array; rate: number },
): Promise<Uint8Array> {
  const model = parseNamModel(namText);
  const { rate } = model;
  const ir = cabIr && cabIrAt(cabIr, rate);
  onProgress("excitation", 0);
  const source = Float32Array.from(excitation, (v) => v / 32768);
  const input = pcmRoundTrip(rate === SIGNAL_RATE ? source : convertSampleRate(source, SIGNAL_RATE, rate), 24);
  const rendered = await renderNam(model, input, kernel, (f) => onProgress("render", f));
  const output = ir ? applyCabIr(rendered, ir) : rendered;
  onProgress("clone", 0);
  return cloneSnapTone(input, pcmRoundTrip(output, 16), rate);
}
