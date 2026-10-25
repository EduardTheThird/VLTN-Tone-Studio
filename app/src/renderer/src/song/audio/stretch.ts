import { SimpleFilter, SoundTouch } from "soundtouchjs";
import { clampCents, clampRate, clampSemitones, pitchRatio } from "../performance/speed";
import type { PcmAudio } from "../types";

// Offline time-stretch and pitch shift for one stem (pure). A song at rate `r` plays one song second in 1 / r seconds, so the
// stretched stem has `stretchedLength(frames, r)` frames, and its pitch moves by semitones and cents without changing its length.
// The whole stem is rendered once, before it plays, so playback itself does no DSP and cannot run out of CPU mid-song.
//
// The engine is SoundTouch (soundtouchjs, LGPL-2.1). It is WSOLA-based: a sustained tone keeps its pitch and length, but a sharp
// transient can move by tens of milliseconds at a rate other than 1. Measured with a click train (see the test file): under 1.2 ms
// at rate 1 with no shift, up to about 45 ms at 50% or 150%, and up to about 16 ms with a +3 semitone shift. Clicks and cues are
// placed on song time, so that error is the audio's own, not a timing error in the scheduler.

const BLOCK_FRAMES = 4096;

/** Output frames for `frames` input frames played at `rate`. */
export function stretchedLength(frames: number, rate: number): number {
  return Math.round(frames / clampRate(rate));
}

export interface StretchSettings {
  /** Playback rate, 0.5 to 1.5 (see speed.ts) */
  rate: number;
  /** Whole semitones to shift the pitch by */
  semitones: number;
  /** Fine tune in cents, added to the semitones */
  cents: number;
}

/**
 * Renders one stem at `settings`. Mono stays mono; stereo keeps both channels. Silence after the end of the input is fed through
 * the engine so its last samples come out, and the output stops at the stretched length.
 */
export function stretchPcm(pcm: PcmAudio, settings: StretchSettings): PcmAudio {
  const rate = clampRate(settings.rate);
  const input = pcm.channels;
  const frames = input[0].length;
  const left = input[0],
    right = input[1] ?? input[0];
  const source = {
    extract(target: Float32Array, numFrames: number, position: number): number {
      for (let i = 0; i < numFrames; i++) {
        const at = position + i;
        target[i * 2] = at < frames ? left[at] : 0;
        target[i * 2 + 1] = at < frames ? right[at] : 0;
      }
      return numFrames;
    },
  };
  const shifter = new SoundTouch();
  shifter.tempo = rate;
  shifter.pitch = pitchRatio(clampSemitones(settings.semitones), clampCents(settings.cents));
  const filter = new SimpleFilter(source, shifter);

  const length = stretchedLength(frames, rate);
  const out = [new Float32Array(length), new Float32Array(length)];
  const block = new Float32Array(BLOCK_FRAMES * 2);
  for (let done = 0; done < length; ) {
    const wanted = Math.min(BLOCK_FRAMES, length - done);
    const got = filter.extract(block, wanted);
    if (!got) break;
    for (let i = 0; i < got; i++) {
      out[0][done + i] = block[i * 2];
      out[1][done + i] = block[i * 2 + 1];
    }
    done += got;
  }
  return { sampleRate: pcm.sampleRate, channels: input.length > 1 ? out : [out[0]] };
}
