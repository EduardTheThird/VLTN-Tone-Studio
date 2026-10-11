// The Rig's patch controls on GP-200 family presets without an effect catalog: tap tempo within the model's range, the
// CTRLs a model shows, EXP / Quick Access targets, and patch-field edits that undo and count as unsaved changes.
import { beforeEach, describe, expect, it } from "vitest";
import { buildPrst, encodePatchImage, type PatchInput } from "@/gp200/lib/prst.mjs";
import { profileFor } from "@shared/devices";
import { useDevice } from "@/state/device";
import type { DeviceKey, PresetState } from "@/state/device-types";
import { toPresetState } from "@/state/preset-codec";
import { editPatchFields, redo, shownSwitches, undo } from "./edits";
import { useHistory } from "./history";
import { paramOptions, retarget, styleOptions, targetOptions } from "./patch-fields";
import { tap } from "./tempo";

const patch = (device: DeviceKey, p: PatchInput = {}): PresetState => toPresetState(0, buildPrst(encodePatchImage({ name: "Test", ...p })), device);

describe("tap tempo", () => {
  it("clamps to the model's range", () => {
    const fast = [0, 200, 400]; // 300 BPM
    expect(tap(fast, 600, profileFor("gp200").tempo).bpm).toBe(250);
    expect(tap(fast, 600, profileFor("gp5").tempo).bpm).toBe(260);
  });
});

describe("shownSwitches", () => {
  const ctrl = Array.from({ length: 8 }, (_, i) => ({ mask: i === 6 ? 0b100 : 0 }));

  it("shows FS1 and FS2 on the GP-5 family and every CTRL on the GP-200", () => {
    expect(shownSwitches({ device: "gp50", footswitches: [[1], []] } as unknown as PresetState)).toEqual([0, 1]);
    expect(shownSwitches(patch("gp200", { ctrl }))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("shows one CTRL per footswitch on the LT and JR, and a higher CTRL that holds blocks", () => {
    expect(shownSwitches(patch("gp200lt", { ctrl }))).toEqual([0, 1, 2, 3, 6]);
    expect(shownSwitches(patch("gp200jr"))).toEqual([0, 1, 2]);
  });
});

describe("EXP and Quick Access targets", () => {
  it("offers Off and every block, Quick Access also the patch volume and tempo, and keeps what the preset holds", () => {
    const p = patch("gp200");
    const exp = targetOptions(p, "exp", null);
    expect(exp.map((o) => o.label)).toEqual(["Off", "PRE", "WAH", "DST", "AMP", "NR", "CAB", "EQ", "MOD", "DLY", "RVB", "VOL"]);
    expect(targetOptions(p, "quickAccess", 3).slice(-2).map((o) => o.label)).toEqual(["Patch volume", "Patch tempo"]);
    expect(targetOptions(p, "exp", 0x0b).at(-1)).toEqual({ value: "11", label: "Patch volume" });
    expect(targetOptions(p, "exp", 0x30).at(-1)).toEqual({ value: "48", label: "Target 48" });
  });

  it("names a param without a catalog by number, and starts a new block target on its first param", () => {
    const p = patch("gp200");
    expect(paramOptions(p, 8, 2)).toEqual([{ value: "2", label: "Parameter 3" }]);
    expect(retarget(p, 8)).toEqual({ block: 8, param: 0 });
    expect(retarget(p, null)).toEqual({ block: null });
    expect(retarget(p, 0x0c)).toEqual({ block: 0x0c });
    expect(styleOptions(25).map((o) => o.label).slice(-2)).toEqual(["Style 20", "Style 26"]);
  });
});

describe("editPatchFields", () => {
  beforeEach(() => {
    const p = patch("gp200", { pan: 3, quickAccess: { 1: { block: 8, param: 2 } } });
    useDevice.setState({ device: "gp200", preset: p, saved: p, unsavedChanges: 0 });
    useHistory.getState().clear();
  });
  const g = () => useDevice.getState().preset!.gp200!;

  it("counts as an unsaved change, undoes and redoes", async () => {
    editPatchFields({ pan: -5, quickAccess: { 1: { block: 0x0c } } });
    expect([g().pan, g().quickAccess[1].block, useDevice.getState().unsavedChanges]).toEqual([-5, 0x0c, 2]);
    await undo();
    expect([g().pan, g().quickAccess[1], useDevice.getState().unsavedChanges]).toEqual([3, { index: 1, block: 8, param: 2 }, 0]);
    await redo();
    expect([g().pan, g().quickAccess[1].block]).toEqual([-5, 0x0c]);
  });

  it("records what the preset stores, and nothing for an edit that changes nothing", () => {
    editPatchFields({ pan: 3 });
    expect(useHistory.getState().past).toEqual([]);
    editPatchFields({ author: "Tést", exp: { 0: { max: 0.1 } } });
    const last = useHistory.getState().past.at(-1);
    expect(last).toMatchObject({ kind: "patch", to: { author: "Tst", exp: { 0: { max: Math.fround(0.1) } } } });
    expect(g().author).toBe("Tst");
  });
});
