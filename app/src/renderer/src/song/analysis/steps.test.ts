import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BeatGrid } from "../band/beat-grid";

const loudness = vi.hoisted(() => ({ measure: vi.fn() }));
vi.mock("../audio/loudness-client", () => ({ measureLoudnessInWorker: loudness.measure }));

const job = vi.hoisted(() => ({
  done: null as Promise<BeatGrid> | null,
  meter: Promise.resolve(null) as Promise<{ beatsPerBar: 3 | 4; confidence: number } | null>,
  cancel: vi.fn(),
  start: vi.fn(),
}));
vi.mock("../band/beat-grid-client", () => ({
  startBeatGrid: (request: unknown) => {
    job.start(request);
    return { done: job.done, meter: job.meter, cancel: job.cancel };
  },
}));

import { chordsStep, keyStep, loudnessStep, partsStep, tempoStep } from "./steps";

const beats = Array.from({ length: 16 }, (_, i) => 0.5 + i * 0.6);
const grid: BeatGrid = { beatsPerBar: 4, beats, downbeat: 0, bpm: 100, steady: { bpm: 100, firstBeat: 0.5 } };
const audio = { mix: { sampleRate: 44100, channels: [] }, stems: null, sources: [], sampleRate: 44100, beatsPerBar: 4, chordChanges: [], keySource: null, chordSource: null };

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

  it("returns the meter the beats fall into with the tempo", async () => {
    job.done = Promise.resolve(grid);
    job.meter = Promise.resolve({ beatsPerBar: 3, confidence: 0.9 });
    const result = await tempoStep().run(audio, new AbortController().signal);
    expect(result).toMatchObject({ tempo: { bpm: 100 }, meter: { beatsPerBar: 3, confidence: 0.9 } });
    job.meter = Promise.resolve(null);
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

describe("keyStep and chordsStep", () => {
  const stem = { sampleRate: 44100, channels: [new Float32Array(4)] };
  const estimate = { name: "E minor", tonic: 4, mode: "minor", correlation: 0.8, margin: 0.2, confidence: "strong", alternatives: [] };
  let reply: unknown = null;
  class ReplyingWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage() {
      queueMicrotask(() => this.onmessage?.({ data: reply } as MessageEvent));
    }
    terminate() {}
  }
  beforeEach(() => vi.stubGlobal("Worker", ReplyingWorker));
  afterEach(() => vi.unstubAllGlobals());

  it("reads the key from the key stem and records the stem", async () => {
    reply = { estimate };
    const result = await keyStep().run({ ...audio, keySource: { name: "guitar", audio: stem }, chordSource: null }, new AbortController().signal);
    expect(result).toEqual({ key: { source: "guitar", estimate } });
  });

  it("reads nothing when there is no key stem", async () => {
    expect(await keyStep().run({ ...audio, keySource: null, chordSource: null }, new AbortController().signal)).toEqual({});
  });

  it("reads the chords from the chord stem and records the stem", async () => {
    reply = { chords: [{ time: 0, name: "Em", confidence: 0.9 }] };
    const result = await chordsStep().run({ ...audio, keySource: null, chordSource: { name: "other", audio: stem } }, new AbortController().signal);
    expect(result).toEqual({ chords: { source: "other", chords: [{ time: 0, name: "Em", confidence: 0.9 }] } });
  });

  it("fails when the worker reports an error", async () => {
    reply = { error: "boom" };
    await expect(chordsStep().run({ ...audio, keySource: null, chordSource: { name: "other", audio: stem } }, new AbortController().signal)).rejects.toThrow("boom");
  });
});

describe("loudnessStep", () => {
  it("measures the mix and records its level", async () => {
    loudness.measure.mockResolvedValueOnce({ lufs: -9.8, peakDb: -0.4 });
    expect(await loudnessStep().run(audio, new AbortController().signal)).toEqual({ loudness: { lufs: -9.8, peakDb: -0.4 } });
    expect(loudness.measure).toHaveBeenCalledWith(audio.mix);
  });

  it("records nothing for a silent song", async () => {
    loudness.measure.mockResolvedValueOnce({ lufs: -Infinity, peakDb: -Infinity });
    expect(await loudnessStep().run(audio, new AbortController().signal)).toEqual({});
  });
});

describe("partsStep", () => {
  it("records nothing for a song that was not split", async () => {
    expect(await partsStep().run(audio, new AbortController().signal)).toEqual({});
  });

  it("checks the drums and bass against the mix", async () => {
    const pcm = { sampleRate: 44100, channels: [new Float32Array(44100)] };
    const result = await partsStep().run({ ...audio, mix: pcm, stems: { drums: pcm, bass: pcm } }, new AbortController().signal);
    expect(result.parts).toMatchObject({ drums: expect.any(String), bass: expect.any(String), absentSections: { drums: [], bass: [] } });
  });
});
