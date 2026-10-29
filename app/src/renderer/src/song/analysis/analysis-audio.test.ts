import { describe, expect, it } from "vitest";
import type { PcmAudio, Stems } from "../types";
import { buildAnalysisAudio } from "./analysis-audio";

const tone = (level = 0.5): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(4410).fill(level)] });
const silence = (): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(4410)] });
const input = { beatsPerBar: 4, chordChanges: [1.5] };

describe("buildAnalysisAudio", () => {
  it("analyses the mix when the song was not split", () => {
    const mix = tone();
    const audio = buildAnalysisAudio({ ...input, mix, stems: null, chordName: "" });
    expect(audio.sources).toEqual([mix]);
    expect(audio.keySource).toEqual({ name: "original mix", audio: mix });
    expect(audio.chordSource).toBeNull();
    expect(audio.stems).toBeNull();
    expect(audio.sampleRate).toBe(44100);
    expect(audio.beatsPerBar).toBe(4);
    expect(audio.chordChanges).toEqual([1.5]);
  });

  it("tracks the beat from the drums when the song has them", () => {
    const drums = tone(0.3);
    const stems: Stems = { drums, guitar: tone(0.2) };
    expect(buildAnalysisAudio({ ...input, mix: tone(), stems, chordName: "" }).sources).toEqual([drums]);
  });

  it("reads the key from the first stem with a signal, in the key order", () => {
    const guitar = tone(0.2);
    const stems: Stems = { bass: tone(0.4), guitar, vocals: tone(0.1) };
    expect(buildAnalysisAudio({ ...input, mix: tone(), stems, chordName: "" }).keySource).toEqual({ name: "guitar", audio: guitar });
  });

  it("skips a silent stem when it reads the key", () => {
    const bass = tone(0.4);
    const stems: Stems = { guitar: silence(), bass };
    expect(buildAnalysisAudio({ ...input, mix: tone(), stems, chordName: "" }).keySource).toEqual({ name: "bass", audio: bass });
  });

  it("reads the chords from the chosen stem", () => {
    const guitar = tone(0.2);
    const stems: Stems = { guitar, other: tone(0.2) };
    expect(buildAnalysisAudio({ ...input, mix: tone(), stems, chordName: "guitar" }).chordSource).toEqual({ name: "guitar", audio: guitar });
  });

  it("gives no chord source when the chosen stem is not in the song", () => {
    const stems: Stems = { guitar: tone(0.2) };
    expect(buildAnalysisAudio({ ...input, mix: tone(), stems, chordName: "piano" }).chordSource).toBeNull();
  });
});
