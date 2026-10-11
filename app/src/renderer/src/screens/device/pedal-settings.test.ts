import { describe, expect, it } from "vitest";
import { GLOBALS } from "@/gp200/lib/protocol.mjs";
import type { DeviceKey, GlobalName, Globals, SettingSpec } from "@/state/device-types";
import { controlKind, isNamedRecord, rangeCaption, settingsGroups } from "./pedal-settings";

const names = (device: DeviceKey, globals: Globals | null = {}, firmware: string | null = null) =>
  settingsGroups(device, globals, firmware).flatMap((g) => g.items.map((s) => s.name));
const labelsOf = (device: DeviceKey) => Object.fromEntries(settingsGroups(device, {}, null).flatMap((g) => g.items.map((s) => [s.name, s.label])));
const spec = (device: "gp5" | "gp50", name: string, firmware: string | null = "1.1.0"): SettingSpec => {
  const found = settingsGroups(device, {}, firmware)
    .flatMap((g) => g.items)
    .find((s) => s.name === name);
  if (!found) throw new Error(`${device} has no ${name}`);
  return found;
};

describe("settingsGroups", () => {
  it("shows exactly the GP-5's six settings, grouped", () => {
    expect(names("gp5").sort()).toEqual(["btLevel", "cabSimBypass", "inputTrim", "masterVolume", "monitorLevel", "recordLevel"]);
    expect(settingsGroups("gp5", {}, null).map((g) => g.title)).toEqual(["Audio", "Recording"]);
  });

  it("groups the GP-50 menu in order with only non-empty groups", () => {
    expect(settingsGroups("gp50", {}, "1.1.0").map((g) => g.title)).toEqual(["Audio", "Recording", "Controls", "MIDI", "Display", "Power"]);
    const all = names("gp50", {}, "1.1.0");
    expect(all).toEqual(expect.arrayContaining(["fs3Function", "fs4Function", "midiInSource", "midiChannelTrs", "midiChannelUsb", "displayTime", "displayBrightness", "autoCabMatch"]));
    expect(all).not.toContain("btLevel");
  });

  it("shows GP-50 settings added in 1.1.0 only when the firmware has them or the pedal reports them", () => {
    expect(names("gp50", {}, "1.1.0")).toEqual(expect.arrayContaining(["dcUnplug", "midiChannelBt"]));
    expect(names("gp50", {}, "1.0.5")).not.toContain("dcUnplug");
    expect(names("gp50", {}, "1.0.5")).not.toContain("midiChannelBt");
    expect(names("gp50", { dcUnplug: 0 }, "1.0.5")).toContain("dcUnplug");
    expect(settingsGroups("gp50", {}, "1.0.5").map((g) => g.title)).not.toContain("Power");
  });

  it("shows nothing for an unknown model", () => {
    expect(settingsGroups(null, null, null)).toEqual([]);
  });

  it("shows each GP-200 model the settings of its own jacks, named as on that model", () => {
    const din: GlobalName[] = ["midiInSource", "midiInChannelDin", "midiOutChannelDin", "clockOutDin"];
    const ltJacks: GlobalName[] = ["exp1Mode", "extFs1", "extFs2"];
    expect(names("gp200")).toEqual(expect.arrayContaining([...din, "exp2Mode", "extFs1Tap", "extFs2Tap"]));
    expect(ltJacks.filter((n) => names("gp200").includes(n))).toEqual([]);
    expect(names("gp200lt")).toEqual(expect.arrayContaining([...din, ...ltJacks]));
    expect(din.filter((n) => names("gp200jr").includes(n))).toEqual([]);
    expect(names("gp200jr")).toEqual(expect.arrayContaining(["midiInChannelUsb", "midiOutChannelUsb", "clockOutUsb"]));
    // The LT's two jacks give four external footswitches; the GP-200's one jack gives two
    expect([labelsOf("gp200").extFs1Tap, labelsOf("gp200").extFs2Tap]).toEqual(["External footswitch 1", "External footswitch 2"]);
    const lt = labelsOf("gp200lt");
    expect([lt.extFs1, lt.extFs2, lt.extFs1Tap, lt.extFs2Tap]).toEqual([1, 2, 3, 4].map((n) => `External footswitch ${n}`));
  });
});

describe("controlKind", () => {
  it("uses selects with the pedal's labels for footswitch functions and MIDI channels", () => {
    const fs3 = spec("gp50", "fs3Function");
    expect(controlKind(fs3)).toBe("select");
    expect(fs3.labels).toContain("Tap tempo");
    expect(controlKind(spec("gp50", "fs4Function"))).toBe("select");
    const ch = spec("gp50", "midiChannelUsb");
    expect(controlKind(ch)).toBe("select");
    expect(ch.labels?.[0]).toBe("Omni");
    expect(controlKind(spec("gp50", "displayTime"))).toBe("select");
  });

  it("uses an on/off dial for cab sim bypass on both models and dials for levels", () => {
    expect(controlKind(spec("gp5", "cabSimBypass"))).toBe("toggle");
    expect(controlKind(spec("gp50", "cabSimBypass"))).toBe("toggle");
    expect(controlKind(spec("gp50", "autoCabMatch"))).toBe("toggle");
    expect(controlKind(spec("gp5", "inputTrim"))).toBe("dial");
    expect(controlKind(spec("gp50", "masterVolume"))).toBe("dial");
  });
});

describe("rangeCaption", () => {
  it("prints the range with a real minus and the unit", () => {
    expect(rangeCaption(spec("gp5", "inputTrim"))).toBe("−20 to 20 dB");
    expect(rangeCaption(spec("gp5", "masterVolume"))).toBe("0 to 100");
  });
});

describe("isNamedRecord", () => {
  it("names records by the connected model's table", () => {
    expect(isNamedRecord("gp50", 1, 10)).toBe(true); // MIDI input: GP-50 only
    expect(isNamedRecord("gp5", 1, 10)).toBe(false);
    expect(isNamedRecord("gp5", 5, 4)).toBe(true);
    expect(isNamedRecord(null, 5, 4)).toBe(false);
    // a JR has no DIN MIDI setting, but the record is still a known one
    expect(isNamedRecord("gp200jr", GLOBALS.midiInChannelDin.id, 0x1e)).toBe(true);
  });
});
