import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PcmAudio } from "@/song/types";

const fake = vi.hoisted(() => ({
  run: vi.fn(async (_audio: unknown, signal: AbortSignal) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (signal.aborted) throw new Error("aborted");
    return { tempo: { bpm: 98, firstBeat: 0.4, steady: true }, meter: { beatsPerBar: 3, confidence: 0.9 } };
  }),
}));
vi.mock("@/song/analysis/steps", () => ({
  tempoStep: () => ({ name: "tempo", run: fake.run }),
  chordsStep: () => ({ name: "chords", run: async () => ({}) }),
  keyStep: () => ({ name: "key", run: async () => ({}) }),
}));

import { useSongAnalysis, type SongAnalysisInput } from "./use-song-analysis";

const mix: PcmAudio = { sampleRate: 44100, channels: [new Float32Array(44100)] };
const base = (over: Partial<SongAnalysisInput> = {}): SongAnalysisInput => ({
  songKey: "hook-test",
  mix,
  stems: null,
  beatsPerBar: 4,
  chordChanges: [],
  chordName: "",
  playing: false,
  onTempo: vi.fn(),
  onMeter: vi.fn(),
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  fake.run.mockClear();
});

describe("useSongAnalysis", () => {
  it("runs once for a song and hands the tempo and meter back", async () => {
    const onTempo = vi.fn();
    const onMeter = vi.fn();
    const { result } = renderHook((props: SongAnalysisInput) => useSongAnalysis(props), { initialProps: base({ onTempo, onMeter }) });
    await waitFor(() => expect(onTempo).toHaveBeenCalledWith({ bpm: 98, firstBeat: 0.4, steady: true }));
    expect(onMeter).toHaveBeenCalledWith({ beatsPerBar: 3, confidence: 0.9 });
    expect(fake.run).toHaveBeenCalledTimes(1);
    expect(result.current.message).toBe("Tempo 98 BPM. Meter 3/4");
  });

  it("does not run during playback, and runs once playback stops", async () => {
    const onTempo = vi.fn();
    const { rerender } = renderHook((props: SongAnalysisInput) => useSongAnalysis(props), { initialProps: base({ onTempo, playing: true }) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.run).not.toHaveBeenCalled();
    rerender(base({ onTempo, playing: false }));
    await waitFor(() => expect(onTempo).toHaveBeenCalled());
  });

  it("is saved, so opening the song again runs nothing", async () => {
    const first = renderHook((props: SongAnalysisInput) => useSongAnalysis(props), { initialProps: base() });
    await waitFor(() => expect(first.result.current.message).toBe("Tempo 98 BPM. Meter 3/4"));
    first.unmount();
    const onTempo = vi.fn();
    renderHook((props: SongAnalysisInput) => useSongAnalysis(props), { initialProps: base({ onTempo }) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.run).toHaveBeenCalledTimes(1);
    expect(onTempo).toHaveBeenCalledWith({ bpm: 98, firstBeat: 0.4, steady: true });
  });

  it("cancel stops the run and hands nothing back", async () => {
    const onTempo = vi.fn();
    const { result } = renderHook((props: SongAnalysisInput) => useSongAnalysis(props), { initialProps: base({ onTempo }) });
    act(() => result.current.cancel());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onTempo).not.toHaveBeenCalled();
  });
});
