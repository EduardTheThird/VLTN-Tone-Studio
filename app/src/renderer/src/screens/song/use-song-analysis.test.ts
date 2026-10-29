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
  loudnessStep: () => ({ name: "loudness", run: async () => ({}) }),
  partsStep: () => ({ name: "parts", run: async () => ({}) }),
  silenceStep: () => ({ name: "silence", run: async () => ({}) }),
  sectionsStep: () => ({ name: "sections", run: async () => ({}) }),
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
  onDetect: vi.fn(() => null),
  onLoudness: vi.fn(),
  onParts: vi.fn(),
  onSilence: vi.fn(),
  onSections: vi.fn(),
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

  it("restarts a run that was interrupted by playback when playback stopped before the run ended", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // A step that cannot be aborted, like the loudness worker: it finishes after playback has already stopped.
    fake.run.mockImplementationOnce(async () => {
      await gate;
      return { tempo: { bpm: 98, firstBeat: 0.4, steady: true }, meter: { beatsPerBar: 3, confidence: 0.9 } };
    });
    const onTempo = vi.fn();
    const { rerender } = renderHook((props: SongAnalysisInput) => useSongAnalysis(props), { initialProps: base({ onTempo }) });
    await waitFor(() => expect(fake.run).toHaveBeenCalledTimes(1));
    rerender(base({ onTempo, playing: true }));
    rerender(base({ onTempo, playing: false }));
    release();
    await waitFor(() => expect(onTempo).toHaveBeenCalledWith({ bpm: 98, firstBeat: 0.4, steady: true }));
    // The finished tempo was kept, so the step is not run a second time.
    expect(fake.run).toHaveBeenCalledTimes(1);
  });

  it("shows the notice a finished run gives, with its action until the next run starts", async () => {
    const undo = vi.fn();
    const onTempo = vi.fn(() => ({ text: "Tempo detected: 98 BPM (was 120).", actions: [{ label: "Undo", run: undo }] }));
    const { result } = renderHook((props: SongAnalysisInput) => useSongAnalysis(props), { initialProps: base({ onTempo }) });
    await waitFor(() => expect(result.current.notices.map((n) => n.text)).toEqual(["Tempo detected: 98 BPM (was 120)."]));
    act(() => result.current.notices[0].actions?.[0].run());
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("detects the tempo again through onDetect, not onTempo, and runs only the tempo step", async () => {
    const onTempo = vi.fn();
    const onDetect = vi.fn(() => null);
    const { result } = renderHook((props: SongAnalysisInput) => useSongAnalysis(props), { initialProps: base({ onTempo, onDetect }) });
    await waitFor(() => expect(onTempo).toHaveBeenCalledTimes(1));
    act(() => result.current.detect());
    expect(result.current.detecting).toBe(true);
    await waitFor(() => expect(onDetect).toHaveBeenCalledWith({ bpm: 98, firstBeat: 0.4, steady: true }, { beatsPerBar: 3, confidence: 0.9 }));
    expect(onTempo).toHaveBeenCalledTimes(1);
    expect(result.current.detecting).toBe(false);
    expect(fake.run).toHaveBeenCalledTimes(2);
  });

  it("does not detect during playback", async () => {
    const { result } = renderHook((props: SongAnalysisInput) => useSongAnalysis(props), { initialProps: base({ playing: true }) });
    act(() => result.current.detect());
    act(() => result.current.analyseAgain());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("analyses again through onDetect, so the saved tempo and meter are replaced", async () => {
    const onDetect = vi.fn(() => null);
    const onTempo = vi.fn();
    const { result } = renderHook((props: SongAnalysisInput) => useSongAnalysis(props), { initialProps: base({ onDetect, onTempo }) });
    await waitFor(() => expect(onTempo).toHaveBeenCalledTimes(1));
    act(() => result.current.analyseAgain());
    await waitFor(() => expect(onDetect).toHaveBeenCalledTimes(1));
    expect(onTempo).toHaveBeenCalledTimes(1);
    expect(fake.run).toHaveBeenCalledTimes(2);
  });

  it("reruns a finished song from the start, and does not rerun during playback", async () => {
    const { result, rerender } = renderHook((props: SongAnalysisInput) => useSongAnalysis(props), { initialProps: base() });
    await waitFor(() => expect(result.current.message).toBe("Tempo 98 BPM. Meter 3/4"));
    act(() => result.current.rerun(3));
    await waitFor(() => expect(fake.run).toHaveBeenCalledTimes(2));
    rerender(base({ playing: true }));
    act(() => result.current.rerun(4));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.run).toHaveBeenCalledTimes(2);
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
