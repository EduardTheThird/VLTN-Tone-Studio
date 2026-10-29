import { describe, expect, it } from "vitest";
import type { BeatGrid } from "../band/beat-grid";
import { needsTempoDetection, readTempoSource, tempoFromGrid } from "./tempo-source";

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

describe("tempoFromGrid", () => {
  const beats = (count: number, interval: number, first = 0.5) => Array.from({ length: count }, (_, i) => first + i * interval);
  const grid = (over: Partial<BeatGrid>): BeatGrid => ({ beatsPerBar: 4, beats: beats(16, 0.6), downbeat: 0, bpm: 100, steady: null, ...over });

  it("takes the straight-line fit for a steady grid", () => {
    expect(tempoFromGrid(grid({ bpm: 99.7, steady: { bpm: 98.04, firstBeat: 0.5 } }))).toEqual({ bpm: 98, firstBeat: 0.5, steady: true });
  });

  it("uses the median interval and the downbeat for an unsteady grid", () => {
    expect(tempoFromGrid(grid({ bpm: 101.23, downbeat: 2 }))).toEqual({ bpm: 101.2, firstBeat: 0.5 + 2 * 0.6, steady: false });
  });

  it("gives nothing for a grid under eight beats", () => {
    expect(tempoFromGrid(grid({ beats: beats(7, 0.5) }))).toBeNull();
  });

  it("keeps the tempo in the song range", () => {
    expect(tempoFromGrid(grid({ bpm: 350 }))?.bpm).toBe(300);
    expect(tempoFromGrid(grid({ bpm: 12 }))?.bpm).toBe(30);
  });
});
