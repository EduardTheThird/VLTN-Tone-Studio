import { describe, expect, it } from "vitest";
import type { PcmAudio } from "../types";
import { auditionMix, transitionStart } from "./audition";
import { fixedBeatGrid } from "./beat-grid";
import { previewWindow } from "./band-job";
import { loudnessOf } from "./level";

const sampleRate = 44100;
function tone(amplitude: number, hz: number, seconds: number): PcmAudio {
  const channel = Float32Array.from({ length: sampleRate * seconds }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / sampleRate));
  return { sampleRate, channels: [channel] };
}

describe("arrangement comparison", () => {
  it("starts before the transition at the corrected bar and ends after it", () => {
    const grid = { ...fixedBeatGrid(120, 0, 4, 15), barStarts: [0, 4, 7, 11, 15, 19, 23, 27] };
    const start = transitionStart(grid, 5.5);
    expect(start).toBe(2);
    expect(previewWindow(grid, start, 4)).toEqual({ start: 2, end: 9.5 });
    expect(transitionStart(grid, 2)).toBe(0);
  });

  it("plays the same interval at matched loudness for a saved take and a worker excerpt", () => {
    const song = tone(0.2, 440, 4);
    const drumStem = tone(0.2, 440, 4);
    const bass = tone(0.4, 220, 4);
    const window = { sampleRate, channels: [bass.channels[0].slice(sampleRate, sampleRate * 3)] };
    const original = auditionMix(song, 1, 3);
    const saved = auditionMix(song, 1, 3, { bass: drumStem }, { bass });
    const proposal = auditionMix(song, 1, 3, { bass: drumStem }, { bass: window }, 0);
    expect(saved.channels[0]).toHaveLength(sampleRate * 2);
    expect(saved.channels[0]).toEqual(proposal.channels[0]);
    expect(loudnessOf(saved)).toBeCloseTo(loudnessOf(original), 2);
    expect(song.channels[0]).toEqual(drumStem.channels[0]);
    expect(auditionMix(song, 1, 3, { bass: drumStem }).channels[0]).toEqual(original.channels[0]);
  });
});
