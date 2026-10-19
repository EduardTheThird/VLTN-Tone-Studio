import { describe, expect, it } from "vitest";
import { describeTexture, textureDistance } from "./loss";
import { minimize } from "./optimize";
import { FLAT, refineOffline, renderChain, toSettings, toVector, type Amp, type ChainSettings } from "./refine-offline";
import { plucks } from "./test-signals";

const SR = 44100;
// A stand-in amp: a soft clipper whose saturation follows the drive in front of it.
const amp: Amp = (x) => x.map((v) => Math.tanh(2 * v));
// Dense playing (hundreds of notes, like a song's stem or Valeton's 20 s test signal): a few dozen notes differ more
// between two performances than two tones do, which no texture statistic can see through.
const guitar = (seed: number) => plucks({ seconds: 20, sampleRate: SR, seed, gap: 0.15, decay: 0.6, amplitude: 0.3, harmonics: 10 });

describe("minimize", () => {
  it("finds the minimum of a 6-D quadratic inside the unit box", async () => {
    const goal = [0.2, 0.8, 0.5, 0.35, 0.9, 0.1];
    const f = (x: number[]) => x.reduce((acc, v, i) => acc + (v - goal[i]) ** 2, 0);
    const r = await minimize(f, { start: goal.map(() => 0.5), budget: 400, seed: 3 });
    expect(r.value).toBeLessThan(1e-3);
    expect(r.evaluations).toBeLessThanOrEqual(400);
  });

  it("repeats for the same seed", async () => {
    const f = (x: number[]) => (x[0] - 0.3) ** 2 + (x[1] - 0.6) ** 2;
    const a = await minimize(f, { start: [0.5, 0.5], budget: 60, seed: 9 });
    const b = await minimize(f, { start: [0.5, 0.5], budget: 60, seed: 9 });
    expect(a).toEqual(b);
  });
});

describe("settings vector", () => {
  it("round-trips", () => {
    const s: ChainSettings = { driveDb: 9, eqDb: [3, -6, 0, 12, -12] };
    const back = toSettings(toVector(s));
    expect(back.driveDb).toBeCloseTo(9, 9);
    back.eqDb.forEach((g, i) => expect(g).toBeCloseTo(s.eqDb[i], 9));
  });
});

describe("textureDistance", () => {
  it("is small for the same chain on a different performance and larger for a different chain", async () => {
    const chain: ChainSettings = { driveDb: 6, eqDb: [0, 0, 0, 0, 0] };
    const target = describeTexture(await renderChain(guitar(1), SR, amp, chain), SR);
    const same = describeTexture(await renderChain(guitar(2), SR, amp, chain), SR);
    const other = describeTexture(await renderChain(guitar(2), SR, amp, { driveDb: 24, eqDb: [0, 0, -9, 9, 0] }), SR);
    expect(textureDistance(target, same).distance).toBeLessThan(textureDistance(target, other).distance / 2);
  }, 30_000);

  it("ignores the overall level", () => {
    const x = guitar(4);
    const a = describeTexture(x, SR);
    const b = describeTexture(
      x.map((v) => v * 0.25),
      SR,
    );
    expect(textureDistance(a, b).distance).toBeLessThan(0.3);
  }, 30_000);
});

describe("refineOffline", () => {
  it("brings an amp render towards a stem made with other settings, from a different performance", async () => {
    const truth: ChainSettings = { driveDb: 14, eqDb: [4, 0, -6, 0, 5] };
    const target = describeTexture(await renderChain(guitar(1), SR, amp, truth), SR);
    const r = await refineOffline({ target, source: guitar(2), rate: SR, amp, budget: 100, seed: 5 });
    expect(r.initial).toBeGreaterThan(3);
    expect(r.distance).toBeLessThan(r.initial * 0.7);
    // Settings land on the same side of flat as the truth for the strongest EQ moves
    expect(Math.sign(r.settings.eqDb[2])).toBe(-1);
    expect(r.settings.driveDb).toBeGreaterThan(4);
  }, 120_000);

  it("keeps flat settings when nothing beats them", async () => {
    const x = guitar(7);
    const target = describeTexture(await renderChain(x, SR, amp, FLAT), SR);
    const r = await refineOffline({ target, source: x, rate: SR, amp, budget: 30, seed: 1 });
    expect(r.distance).toBeLessThanOrEqual(r.initial);
    expect(r.initial).toBeCloseTo(0, 6);
  }, 30_000);
});
