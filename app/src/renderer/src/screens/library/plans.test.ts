import { describe, expect, it } from "vitest";
import { buildCatalogFromXml } from "@/gp200/lib/catalog.mjs";
import { BUILT_IN_CATALOG } from "@/gp200/lib/catalog-data.mjs";
import { isChecksumValid } from "@/gp200/lib/prst.mjs";
import { orderError, toPresetState } from "@/state/preset-codec";
import { profileFor } from "@shared/devices";
import { NONE_FXID } from "@/gp150/lib/protocol.mjs";
import { INIT_NAME, clearSteps, copySteps, initPatch, moveSteps, slotsToRead, swapSteps } from "./plans";

// A GP-5's 100 slots.
const SLOTS = 100;

describe("moveSteps", () => {
  it("moves one slot down and shifts the ones in between up", () => {
    expect(moveSteps([57], 60, SLOTS)).toEqual([
      { slot: 57, from: 58 },
      { slot: 58, from: 59 },
      { slot: 59, from: 60 },
      { slot: 60, from: 57 },
    ]);
  });
  it("moves a block up and shifts the rest down", () => {
    expect(moveSteps([10, 11], 8, SLOTS)).toEqual([
      { slot: 8, from: 10 },
      { slot: 9, from: 11 },
      { slot: 10, from: 8 },
      { slot: 11, from: 9 },
    ]);
  });
  it("gathers scattered slots at the target and touches only changed slots", () => {
    expect(moveSteps([57, 59], 57, SLOTS)).toEqual([
      { slot: 58, from: 59 },
      { slot: 59, from: 58 },
    ]);
  });
  it("is empty when nothing moves and null past slot 99", () => {
    expect(moveSteps([5, 6], 5, SLOTS)).toEqual([]);
    expect(moveSteps([5, 6], 99, SLOTS)).toBeNull();
  });
  it("is a permutation: every source lands exactly once", () => {
    const steps = moveSteps([3, 20, 41], 30, SLOTS)!;
    expect(new Set(steps.map((s) => s.slot)).size).toBe(steps.length);
    expect(steps.map((s) => s.from).sort()).toEqual(steps.map((s) => s.slot).sort());
  });
});

describe("copy, swap, clear", () => {
  it("copies into consecutive slots and skips copying a slot onto itself", () => {
    expect(copySteps([57, 59], 64, SLOTS)).toEqual([
      { slot: 64, from: 57 },
      { slot: 65, from: 59 },
    ]);
    expect(copySteps([5], 5, SLOTS)).toEqual([]);
    expect(copySteps([1, 2], 99, SLOTS)).toBeNull();
    expect(copySteps([1, 2], 98, SLOTS)).not.toBeNull();
  });
  it("swaps two slots", () => {
    expect(swapSteps(57, 59)).toEqual([
      { slot: 57, from: 59 },
      { slot: 59, from: 57 },
    ]);
  });
  it("clears with blank presets and reads only real sources", () => {
    const steps = [...clearSteps([3]), ...copySteps([9, 2], 20, SLOTS)!];
    expect(slotsToRead(steps)).toEqual([2, 9]);
  });
});

describe("initPatch", () => {
  // Synthetic catalog in the editor's format (written for this test; not Valeton data): two models per block, the
  // second one first in the editor's list.
  const blocks = profileFor("gp200").blocks;
  const xml = [
    '<?xml version="1.0" encoding="utf-8" ?>',
    "<GP-200>",
    ...blocks.flatMap((b, k) => [
      `  <Catalog Name = "${b}">`,
      `    <Alg Name="Later ${b}" Module="${b}" Code="${0x2000 + k}" Index="1" />`,
      `    <Alg Name="First ${b}" Module="${b}" Code="${0x1000 + k}" Index="0">`,
      '      <Knob  Name = "Level"  idx = "0" ID = "2" default = "40" Dmin = "0" Dmax = "100" Type = "1" step = "1" />',
      "    </Alg>",
      "  </Catalog>",
    ]),
    "</GP-200>",
  ].join("\r\n");
  const catalog = buildCatalogFromXml(xml);

  it("puts the first model of every block in, at its defaults, every block off, named INIT", () => {
    const prst = initPatch("gp200", catalog);
    expect(isChecksumValid(prst)).toBe(true);
    const p = toPresetState(0, prst, "gp200", catalog);
    expect(p.name).toBe(INIT_NAME);
    expect(orderError("gp200", p.order)).toBeNull();
    expect(p.blocks.map((b) => [b.model?.title, b.enabled, b.params[2]])).toEqual(blocks.map((b) => [`First ${b}`, false, 40]));
  });

  it("needs a model for every block: a GP-200 patch has one in each", () => {
    const noVol = buildCatalogFromXml(xml.replace(/<Catalog Name = "VOL">[\s\S]*?<\/Catalog>/, ""));
    expect(() => initPatch("gp200", noVol)).toThrow(/no VOL model/);
  });

  it("works with the built-in effect list on every GP-200 model", () => {
    for (const device of ["gp200", "gp200lt", "gp200jr"] as const) {
      const p = toPresetState(0, initPatch(device, BUILT_IN_CATALOG), device, BUILT_IN_CATALOG);
      expect(p.blocks.every((b) => b.model !== undefined && !b.enabled)).toBe(true);
    }
  });

  it("gives a GP-150 a GP-150 preset: every module empty (VOL on), a valid chain, named INIT", () => {
    const p = toPresetState(0, initPatch("gp150"), "gp150");
    expect(p.device).toBe("gp150");
    expect(p.name).toBe(INIT_NAME);
    expect(orderError("gp150", p.order)).toBeNull();
    expect(p.blocks.every((b) => b.fxid === NONE_FXID && b.model !== undefined)).toBe(true);
    expect(p.blocks.filter((b) => b.enabled).map((b) => b.code)).toEqual(["VOL"]);
  });
});
