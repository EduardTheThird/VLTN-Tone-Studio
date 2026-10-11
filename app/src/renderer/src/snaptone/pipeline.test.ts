/// <reference types="node" />
// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCloneBlob } from "@/gp5/lib/snaptone.mjs";
import { readSignalWav, SIGNAL_FRAMES } from "@shared/host/snaptone";
import { applyCabIr, namToCloneBlob, pcmRoundTrip } from "./pipeline";

const file = (p: string) => readFileSync(join(__dirname, p));
/** Valeton's nam_input_wav.wav, git-ignored: copy it from a Valeton Suite install to run the comparison. */
const SIGNAL = join(__dirname, "fixtures/nam_input_wav.wav");
const f32 = (b: Uint8Array, from: number, to: number) => new Float32Array(b.buffer.slice(b.byteOffset + from, b.byteOffset + to));

/** max |a - b| / max |b| */
function relError(a: Float32Array, b: Float32Array): number {
  let err = 0;
  let peak = 0;
  for (let i = 0; i < b.length; i++) {
    err = Math.max(err, Math.abs(a[i] - b[i]));
    peak = Math.max(peak, Math.abs(b[i]));
  }
  return err / peak;
}

describe("pcmRoundTrip", () => {
  it("quantizes like JUCE: round to nearest, clamp, keep the top bits", () => {
    const out = pcmRoundTrip(Float32Array.of(0.5, -1.5, 1.5, 0.3 / 32768, 0.7 / 32768), 16);
    expect(Array.from(out, (v) => v * 32768)).toEqual([16384, -32768, 32767, 0, 0]);
  });
});

/** Deterministic noise in ±amp (LCG), as a stand-in for a NAM render. */
function noise(length: number, amp: number, seed = 1): Float32Array {
  let s = seed;
  return Float32Array.from({ length }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return Math.fround((s / 2 ** 32 - 0.5) * 2 * amp);
  });
}

const rmsOf = (x: Float32Array) => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);
/** Energy of the first difference: grows with high-frequency content. */
const hfEnergy = (x: Float32Array) => x.reduce((sum, v, i) => (i ? sum + (v - x[i - 1]) ** 2 : 0), 0);
const peakOf = (x: Float32Array) => x.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
/** 64-tap moving average: a crude lowpass cab. */
const LOWPASS = new Float32Array(64).fill(1 / 64);

describe("applyCabIr", () => {
  it("gives the render back bit for bit through a unit Dirac", () => {
    const render = noise(100_000, 0.3);
    const dirac = new Float32Array(1000);
    dirac[0] = 1;
    expect(applyCabIr(render, dirac)).toEqual(render);
  });

  it("filters with a lowpass IR and keeps the dry render's RMS", () => {
    const render = noise(100_000, 0.1);
    const wet = applyCabIr(render, LOWPASS);
    expect(wet.length).toBe(render.length);
    expect(hfEnergy(wet)).toBeLessThan(hfEnergy(render) / 10);
    expect(rmsOf(wet) / rmsOf(render)).toBeCloseTo(1, 5);
  });

  it("limits the peak to 0.99 when matching the RMS would push it higher", () => {
    // Loud fizz (Nyquist) the lowpass removes, plus rare low-frequency bumps it keeps: matching the dry RMS
    // would lift the bumps far over full scale.
    const render = Float32Array.from({ length: 100_000 }, (_, i) => (i % 2 ? 0.5 : -0.5) + (i % 5000 < 200 ? 0.4 : 0));
    const wet = applyCabIr(render, LOWPASS);
    expect(peakOf(wet)).toBeLessThanOrEqual(Math.fround(0.99)); // 0.99 as the nearest float
    expect(peakOf(wet)).toBeCloseTo(0.99, 5);
    expect(rmsOf(wet)).toBeLessThan(rmsOf(render));
  });

  it("refuses a silent IR", () => {
    expect(() => applyCabIr(noise(1000, 0.1), new Float32Array(10))).toThrow("This cab IR is silent.");
  });
});

/** The kernels the worker fetches, read from disk. */
const kernels = (arch: "A1" | "A2") => file(arch === "A2" ? "a2kernel.wasm" : "a1kernel.wasm");

describe("namToCloneBlob", () => {
  it.skipIf(!existsSync(SIGNAL))("matches the clone Valeton Suite 2.1.0 makes from the same A1 model", { timeout: 120_000 }, async () => {
    const excitation = readSignalWav(new Uint8Array(readFileSync(SIGNAL)));
    expect(excitation.length).toBe(SIGNAL_FRAMES);
    const blob = await namToCloneBlob(file("fixtures/wavenet_a1_standard.nam").toString("utf8"), excitation, kernels);
    const suite = new Uint8Array(file("../gp5/fixtures/snaptone-a1std.clo"));

    expect(checkCloneBlob(blob)).toBeNull();
    // Header and filter coefficients are exact; the amp curve and IRs differ by float rounding only.
    expect(blob.subarray(0x0a, 0x68)).toEqual(suite.subarray(0x0a, 0x68));
    expect(blob.subarray(0x78, 0x88)).toEqual(suite.subarray(0x78, 0x88));
    expect(relError(f32(blob, 0x68, 0x78), f32(suite, 0x68, 0x78))).toBeLessThan(1e-3);
    expect(relError(f32(blob, 0x88, 0x288), f32(suite, 0x88, 0x288))).toBeLessThan(1e-3);
    expect(relError(f32(blob, 0x288, 0x2288), f32(suite, 0x288, 0x2288))).toBeLessThan(1e-3);
  });

  it.skipIf(!existsSync(SIGNAL))("matches the clone Valeton Suite 2.1.0 makes from an A2 container", { timeout: 120_000 }, async () => {
    const excitation = readSignalWav(new Uint8Array(readFileSync(SIGNAL)));
    const blob = await namToCloneBlob(file("fixtures/nam_core_a2.nam").toString("utf8"), excitation, kernels);
    const suite = new Uint8Array(file("../gp5/fixtures/snaptone-a2.clo"));

    expect(checkCloneBlob(blob)).toBeNull();
    // The A2 render is bit-exact with Suite's, so only HTKPA's libm rounding is left (measured 1.6e-6 and 3.2e-6).
    expect(blob.subarray(0x0a, 0x78)).toEqual(suite.subarray(0x0a, 0x78));
    expect(blob.subarray(0x78, 0x88)).toEqual(suite.subarray(0x78, 0x88));
    expect(relError(f32(blob, 0x88, 0x288), f32(suite, 0x88, 0x288))).toBeLessThan(2e-5);
    expect(relError(f32(blob, 0x288, 0x2288), f32(suite, 0x288, 0x2288))).toBeLessThan(2e-5);
  });

  it.skipIf(!existsSync(SIGNAL))("bakes a cab IR in: a Dirac changes nothing, a lowpass gives a different valid clone", { timeout: 300_000 }, async () => {
    const excitation = readSignalWav(new Uint8Array(readFileSync(SIGNAL)));
    const nam = file("fixtures/nam_core_a2.nam").toString("utf8");
    const rate = JSON.parse(nam).sample_rate ?? 48000;
    const dirac = new Float32Array(256);
    dirac[0] = 1;

    const dry = await namToCloneBlob(nam, excitation, kernels);
    const throughDirac = await namToCloneBlob(nam, excitation, kernels, undefined, { samples: dirac, rate });
    const throughLowpass = await namToCloneBlob(nam, excitation, kernels, undefined, { samples: LOWPASS, rate: 44100 });

    expect(throughDirac).toEqual(dry);
    expect(checkCloneBlob(throughLowpass)).toBeNull();
    expect(throughLowpass).not.toEqual(dry);
  });
});
