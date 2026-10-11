import { describe, expect, it } from "vitest";
import type { BlockState, ModelInfo, PresetState } from "@/state/device-types";
import { blockCodes } from "@/state/device-model";
import { diffPresets } from "./unsaved-diff";

const plus: ModelInfo = {
  fxid: 1,
  block: "DST",
  name: "Plustortion",
  title: "Plustortion",
  type: "Distortion",
  params: [
    { name: "Gain", index: 0, min: 0, max: 100, step: 1, default: 50 },
    { name: "Volume", index: 1, min: 0, max: 100, step: 1, default: 50 },
    { name: "Mode", index: 2, min: 0, max: 1, step: 1, default: 0, labels: ["Clean", "Hot"] },
  ],
};
const other: ModelInfo = { ...plus, fxid: 2, name: "Other", title: "Other Drive" };

function preset(edit: (blocks: BlockState[]) => void = () => {}): PresetState {
  const blocks: BlockState[] = blockCodes("gp5").map((code, index) => ({ index, code, enabled: true, fxid: 1, model: plus, params: [10, 20, 0, 0, 0, 0, 0, 0] }));
  edit(blocks);
  return { device: "gp5", slot: 63, name: "Shatte-GT1", blocks, order: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], volume: 50, bpm: 120, footswitches: [[0], [1]], exp: null, gp200: null, prst: new Uint8Array() };
}

describe("diffPresets", () => {
  it("is empty for identical presets", () => {
    expect(diffPresets(preset(), preset())).toEqual([]);
  });

  it("ignores param float noise up to 1e-3", () => {
    const now = preset((b) => {
      b[2].params[0] = 10.0005;
    });
    expect(diffPresets(preset(), now)).toEqual([]);
  });

  it("lists param changes with names and enum labels", () => {
    const now = preset((b) => {
      b[2].params[1] = 60;
      b[2].params[2] = 1;
    });
    expect(diffPresets(preset(), now)).toEqual([
      { block: { code: "DST", model: "Plustortion" }, parameter: "Volume", saved: "20", now: "60" },
      { block: { code: "DST", model: "Plustortion" }, parameter: "Mode", saved: "Clean", now: "Hot" },
    ]);
  });

  it("shows a model swap as one row instead of its param changes", () => {
    const now = preset((b) => {
      b[3] = { ...b[3], fxid: 2, model: other, params: [1, 2, 3, 4, 5, 6, 7, 8] };
    });
    expect(diffPresets(preset(), now)).toEqual([{ block: { code: "AMP", model: "Other Drive" }, parameter: "Model", saved: "Plustortion", now: "Other Drive" }]);
  });

  it("reports on/off, chain order, volume and footswitch changes", () => {
    const now = { ...preset((b) => void (b[6].enabled = false)), order: [1, 0, 2, 3, 4, 5, 6, 7, 8, 9], volume: 40, footswitches: [[0, 6], [1]] };
    expect(diffPresets(preset(), now).map((r) => [r.block?.code ?? null, r.parameter, r.saved, r.now])).toEqual([
      ["MOD", "On/off", "On", "Off"],
      [null, "Chain order", "", "Changed"],
      [null, "Volume", "50", "40"],
      [null, "Footswitches", "", "Changed"],
    ]);
  });

  it("reports the GP-200 family's own fields", () => {
    const exp = Array.from({ length: 9 }, (_, i) => ({ key: i, pedal: Math.floor(i / 3), para: i % 3, block: null, param: 0, max: 100, min: 0 }));
    const quickAccess = [0, 1, 2].map((index) => ({ index, block: null, param: 0 }));
    const gp200 = { author: "", note: "", pan: 0, style: 0, loopMode: 0, sendLevel: 0, returnLevel: 0, sendPos: 3, returnPos: 4, exp, quickAccess };
    const saved = { ...preset(), device: "gp200" as const, footswitches: [[], [3]], gp200 };
    const now = {
      ...saved,
      footswitches: [[2], [3]],
      gp200: { ...gp200, pan: -20, sendPos: 5, exp: exp.map((e, i) => (i === 4 ? { ...e, block: 3, param: 1 } : e)), quickAccess: [quickAccess[0], { ...quickAccess[1], block: 2 }, quickAccess[2]] },
    };
    expect(diffPresets(saved, now).map((r) => [r.parameter, r.saved, r.now])).toEqual([
      ["CTRL assignments", "", "Changed"],
      ["Pan", "0", "-20"],
      ["FX loop position", "", "Changed"],
      ["EXP 1B, entry 2", "", "Changed"],
      ["Quick Access 2", "", "Changed"],
    ]);
  });
});
