import { expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, parseBandSettings } from "./arrangement";
import { applyBandPreset, BAND_PRESETS, type BandPresetId } from "./presets";

it("parses the settings of every preset and preserves section overrides", () => {
  const original = { ...DEFAULT_BAND_SETTINGS, sections: { verse: { busy: 2 as const, seed: 7 } }, seed: 90 };
  for (const id of Object.keys(BAND_PRESETS) as BandPresetId[]) {
    const changed = applyBandPreset(original, id);
    expect(parseBandSettings(changed)).toEqual(changed);
    expect(changed.sections).toBe(original.sections);
    expect(changed.seed).toBe(90);
  }
});
