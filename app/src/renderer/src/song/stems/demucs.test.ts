import { describe, expect, it } from "vitest";
import { chunkCount, chunkInput, chunkOffsets, mixStats, separate, separatePadded, shiftPads, transitionWeight, type RunSegment, type SeparateOptions } from "./demucs";

const SEG = 400;
const MAX_SHIFT = 50;
const SOURCES = 6;
const GUITAR = 4;
const ALL = [0, 1, 2, 3, 4, 5];
const opts = (o: Partial<SeparateOptions> = {}): SeparateOptions => ({ sources: SOURCES, rows: ALL, overlap: 0.25, shifts: 0, segment: SEG, maxShift: MAX_SHIFT, ...o });

/** A "model" that puts the whole (normalised) input in the guitar stem and silence elsewhere. */
const guitarOnly: RunSegment = async (mix) => {
  const out = new Float32Array(SOURCES * 2 * SEG);
  out.set(mix, GUITAR * 2 * SEG);
  return out;
};

/** A time-variant "model": the input scaled by where it sits in the segment, so the result depends on the chunking. */
const ramped: RunSegment = async (mix) => {
  const out = new Float32Array(SOURCES * 2 * SEG);
  for (let c = 0; c < 2; c++) for (let i = 0; i < SEG; i++) out[(GUITAR * 2 + c) * SEG + i] = mix[c * SEG + i] * (0.5 + i / SEG);
  return out;
};

function signal(length: number, phase: number, dc: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => dc + 0.5 * Math.sin(i * 0.05 + phase) + 0.2 * Math.sin(i * 0.31));
}

describe("demucs apply_model port", () => {
  it("builds the triangular transition weight peaking at 1", () => {
    expect(Array.from(transitionWeight(10))).toEqual([1, 2, 3, 4, 5, 5, 4, 3, 2, 1].map((x) => Math.fround(x / 5)));
  });

  it("starts a chunk every (1 - overlap) segment", () => {
    expect(chunkOffsets(1000, SEG)).toEqual([0, 300, 600, 900]);
    expect(chunkOffsets(1000, SEG, 0.5)).toEqual([0, 200, 400, 600, 800]);
    expect(chunkOffsets(343_980 * 2)).toEqual([0, 257_985, 515_970]);
  });

  it("normalises by the mean and unbiased std of the mono mix", () => {
    const { mean, std } = mixStats([Float32Array.from([1, 3]), Float32Array.from([3, 5])]);
    expect(mean).toBe(3);
    expect(std).toBeCloseTo(Math.SQRT2, 6);
  });

  it("centres a short last chunk on real audio before it, zeros after the end", () => {
    const ch = Float32Array.from({ length: 500 }, (_, i) => i + 1);
    const { input, lead, length } = chunkInput([ch, ch], { mean: 0, std: 1 }, 300, SEG);
    expect(length).toBe(200);
    expect(lead).toBe(100);
    expect(input[0]).toBe(201); // sample 200: 100 samples of context before the chunk
    expect(input[lead]).toBe(301);
    expect(input[lead + length - 1]).toBe(500);
    expect(input[lead + length]).toBe(0);
  });

  it("sees a shifted track behind `pad` samples of silence", () => {
    const ch = Float32Array.from({ length: 500 }, (_, i) => i + 1);
    const { input, lead, length } = chunkInput([ch, ch], { mean: 0, std: 1 }, 0, SEG, 30);
    expect([lead, length]).toEqual([0, SEG]);
    expect(input[29]).toBe(0);
    expect(input[30]).toBe(1);
    expect(input[SEG - 1]).toBe(SEG - 30);
  });

  it("draws reproducible shifts of 0..max_shift samples", () => {
    const pads = shiftPads(20, MAX_SHIFT, 7);
    expect(pads).toEqual(shiftPads(20, MAX_SHIFT, 7));
    expect(pads).not.toEqual(shiftPads(20, MAX_SHIFT, 8));
    expect(pads.every((p) => Number.isInteger(p) && p >= 0 && p <= MAX_SHIFT)).toBe(true);
    expect(new Set(pads).size).toBeGreaterThan(1);
    expect(shiftPads(0)).toEqual([0]);
  });

  it("counts the model calls over every shift", () => {
    expect(chunkCount(1000, 0, 0.25, SEG, MAX_SHIFT)).toBe(4);
    const pads = shiftPads(3, MAX_SHIFT);
    expect(chunkCount(1000, 3, 0.5, SEG, MAX_SHIFT)).toBe(pads.reduce((n, p) => n + chunkOffsets(1000 + p, SEG, 0.5).length, 0));
  });

  describe.each([
    { overlap: 0.25, shifts: 0 },
    { overlap: 0.5, shifts: 0 },
    { overlap: 0.75, shifts: 0 },
    { overlap: 0.25, shifts: 2 },
    { overlap: 0.5, shifts: 4 },
  ])("overlap $overlap, shifts $shifts", ({ overlap, shifts }) => {
    it.each([1000, 913, 250])("overlap-adds and shifts back sample-exact (length %i)", async (length) => {
      const channels = [signal(length, 0, 0.1), signal(length, 1, 0.1)];
      const stems = await separate(channels, guitarOnly, opts({ overlap, shifts }));
      const { mean } = mixStats(channels);
      expect(stems).toHaveLength(SOURCES);
      for (let c = 0; c < 2; c++) {
        for (let i = 0; i < length; i++) expect(stems[GUITAR][c][i]).toBeCloseTo(channels[c][i], 5);
        // Demucs adds the mean back to every source.
        for (const s of [0, 1, 2, 3, 5]) expect(stems[s][c][length >> 1]).toBeCloseTo(mean, 6);
      }
    });
  });

  it("averages the separations of the individual shifts", async () => {
    const channels = [signal(1000, 0, 0.1), signal(1000, 1, -0.2)];
    const o = opts({ overlap: 0.5, shifts: 3, seed: 11 });
    const pads = shiftPads(3, MAX_SHIFT, 11);
    const each = await Promise.all(pads.map((p) => separatePadded(channels, ramped, o, [p])));
    const averaged = await separate(channels, ramped, o);
    for (let c = 0; c < 2; c++)
      for (let i = 0; i < 1000; i += 7) expect(averaged[GUITAR][c][i]).toBeCloseTo((each[0][GUITAR][c][i] + each[1][GUITAR][c][i] + each[2][GUITAR][c][i]) / 3, 5);
    // The chunking moved with the shift, so the time-variant model's passes differ.
    const spread = Math.max(...each[0][GUITAR][0].map((x, i) => Math.abs(x - each[1][GUITAR][0][i])));
    expect(spread).toBeGreaterThan(1e-3);
  });

  it("returns only the requested rows, in the requested order", async () => {
    const channels = [signal(500, 0, 0), signal(500, 1, 0)];
    const [guitar, drums] = await separate(channels, guitarOnly, opts({ rows: [GUITAR, 0] }));
    const all = await separate(channels, guitarOnly, opts());
    expect(Array.from(guitar[1])).toEqual(Array.from(all[GUITAR][1]));
    expect(Array.from(drums[0])).toEqual(Array.from(all[0][0]));
    // A four-source model's output is sized by `sources`.
    const four: RunSegment = async () => new Float32Array(4 * 2 * SEG);
    await expect(separate(channels, four, opts({ sources: 4, rows: [3] }))).resolves.toHaveLength(1);
  });

  it("reports progress per model call and stops when cancelled", async () => {
    const channels = [signal(1000, 0, 0), signal(1000, 1, 0)];
    const seen: number[] = [];
    await separate(channels, guitarOnly, opts(), { onProgress: (f) => seen.push(f) });
    expect(seen).toEqual([0.25, 0.5, 0.75, 1]);
    let calls = 0;
    const counting: RunSegment = (mix) => {
      calls++;
      return guitarOnly(mix);
    };
    await expect(separate(channels, counting, opts(), { cancelled: () => calls >= 2 })).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(2);
  });

  it("rejects a model output of the wrong size", async () => {
    const bad: RunSegment = async () => new Float32Array(10);
    await expect(separate([signal(100, 0, 0), signal(100, 1, 0)], bad, opts())).rejects.toThrow(/expected 4800/);
  });
});
