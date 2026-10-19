/// <reference types="node" />
// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estimateTone } from "./analyse";
import { captureIncludesCab, evaluateCapture, evaluateRender, refineCapture, excitationSegment, matchDistance, spectralResidualDb, type StemTarget } from "./capture-match";
import { estimateGain } from "./gain";
import { describeTexture } from "./loss";
import { IR_RATE, responseDb } from "./irdesign";
import { ltas, type Ltas } from "./ltas";
import { biquad, hardClip, lowPass, plucks } from "./test-signals";

const RATE = 44100;
/** A guitar-like DI: picked notes every ~0.25 s, slow decay, 12 s. */
const DI = plucks({ seconds: 12, sampleRate: RATE, seed: 3, gap: 0.25, decay: 0.6, harmonics: 8, amplitude: 0.3 });
/** A cabinet stand-in: two low-pass sections at 3 kHz. */
const cab = (x: Float32Array) => biquad(biquad(x, lowPass(3000, 0.7, RATE)), lowPass(3000, 0.7, RATE));
const amp = (drive: number) => hardClip(DI, drive, 0.5);

function target(stem: Float32Array): StemTarget {
  const spectrum = ltas(stem, RATE);
  return { ltas: spectrum, gainScore: estimateGain(stem, RATE).score, tone: estimateTone(spectrum), texture: describeTexture(stem, RATE) };
}

const shifted = (l: Ltas, db: number): Ltas => ({ ...l, db: l.db.map((v) => v + db) });

describe("spectralResidualDb", () => {
  const spectrum = ltas(cab(amp(20)), RATE);

  it("is 0 for the same spectrum at any level", () => {
    expect(spectralResidualDb(spectrum, spectrum)).toBe(0);
    expect(spectralResidualDb(spectrum, shifted(spectrum, -12))).toBeCloseTo(0, 9);
  });

  it("grows with a difference in shape", () => {
    expect(spectralResidualDb(spectrum, ltas(amp(20), RATE))).toBeGreaterThan(3);
  });
});

describe("matchDistance", () => {
  it("counts a gain step of 0.1 like 6 dB of spectral residual", () => {
    expect(matchDistance(0.1, 0)).toBeCloseTo(matchDistance(0, 6), 9);
    expect(matchDistance(-0.2, 3)).toBeCloseTo(2.5, 9);
  });
});

describe("evaluateRender", () => {
  const song = target(cab(amp(20)));

  it("ranks cab-less captures by gain: the one that saturates like the song first, the clean one last", () => {
    const fits = [1, 4, 20].map((drive) => evaluateRender(amp(drive), RATE, song, false));
    const [clean, crunch, high] = fits;
    expect(high.distance).toBeLessThan(crunch.distance);
    expect(crunch.distance).toBeLessThan(clean.distance);
    expect(Math.abs(high.gainDelta)).toBeLessThan(0.1);
    expect(high.score).toBeGreaterThan(clean.score);
  });

  it("designs the cab IR from the capture's own output: it takes the cab-less render to the song's spectrum", () => {
    const fit = evaluateRender(amp(20), RATE, song, false);
    expect(fit.ir).not.toBeNull();
    const ir = fit.ir!.ir;
    // The song's cab falls above 3 kHz, the render doesn't: the IR has to fall.
    expect(responseDb(ir, 6000, IR_RATE) - responseDb(ir, 1000, IR_RATE)).toBeLessThan(-10);
    expect(fit.residualDb).toBeLessThan(2);
  });

  it("skips the IR for a capture that includes its cab and compares it as it is", () => {
    const sameCab = evaluateRender(cab(amp(20)), RATE, song, true);
    const darkCab = evaluateRender(biquad(cab(amp(20)), lowPass(1200, 0.7, RATE)), RATE, song, true);
    expect(sameCab.ir).toBeNull();
    expect(darkCab.ir).toBeNull();
    expect(sameCab.residualDb).toBeLessThan(0.5);
    expect(darkCab.residualDb).toBeGreaterThan(sameCab.residualDb + 3);
    expect(sameCab.distance).toBeLessThan(darkCab.distance);
  });

  it("refuses a silent capture", () => {
    expect(() => evaluateRender(new Float32Array(RATE * 4), RATE, song, false)).toThrow("This capture puts out no sound for the test signal.");
  });
});

describe("excitationSegment", () => {
  it("takes seconds 50–70 of the test signal as floats", () => {
    const signal = Int16Array.from({ length: 70 * RATE }, (_, i) => (i === 50 * RATE ? 16384 : i === 50 * RATE - 1 ? 1000 : 0));
    const x = excitationSegment(signal);
    expect(x.length).toBe(20 * RATE);
    expect(x[0]).toBe(0.5);
  });

  it("refuses a signal shorter than 70 s", () => {
    expect(() => excitationSegment(new Int16Array(60 * RATE))).toThrow("70-second");
  });
});

describe("captureIncludesCab", () => {
  it("reads TONE3000's gear or the NAM metadata", () => {
    expect(captureIncludesCab("amp-cab", "{}")).toBe(true);
    expect(captureIncludesCab("amp", '{"metadata": {"gear_type": "amp_cab"}}')).toBe(true);
    expect(captureIncludesCab("amp", '{"metadata": {"gear_type": "amp"}}')).toBe(false);
    expect(captureIncludesCab(null, "{}")).toBe(false);
  });
});

describe("evaluateCapture", () => {
  const dir = join(__dirname, "../../snaptone");
  const kernels = (arch: "A1" | "A2") => readFileSync(join(dir, arch === "A2" ? "a2kernel.wasm" : "a1kernel.wasm"));

  it("renders a real NAM A1 capture on the excitation and designs its IR", async () => {
    const nam = readFileSync(join(dir, "fixtures/wavenet_a1_standard.nam"), "utf8");
    const rates: number[] = [];
    const fit = await evaluateCapture(nam, "amp", (rate) => (rates.push(rate), rate === RATE ? DI : plucks({ seconds: 12, sampleRate: rate, seed: 3, gap: 0.25, decay: 0.6, harmonics: 8, amplitude: 0.3 })), kernels, target(cab(amp(20))));
    expect(fit.arch).toBe("A1");
    expect(rates).toEqual([fit.rate]);
    expect(fit.ir).not.toBeNull();
    expect(Number.isFinite(fit.distance)).toBe(true);
    expect(fit.score).toBeGreaterThanOrEqual(0);
    expect(fit.score).toBeLessThanOrEqual(100);
  }, 60_000);

  it("refines a real NAM A1 capture: drive and EQ that don't make it worse, through the cab IR of its ranking", async () => {
    const nam = readFileSync(join(dir, "fixtures/wavenet_a1_standard.nam"), "utf8");
    const t = target(cab(amp(20)));
    const at = (rate: number) => plucks({ seconds: 12, sampleRate: rate, seed: 3, gap: 0.12, decay: 0.6, harmonics: 8, amplitude: 0.3 });
    const fit = await evaluateCapture(nam, "amp", at, kernels, t);
    const progress: number[] = [];
    const r = await refineCapture(nam, fit.ir?.ir ?? null, at, kernels, t, (f) => progress.push(f), 12);
    expect(Number.isFinite(r.initial)).toBe(true);
    expect(r.distance).toBeLessThanOrEqual(r.initial);
    expect(r.settings.eqDb).toHaveLength(5);
    expect(progress.at(-1)).toBeGreaterThan(0.5);
  }, 120_000);
});
