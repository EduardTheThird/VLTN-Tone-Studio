import { describe, expect, it } from "vitest";
import { needsTempoDetection, readTempoSource } from "./tempo-source";

describe("readTempoSource", () => {
  it("reads a recorded source", () => {
    expect(readTempoSource({ tempoSource: "manual" })).toBe("manual");
    expect(readTempoSource({ tempoSource: "detected" })).toBe("detected");
  });

  it("treats anything else as no source", () => {
    expect(readTempoSource({})).toBeNull();
    expect(readTempoSource({ tempoSource: "guess" })).toBeNull();
    expect(readTempoSource({ tempoSource: 120 })).toBeNull();
    expect(readTempoSource(null)).toBeNull();
    expect(readTempoSource("manual")).toBeNull();
  });
});

describe("needsTempoDetection", () => {
  it("detects a song with no saved tempo", () => {
    expect(needsTempoDetection("", null)).toBe(true);
  });

  it("detects the legacy 120 default with no source", () => {
    expect(needsTempoDetection("120", null)).toBe(true);
  });

  it("does not detect a tempo that was saved as a real value", () => {
    expect(needsTempoDetection("98", null)).toBe(false);
  });

  it("does not detect a 120 that the performer set", () => {
    expect(needsTempoDetection("120", "manual")).toBe(false);
    expect(needsTempoDetection("120", "tap")).toBe(false);
  });
});
