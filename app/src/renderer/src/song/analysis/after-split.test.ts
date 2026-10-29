import { describe, expect, it } from "vitest";
import { AFTER_SPLIT_STEPS, defaultAfterSplit, parseAfterSplit } from "./after-split";

describe("parseAfterSplit", () => {
  it("is every step on when nothing is saved", () => {
    expect(parseAfterSplit(null, null)).toEqual(defaultAfterSplit());
    expect(Object.values(defaultAfterSplit()).every(Boolean)).toBe(true);
  });

  it("takes the old analysis lyrics option when no choice is saved yet", () => {
    expect(parseAfterSplit(null, false).lyrics).toBe(false);
    expect(parseAfterSplit(null, true).lyrics).toBe(true);
  });

  it("reads a saved choice, and keeps the steps it does not name on", () => {
    const choice = parseAfterSplit(JSON.stringify({ lyrics: false, key: false }), true);
    expect(choice.lyrics).toBe(false);
    expect(choice.key).toBe(false);
    expect(choice.tempo).toBe(true);
  });

  it("reads a damaged or unknown choice as the defaults", () => {
    expect(parseAfterSplit("not json", null)).toEqual(defaultAfterSplit());
    expect(parseAfterSplit(JSON.stringify({ lyrics: "no" }), null).lyrics).toBe(true);
  });

  it("lists every step once, with a label", () => {
    const ids = AFTER_SPLIT_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(AFTER_SPLIT_STEPS.every((step) => step.label.length > 0)).toBe(true);
  });
});
