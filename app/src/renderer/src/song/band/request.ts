// Builds what the band worker needs from the song: the beat sources, the harmony and plans, and the preview mix. Pure: the Band panel
// passes in the song's values and the sample URLs, and gets back plain data.

import type { Cue } from "../performance/chart";
import type { Chord } from "../performance/chords";
import type { Section } from "../performance/sections";
import type { PcmAudio, Stems } from "../types";
import { planSections, type BandSettings } from "./arrangement";
import type { BandRequest, BandResult } from "./band-job";
import type { BeatGrid } from "./beat-grid";
import { chartChordEvents, harmonyForSong } from "./harmony";

/**
 * The audio the beat tracker reads. The drums stem when there is one. Otherwise the pitched stems (everything but drums and vocals,
 * since voices smear the onsets), and otherwise the song's own mix.
 */
export function beatSources(stems: Stems | null, mix: PcmAudio): PcmAudio[] {
  if (stems?.drums) return [stems.drums];
  const pitched = Object.entries(stems ?? {})
    .filter((entry): entry is [string, PcmAudio] => entry[1] !== undefined && entry[0] !== "drums" && entry[0] !== "vocals")
    .map(([, audio]) => audio);
  return pitched.length ? pitched : [mix];
}

/** The chord change times the chart gives, in song seconds. Used to pick the bar phase when the beat is found. */
export function chartChordTimes(cues: readonly Cue[]): number[] {
  return chartChordEvents(cues).map((event) => event.time);
}

export interface BandInputs {
  grid: BeatGrid;
  cues: readonly Cue[];
  chords: readonly Chord[];
  sections: readonly Section[];
  settings: BandSettings;
  /** The song's length in seconds, at the song's own rate. */
  songEnd: number;
  /** The song's length in samples. The parts are rendered to exactly this length. */
  lengthFrames: number;
  sampleUrls: Record<string, string>;
}

/** The request for the whole song: the harmony snapped to the grid, the plans from the sections, and the settings' seed. */
export function bandRequest(input: BandInputs): BandRequest {
  const harmony = harmonyForSong(input.grid, [...input.cues], [...input.chords], input.songEnd);
  return {
    grid: input.grid,
    harmony,
    plans: planSections(input.sections, input.songEnd, input.settings),
    settings: input.settings,
    seed: input.settings.seed,
    lengthFrames: input.lengthFrames,
    parts: { ...input.settings.parts },
    sampleUrls: input.sampleUrls,
  };
}

/**
 * The song from `fromTime` with the rendered parts added on top, for a listening preview. The parts share the song's rate (the song is decoded to 44.1 kHz), and
 * the window is as long as the parts. Samples past the end of the song are silence. The sum is held to −1 to 1.
 */
export function previewMix(song: PcmAudio, fromTime: number, result: BandResult): PcmAudio {
  const parts = [result.drums, result.bass].filter((part): part is PcmAudio => part !== undefined);
  const frames = parts.reduce((longest, part) => Math.max(longest, part.channels[0]?.length ?? 0), 0);
  const first = Math.max(0, Math.round(fromTime * song.sampleRate));
  const channels = song.channels.map((channel, c) => {
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const sample = channel[first + i];
      if (sample !== undefined) out[i] = sample;
    }
    for (const part of parts) {
      const source = part.channels[Math.min(c, part.channels.length - 1)];
      for (let i = 0; i < frames && i < source.length; i++) out[i] += source[i];
    }
    for (let i = 0; i < frames; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
    return out;
  });
  return { sampleRate: song.sampleRate, channels };
}
