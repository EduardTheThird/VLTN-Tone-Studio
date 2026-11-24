import { expect, it } from "vitest";
import { KICK, type NoteEvent } from "./note";
import { SYNTH_PRESETS, type SynthVoice } from "./synth-presets";
import { DUCK_SECONDS, envelopeAt, glidePitch, renderSynth } from "./synth";
import { generateSynth } from "./synth-notes";
import { DEFAULT_BAND_SETTINGS, planSections, type BandSettings } from "./arrangement";
import { fixedBeatGrid } from "./beat-grid";
import { parseChordName } from "./harmony";

const rate = 44100;
const opts = { rate, preset: "warm" as const, seed: 5 };
const duration = 1;
const note: NoteEvent = { time: 0, pitch: 69, velocity: 60, duration };

function bandPower(samples: Float32Array, hz: number, from = 0.35, seconds = 0.25): number {
  let real = 0;
  let imag = 0;
  for (let i = Math.ceil(from * rate); i < Math.ceil((from + seconds) * rate); i++) {
    const phase = 2 * Math.PI * hz * i / rate;
    real += Math.cos(phase) * samples[i];
    imag += Math.sin(phase) * samples[i];
  }
  return real ** 2 + imag ** 2;
}

it("puts a saw's strongest harmonic at 440 Hz and reduces the high harmonics with its two-pole filter", () => {
  const voice: SynthVoice = {
    ...SYNTH_PRESETS.warm, waves: ["saw", "saw"], blend: 0, sub: 0, noise: 0, detune: 0, cutoff: 12000,
    filterAmount: 0, keyTracking: 0, stereo: 0,
  };
  const raw = renderSynth([note], rate, { ...opts, voice }).channels[0];
  const filtered = renderSynth([note], rate, { ...opts, voice: { ...voice, cutoff: 500 } }).channels[0];
  const fundamental = bandPower(raw, 440);
  expect(fundamental).toBeGreaterThan(bandPower(raw, 880));
  expect(fundamental).toBeGreaterThan(bandPower(raw, 220) * 100);
  const highHarmonic = 440 * 9;
  expect(10 * Math.log10(bandPower(filtered, highHarmonic) / bandPower(raw, highHarmonic))).toBeLessThan(-20);
});

it("uses exact ADSR, glide and duck timing", () => {
  const env = { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 };
  expect(envelopeAt(0.01, 1, env)).toBeCloseTo(1);
  expect(envelopeAt(0.11, 1, env)).toBeCloseTo(0.5);
  expect(envelopeAt(1.1, 1, env)).toBeCloseTo(0.25);
  expect(envelopeAt(1.201, 1, env)).toBe(0);
  expect(glidePitch(0.025, 48, 60, 0.05)).toBe(54);
  expect(glidePitch(0.05, 48, 60, 0.05)).toBe(60);
  const options = { ...opts, bass: "pumping" as const };
  const clean = renderSynth([note], rate, options).channels[0];
  const kick = { ...note, pitch: KICK, time: 0.4 };
  const ducked = renderSynth([note], rate, { ...options, kicks: [kick] }).channels[0];
  const ix = Math.round(0.4 * rate);
  expect(ducked[ix] / clean[ix]).toBeCloseTo(10 ** (-6 / 20), 5);
  const recovered = Math.round((0.4 + DUCK_SECONDS) * rate);
  expect(ducked[recovered]).toBe(clean[recovered]);
  expect(ducked.slice(0, ix)).toEqual(clean.slice(0, ix));
});

it("puts Auto pads in the chorus, holds each chord and makes Pulse play half-beats", () => {
  const grid = fixedBeatGrid(120, 0, 4, 8);
  const parts = { drums: false, bass: false, synth: true };
  const settings: BandSettings = { ...DEFAULT_BAND_SETTINGS, parts, ending: { kind: "none" } };
  const harmony = grid.beats.map((time, beat) => ({ time, beat, chord: parseChordName(beat < 12 ? "C" : "Am") }));
  const sections = [{ id: "v", name: "Verse", start: 0, end: 4, mode: "continue" as const },
    { id: "c", name: "Chorus", start: 4, end: 8, mode: "continue" as const }];
  const plans = planSections(sections, 8, settings);
  const notes = generateSynth(grid, harmony, plans, settings, 3);
  expect([...new Set(notes.map((event) => event.time))]).toEqual([4, 6]);
  expect(notes.every((event) => event.duration === 2)).toBe(true);
  const pulse = generateSynth(grid, harmony, [plans[0], { ...plans[1], synthPart: "pulse" }], settings, 3);
  expect(pulse.some((event) => event.time === 4.25)).toBe(true);
  expect(pulse.every((event) => event.duration <= 0.155)).toBe(true);
  const a = renderSynth([{ ...note, synthMode: "moving" }], rate, opts);
  const b = renderSynth([{ ...note, synthMode: "moving" }], rate, opts);
  expect(a.channels).toEqual(b.channels);
  expect(a.channels[0]).not.toEqual(a.channels[1]);
});

it("renders a five-minute four-voice pad within a bounded time", () => {
  const notes = Array.from({ length: 75 }, (_, bar) => [48, 55, 60, 64].map((pitch) => ({ ...note, pitch, time: bar * 4, duration: 4 }))).flat();
  const started = performance.now();
  const rendered = renderSynth(notes, 300 * rate, opts);
  const ms = performance.now() - started;
  if (process.env.SYNTH_BENCH) console.log(`Five-minute synth pad ${ms.toFixed(0)} ms`);
  expect(rendered.channels[0]).toHaveLength(300 * rate);
  expect(ms).toBeLessThan(9000);
}, 12000);
