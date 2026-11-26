import type { PcmAudio } from "../types";
import { BAND_PARTS, type BandPart } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { loudnessOf, matchLoudness } from "./level";
import { barStarts } from "./timing";

/** Start two bars before the boundary, or at the pickup when fewer bars are available. */
export function transitionStart(grid: BeatGrid, boundary: number): number {
  const before = barStarts(grid).filter((index) => grid.beats[index] < boundary - 1e-6);
  return before.length >= 2 ? grid.beats[before[before.length - 2]] : 0;
}

type Parts = Partial<Record<BandPart, PcmAudio>>;

/** Compare the same part of the recording. The worker's proposed parts are already cut to the window. */
export function auditionMix(
  song: PcmAudio,
  start: number,
  end: number,
  original: Parts = {},
  replacement: Parts = {},
  replacementStart = start,
): PcmAudio {
  const first = Math.max(0, Math.round(start * song.sampleRate));
  const frames = Math.max(1, Math.round((end - start) * song.sampleRate));
  const replacementFrame = Math.max(0, Math.round(replacementStart * song.sampleRate));
  const reference = { sampleRate: song.sampleRate, channels: song.channels.map((channel) => channel.slice(first, first + frames)) };
  const audible = BAND_PARTS.filter((part) => replacement[part]?.sampleRate === song.sampleRate);
  const target = { lufs: Math.min(-18, loudnessOf(reference)) };
  if (!audible.length) return matchLoudness(reference, target).audio;
  const channels = reference.channels.map((channel, index) => {
    const mixed = channel.slice();
    for (const part of audible) {
      const audio = replacement[part]!;
      const take = audio.channels[Math.min(index, audio.channels.length - 1)];
      const stem = original[part];
      const old = stem?.channels[Math.min(index, stem.channels.length - 1)];
      if (!take) continue;
      for (let i = 0; i < mixed.length && i + replacementFrame < take.length; i++) {
        mixed[i] += take[i + replacementFrame] - (old?.[first + i] ?? 0);
      }
    }
    return mixed;
  });
  const mix = { sampleRate: song.sampleRate, channels };
  return matchLoudness(mix, Number.isFinite(target.lufs) ? target : { lufs: -18 }).audio;
}
