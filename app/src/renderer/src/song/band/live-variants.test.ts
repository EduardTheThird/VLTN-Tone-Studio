import { expect, it } from "vitest";
import { fixedBeatGrid } from "./beat-grid";
import { nextBandBar, variantExtraBytes } from "./live-variants";

it("uses irregular bar lines and returns the start of the outgoing bar", () => {
  const grid = { ...fixedBeatGrid(120, 0, 4, 10), barStarts: [0, 3, 9, 14] };
  expect(nextBandBar(grid, 0.8)).toEqual({ at: 1.5, precedingBar: 0 });
  expect(nextBandBar(grid, 1.5)).toEqual({ at: 4.5, precedingBar: 1.5 });
  expect(nextBandBar(grid, 7)).toBeNull();
});

it("raises the total decoded audio of the normal generated parts to three times", () => {
  const normal = 315 * 44100 * 2 * 4 * 2;
  expect(normal + variantExtraBytes(315, 2)).toBe(normal * 3);
});
