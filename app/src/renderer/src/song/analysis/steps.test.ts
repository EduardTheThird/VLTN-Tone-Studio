import { afterEach, describe, expect, it, vi } from "vitest";
import type { BeatGrid } from "../band/beat-grid";

const job = vi.hoisted(() => ({ done: null as Promise<BeatGrid> | null, cancel: vi.fn(), start: vi.fn() }));
vi.mock("../band/beat-grid-client", () => ({
  startBeatGrid: (request: unknown) => {
    job.start(request);
    return { done: job.done, cancel: job.cancel };
  },
}));

import { tempoStep } from "./steps";

const beats = Array.from({ length: 16 }, (_, i) => 0.5 + i * 0.6);
const grid: BeatGrid = { beatsPerBar: 4, beats, downbeat: 0, bpm: 100, steady: { bpm: 100, firstBeat: 0.5 } };
const audio = { sources: [], sampleRate: 44100, beatsPerBar: 4, chordChanges: [] };

afterEach(() => {
  vi.clearAllMocks();
});

describe("tempoStep", () => {
  it("returns the tempo of the tracked grid and passes the grid on", async () => {
    job.done = Promise.resolve(grid);
    const onGrid = vi.fn();
    const result = await tempoStep(onGrid).run(audio, new AbortController().signal);
    expect(result).toEqual({ tempo: { bpm: 100, firstBeat: 0.5, steady: true } });
    expect(onGrid).toHaveBeenCalledWith(grid);
    expect(job.start).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 44100, beatsPerBar: 4 }));
  });

  it("returns nothing, and passes no grid on, when the grid is too short", async () => {
    job.done = Promise.resolve({ ...grid, beats: beats.slice(0, 3) });
    const onGrid = vi.fn();
    expect(await tempoStep(onGrid).run(audio, new AbortController().signal)).toEqual({});
    expect(onGrid).not.toHaveBeenCalled();
  });

  it("cancels the beat tracker when the run is aborted", async () => {
    job.done = new Promise<BeatGrid>((_, reject) => {
      queueMicrotask(() => reject(new Error("cancelled")));
    });
    const controller = new AbortController();
    const pending = tempoStep().run(audio, controller.signal);
    controller.abort("playback");
    await expect(pending).rejects.toThrow();
    expect(job.cancel).toHaveBeenCalled();
  });
});
