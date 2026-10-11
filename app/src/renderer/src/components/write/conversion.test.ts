import { describe, expect, it } from "vitest";
import type { ExpSettings } from "@/state/device-types";
import { conversionFor, conversionNote, listConversionNote } from "./conversion";
import type { PresetSummary } from "./preset-summary";

const gp50 = (extra: Partial<Pick<PresetSummary, "gp50Only" | "exp" | "synced">> = {}) => ({
  device: "gp50" as const,
  gp50Only: [],
  exp: null,
  synced: [],
  ...extra,
});
const expOn: ExpSettings = { on: true, paramMin: 0, paramMax: 100, volPosition: 0, volMin: 0, volMax: 100, targetModule: 9, targetParam: 1 };

describe("conversionFor / conversionNote", () => {
  it("names the EXP settings and synced params a GP-50 preset loses on a GP-5", () => {
    const c = conversionFor(gp50({ exp: expOn, synced: ["DLY Time"] }), "gp5")!;
    expect(c).toMatchObject({ expDropped: true, unsynced: ["DLY Time"], refused: null });
    expect(conversionNote(c)).toBe(
      "Made on a GP-50. Converted for your GP-5 when you write it. Its EXP pedal settings are dropped: the GP-5 keeps none per preset. DLY Time follows the tempo; the GP-5 has no tempo sync, so set it again after writing.",
    );
  });

  it("says nothing about EXP when the preset's EXP is off", () => {
    const c = conversionFor(gp50({ exp: { ...expOn, on: false } }), "gp5")!;
    expect(c.expDropped).toBe(false);
    expect(conversionNote(c)).toBe("Made on a GP-50. Converted for your GP-5 when you write it.");
  });

  it("loses nothing from GP-5 to GP-50", () => {
    const c = conversionFor({ device: "gp5", gp50Only: [], exp: null, synced: [] }, "gp50")!;
    expect(conversionNote(c)).toBe("Made on a GP-5. Converted for your GP-50 when you write it; nothing is lost.");
  });
});

describe("listConversionNote", () => {
  it("is shown only when writing loses something", () => {
    expect(listConversionNote("gp5", "gp50")).toBeNull();
    expect(listConversionNote("gp50", "gp50")).toBeNull();
    expect(listConversionNote("gp50", "gp5")).toMatch(/^Presets made on a GP-50 are converted for your GP-5 when you write one: their EXP pedal settings are dropped/);
    expect(listConversionNote("gp200", "gp5")).toBe("Presets made on a GP-200 can't be converted for a GP-5.");
  });
});
