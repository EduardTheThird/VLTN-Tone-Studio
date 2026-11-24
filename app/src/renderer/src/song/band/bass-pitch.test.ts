// Checks that the bundled bass samples sound at the note their map.json root names, and that renderPart plays other notes at the right
// pitch. The check runs offline on the real FLAC files, decoded with the same codec the app uses.
//
// Read the pitch after the attack and before the short bundled recordings' tail fade.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeFlac } from "@shared/flac";
import type { PcmAudio } from "../types";
import { renderPart, RENDER_RATE } from "./render";
import { SAMPLE_MAP, sampleSetFrom, type SampleSet } from "./samples";

const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), "samples");
const CENTS_TOLERANCE = 15;
const SETTLED_FROM_SECONDS = 0.40;
const SETTLED_TO_SECONDS = 0.64;
/** Notes that the renderer must place: below the lowest root, between roots, and up to G3. */
const RENDER_NOTES = [23, 26, 28, 31, 33, 36, 41, 45, 48, 55];

/** Equal-tempered frequency of a MIDI note, with A4 at 440 Hz. */
const hertz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
const centsBetween = (measured: number, target: number): number => 1200 * Math.log2(measured / target);

/**
 * The fundamental by YIN (de Cheveigné and Kawahara, 2002): the first lag whose cumulative mean normalised difference drops under 0.1,
 * refined by a parabola. The lag is searched only from 0.7 to 1.4 times the expected pitch, so the octave errors that YIN makes on a
 * decaying tone cannot pass as a valid reading.
 */
function measureHertz(samples: ArrayLike<number>, sampleRate: number, expected: number): number {
  const tauMin = Math.floor(sampleRate / (1.4 * expected));
  const tauMax = Math.ceil(sampleRate / (0.7 * expected));
  const span = samples.length - tauMax;
  const difference = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < span; j++) {
      const delta = samples[j] - samples[j + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }
  const normalised = new Float64Array(tauMax + 1);
  normalised[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += difference[tau];
    normalised[tau] = running > 0 ? (difference[tau] * tau) / running : 1;
  }
  let best = tauMin;
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (normalised[tau] < 0.1) {
      best = tau;
      while (best + 1 < tauMax && normalised[best + 1] < normalised[best]) best++;
      break;
    }
  }
  if (normalised[best] >= 0.1) for (let tau = tauMin; tau <= tauMax; tau++) if (normalised[tau] < normalised[best]) best = tau;
  const before = normalised[best - 1],
    at = normalised[best],
    after = normalised[best + 1];
  const curvature = before - 2 * at + after;
  const shift = curvature !== 0 ? (0.5 * (before - after)) / curvature : 0;
  return sampleRate / (best + Math.max(-0.5, Math.min(0.5, shift)));
}

/** The settled pitch of a mono segment, in cents from the target note. */
function settledCents(audio: PcmAudio, midi: number): number {
  const rate = audio.sampleRate;
  const segment = audio.channels[0].subarray(Math.round(SETTLED_FROM_SECONDS * rate), Math.round(SETTLED_TO_SECONDS * rate));
  return centsBetween(measureHertz(segment, rate, hertz(midi)), hertz(midi));
}

describe("bass samples are in tune", () => {
  const decoded = new Map<string, PcmAudio>();
  const roots = Object.values(SAMPLE_MAP.bassSounds!).flatMap((instrument) => instrument.notes);
  const checks = roots.map(({ root, layers }) => [layers[1].files[0], root, layers[1].cents?.[0] ?? 0] as const);

  beforeAll(async () => {
    for (const { layers } of roots) {
      for (const layer of layers) for (const file of layer.files) {
        const bytes = new Uint8Array(readFileSync(join(SAMPLES, file)));
        decoded.set(file, await decodeFlac(bytes));
      }
    }
  });

  it.each(checks)("%s sounds at its root (MIDI %i) after tuning by %f cents", (file, root, measuredOffset) => {
    const cents = settledCents(decoded.get(file)!, root);
    expect(Math.abs(cents - measuredOffset)).toBeLessThanOrEqual(CENTS_TOLERANCE);
  });

  it("reads a sample at its own sample rate, not the output rate, and moves it in the right direction", () => {
    // A 48 kHz tone at the root of F2 (41), rendered at 44.1 kHz: a note a fifth up must come out a fifth up, not down or at 44.1 kHz pitch.
    const sourceRate = 48000;
    const tone = new Float32Array(Math.round(3 * sourceRate));
    for (let i = 0; i < tone.length; i++) tone[i] = Math.sin((2 * Math.PI * hertz(41) * i) / sourceRate);
    const set: SampleSet = { drums: new Map(), bass: [{ root: 41, layer: "p", velocity: [1, 127], audio: { sampleRate: sourceRate, channels: [tone] } }] };
    const length = Math.round(2.5 * RENDER_RATE);
    for (const midi of [41, 48]) {
      const { audio } = renderPart([{ time: 0, pitch: midi, velocity: 90, duration: 2 }], "bass", set, length);
      expect(Math.abs(settledCents(audio, midi)), `MIDI ${midi}`).toBeLessThanOrEqual(CENTS_TOLERANCE);
    }
  });

  it.each(["fingers", "pick"] as const)("renders each note at its pitch from the nearest %s root", (bank) => {
    const set: SampleSet = sampleSetFrom(SAMPLE_MAP, "standard", (file) => decoded.get(file) ?? { sampleRate: RENDER_RATE, channels: [new Float32Array(1)] }, bank);
    for (const midi of RENDER_NOTES) {
      const length = Math.round(2.5 * RENDER_RATE);
      const { audio } = renderPart([{ time: 0, pitch: midi, velocity: 65, duration: 2 }], "bass", set, length);
      const cents = settledCents(audio, midi);
      expect(Math.abs(cents), `MIDI ${midi}`).toBeLessThanOrEqual(CENTS_TOLERANCE);
    }
  });
});
