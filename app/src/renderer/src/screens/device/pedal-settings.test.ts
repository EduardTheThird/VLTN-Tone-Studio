import { describe, expect, it } from "vitest";
import type { GlobalSpec, Globals } from "@/state/device-types";
import { controlKind, isNamedRecord, rangeCaption, settingsGroups } from "./pedal-settings";

const names = (device: "gp5" | "gp50", globals: Globals | null = {}, firmware: string | null = null) =>
  settingsGroups(device, globals, firmware).flatMap((g) => g.items.map((s) => s.name));
const spec = (device: "gp5" | "gp50", name: string, firmware: string | null = "1.1.0"): GlobalSpec => {
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
  });
});
