import { describe, expect, it, vi } from "vitest";
import type { AnalysisAudio } from "./song-analysis";
import { lyricsStep } from "./steps";

const transcribe = vi.hoisted(() => vi.fn());
vi.mock("../performance/lyrics-run", () => ({ transcribeLyrics: transcribe }));

const options = { model: "base" as const, quality: "fast" as const, language: "auto" as const };
const pcm = { sampleRate: 44100, channels: [new Float32Array(10)] };
const audioWith = (vocals: typeof pcm | undefined) => ({ stems: vocals ? { vocals } : null }) as unknown as AnalysisAudio;

describe("lyricsStep", () => {
  it("does nothing without a vocals stem", async () => {
    const onText = vi.fn();
    await lyricsStep({ options, onText }).run(audioWith(undefined), new AbortController().signal, { audioId: "a", version: 2 });
    expect(transcribe).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
  });

  it("transcribes the vocals and reports the text", async () => {
    transcribe.mockResolvedValueOnce({ text: "[00:01.00] Hold on", placed: 0 });
    const onText = vi.fn();
    const signal = new AbortController().signal;
    await lyricsStep({ options, onText }).run(audioWith(pcm), signal, { audioId: "a", version: 2 });
    expect(transcribe).toHaveBeenCalledWith({ audio: pcm, options, pasted: undefined, signal });
    expect(onText).toHaveBeenCalledWith("[00:01.00] Hold on");
  });

  it("reports nothing when no words were heard", async () => {
    transcribe.mockResolvedValueOnce({ text: "", placed: 0 });
    const onText = vi.fn();
    await lyricsStep({ options, onText }).run(audioWith(pcm), new AbortController().signal, { audioId: "a", version: 2 });
    expect(onText).not.toHaveBeenCalled();
  });
});
