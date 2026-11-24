import { expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, planSections } from "./arrangement";
import { fixedBeatGrid } from "./beat-grid";
import { LEARN_MIN_CONFIDENCE, transcribeDrums } from "./drum-transcribe";
import type { DrumBand, DrumHits } from "./drummer-timing";
import { CLOSED_HAT, KICK, SIDE_STICK, SNARE } from "./note";
import { createRandom } from "./random";

const emptyHits = (): DrumHits => ({ kick: [], mid: [], high: [] });
function place(hits: DrumHits, band: DrumBand, bar: number, step: number, peak = 1, decay = 0.04, jitter = 0) {
  hits[band].push({ time: bar * 2 + step * 0.125 + jitter, peak, decay });
}

function learned(hits: DrumHits, bars: number) {
  const duration = bars * 2;
  return transcribeDrums(hits, fixedBeatGrid(120, 0, 4, duration), planSections([], duration, DEFAULT_BAND_SETTINGS))[0];
}

it("recovers a two-bar repeating kick pattern despite 8 ms of jitter", () => {
  const hits = emptyHits();
  for (let bar = 0; bar < 16; bar++) {
    place(hits, "kick", bar, 0, 1, 0.04, 0.008);
    place(hits, "kick", bar, bar % 2 ? 9 : 6, 1, 0.04, -0.008);
    for (const step of [4, 12]) place(hits, "mid", bar, step, 1, 0.04, -0.008);
    for (const step of [2, 6, 10, 14]) place(hits, "high", bar, step, 1, 0.04, 0.008);
  }
  const result = learned(hits, 16);
  expect(result.confidence).toBe(1);
  expect(result.groove?.filter(({ pitch }) => pitch === KICK).map(({ step }) => step)).toEqual([0, 6]);
  expect(result.alternate?.filter(({ pitch }) => pitch === KICK).map(({ step }) => step)).toEqual([0, 9]);
  expect(result.fills).toEqual([]);
});

it("uses a different last bar for the fill and a different phrase end for its turnaround", () => {
  const hits = emptyHits();
  for (let bar = 0; bar < 8; bar++) {
    place(hits, "kick", bar, bar === 3 ? 2 : 0);
    place(hits, "mid", bar, bar === 7 ? 15 : 4);
    place(hits, "high", bar, 8);
  }
  const result = learned(hits, 8);
  expect(result.groove?.map(({ pitch }) => pitch)).toEqual([KICK, SNARE, CLOSED_HAT]);
  expect(result.fills[0]).toContainEqual({ step: 15, pitch: SNARE, velocity: 115 });
  expect(result.turnarounds[0]).toMatchObject({ bar: 3, hits: expect.arrayContaining([{ step: 2, pitch: KICK, velocity: 115 }]) });
});

it("recognizes a short, quiet side-stick and preserves the rank of velocities", () => {
  const hits = emptyHits();
  for (let bar = 0; bar < 4; bar++) {
    place(hits, "mid", bar, 4, 1);
    place(hits, "mid", bar, 8, 0.2, 0.01);
    place(hits, "mid", bar, 12, 0.55);
    place(hits, "kick", bar, 0, 1);
    place(hits, "kick", bar, 8, 10 ** (-18 / 20));
  }
  const result = learned(hits, 4);
  expect(result.groove).toContainEqual({ step: 8, pitch: SIDE_STICK, velocity: 115 });
  expect(result.groove?.filter(({ pitch }) => pitch === KICK).map(({ velocity }) => velocity)).toEqual([115, 40]);
  const snares = result.groove!.filter(({ pitch }) => pitch === SNARE);
  expect(snares[0].velocity).toBeGreaterThan(snares[1].velocity);
});

it("falls back to the style when hits are random or further from any step than the reach", () => {
  const random = createRandom(17);
  const hits = emptyHits();
  for (let bar = 0; bar < 16; bar++) {
    for (const band of ["kick", "mid", "high"] as const) place(hits, band, bar, random.int(16));
  }
  const result = learned(hits, 16);
  expect(result.confidence).toBeLessThan(LEARN_MIN_CONFIDENCE);
  expect(result.groove).toBeNull();
  const off = emptyHits();
  for (let bar = 0; bar < 8; bar++) place(off, "kick", bar, 4, 1, 0.04, 0.055);
  expect(learned(off, 8).groove).toBeNull();
});
