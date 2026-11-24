import type { PcmAudio } from "../types";
import { KICK, type NoteEvent } from "./note";
import { SYNTH_BASS_VOICES, SYNTH_PRESETS, type Adsr, type SynthBass, type SynthPreset, type SynthVoice, type Waveform } from "./synth-presets";

const TABLE = 2048;
const MASK = TABLE - 1;
const TAU = Math.PI * 2;
const waves: Record<Waveform, Float32Array> = {
  sine: Float32Array.from({ length: TABLE }, (_, i) => Math.sin(TAU * i / TABLE)),
  triangle: Float32Array.from({ length: TABLE }, (_, i) => 1 - 4 * Math.abs(i / TABLE - 0.5)),
  saw: Float32Array.from({ length: TABLE }, (_, i) => 2 * i / TABLE - 1),
  square: Float32Array.from({ length: TABLE }, (_, i) => i < TABLE / 2 ? 1 : -1),
};

export function envelopeAt(seconds: number, hold: number, env: Adsr): number {
  const at = Math.min(seconds, hold);
  const level = at < env.attack ? at / env.attack :
    at < env.attack + env.decay ? 1 - (1 - env.sustain) * (at - env.attack) / env.decay : env.sustain;
  if (seconds < hold) return level;
  return env.release <= 0 ? 0 : level * Math.max(0, 1 - (seconds - hold) / env.release);
}

export function glidePitch(seconds: number, from: number, to: number, duration: number): number {
  return duration > 0 && seconds < duration ? from + (to - from) * seconds / duration : to;
}

interface RenderOptions {
  preset: SynthPreset;
  bass?: SynthBass;
  kicks?: readonly NoteEvent[];
  seed: number;
  rate: number;
  voice?: SynthVoice;
}

function voiceFor(note: NoteEvent, options: RenderOptions): SynthVoice {
  if (options.voice) return options.voice;
  const mode = note.synthMode;
  if (options.bass) return SYNTH_BASS_VOICES[options.bass];
  const voice = SYNTH_PRESETS[options.preset];
  if (mode === "moving") return { ...voice, lfo: { rate: 0.32, depth: 0.54, target: "cutoff", wave: "triangle" } };
  if (mode === "stabs" || mode === "pulse") {
    const short = SYNTH_PRESETS.stab;
    return { ...voice, amp: short.amp, filter: short.filter };
  }
  return voice;
}

/** Add one oscillator pair and a two-pole low-pass, with cutoff and pitch modulation updated every block. */
function mixNote(left: Float32Array, right: Float32Array, note: NoteEvent, voice: SynthVoice, rate: number, index: number, seed: number, previous?: NoteEvent): void {
  const first = Math.max(0, Math.round(note.time * rate));
  const amp = note.dead ? { attack: 0.002, decay: 0.03, sustain: 0.5, release: 0.016 } : voice.amp;
  const hold = note.dead ? Math.min(note.duration, 0.045) : note.duration * (voice.gate ?? 1);
  const frames = Math.min(left.length - first, Math.ceil((hold + amp.release) * rate));
  const root = 440 * Math.pow(2, (note.pitch - 69) / 12);
  const from = note.slideFrom !== undefined ? note.pitch - note.slideFrom :
    note.articulation === "legato" && previous && previous.time + previous.duration >= note.time - 0.02 ? previous.pitch : note.pitch;
  const portamento = note.slideFrom !== undefined ? Math.max(0.04, voice.portamento) : voice.portamento;
  const waveA = waves[voice.waves[0]], waveB = waves[voice.waves[1]];
  const lfo = waves[voice.lfo.wave];
  const gain = Math.pow(note.velocity / 127, 1.25) * (voice.stereo ? 0.26 : 0.62);
  const tracking = Math.pow(root / 440, voice.keyTracking);
  const detune = Math.pow(2, voice.detune / 1200);
  const aGain = 1 - voice.blend;
  const spread = voice.stereo;
  const q = 1.35 - voice.resonance;
  const releaseLevel = envelopeAt(hold, hold + 1, amp);
  let a = 0, b = TABLE / 4, sub = 0;
  let l1 = 0, l2 = 0, r1 = 0, r2 = 0;
  let stepA = 0, stepB = 0, stepSub = 0, g = 0, h = 0;
  let noise = (seed ^ Math.imul(index + 1, 0x9e3779b1)) || 1;
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    if ((i & 15) === 0) {
      const mod = lfo[(t * voice.lfo.rate * TABLE) & MASK] * voice.lfo.depth;
      const drop = voice.pitchDrop ? voice.pitchDrop * Math.max(0, 1 - t / 0.042) : 0;
      const pitch = glidePitch(t, from, note.pitch, portamento) + drop + (voice.lfo.target === "pitch" ? mod : 0);
      const frequency = pitch === note.pitch ? root : 440 * Math.pow(2, (pitch - 69) / 12);
      stepA = TABLE * frequency / rate / detune;
      stepB = TABLE * frequency / rate * detune;
      stepSub = TABLE * frequency / (2 * rate);
      const cutoff = note.dead ? 230 : (voice.cutoff + voice.filterAmount * envelopeAt(t, hold, voice.filter)) * tracking *
        (voice.lfo.target === "cutoff" ? 1 + mod : 1);
      g = Math.tan(Math.PI * Math.max(35, Math.min(rate * 0.38, cutoff)) / rate);
      h = 1 / (1 + g * (g + q));
    }
    let hiss = 0;
    if (voice.noise) {
      noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5;
      hiss = ((noise >>> 0) / 0x80000000 - 1) * voice.noise;
    }
    const low = waves.sine[sub & MASK] * voice.sub + hiss;
    const firstOsc = waveA[a & MASK] * aGain, secondOsc = waveB[b & MASK] * voice.blend;
    a += stepA; b += stepB; sub += stepSub;
    const env = t < amp.attack && t < hold ? t / amp.attack : t >= hold
      ? (amp.release > 0 ? releaseLevel * Math.max(0, 1 - (t - hold) / amp.release) : 0)
      : t < amp.attack + amp.decay ? 1 - (1 - amp.sustain) * (t - amp.attack) / amp.decay : amp.sustain;
    const level = env * gain;
    const mid = firstOsc + secondOsc + low;
    const side = spread * (firstOsc - secondOsc);
    const vl = (l1 + g * (mid + side - l2)) * h;
    const outL = l2 + g * vl;
    l1 = 2 * vl - l1;
    l2 = 2 * outL - l2;
    left[first + i] += outL * level;
    if (spread) {
      const vr = (r1 + g * (mid - side - r2)) * h;
      const outR = r2 + g * vr;
      r1 = 2 * vr - r1;
      r2 = 2 * outR - r2;
      right[first + i] += outR * level;
    } else right[first + i] += outL * level;
  }
}

export const DUCK_SECONDS = 0.12;
const DUCK_GAIN = 10 ** (-6 / 20);
function duckOnKicks(channels: Float32Array[], kicks: readonly NoteEvent[], rate: number): void {
  const recovery = Math.round(DUCK_SECONDS * rate);
  const positions = kicks.filter((note) => note.pitch === KICK).map((note) => Math.max(0, Math.round(note.time * rate)));
  positions.forEach((start, k) => {
    const end = Math.min(channels[0].length, start + recovery, positions[k + 1] ?? Infinity);
    for (let i = start; i < end; i++) {
      const gain = DUCK_GAIN + (1 - DUCK_GAIN) * (i - start) / recovery;
      for (const pcm of channels) pcm[i] *= gain;
    }
  });
}

/** Deterministic stereo pads and dual-mono bass. The synth has no sample or model dependencies. */
export function renderSynth(notes: readonly NoteEvent[], frames: number, options: RenderOptions): PcmAudio {
  const [left, right] = [new Float32Array(frames), new Float32Array(frames)];
  notes.forEach((note, index) => mixNote(left, right, note, voiceFor(note, options), options.rate, index, options.seed, notes[index - 1]));
  const channels = [left, right];
  if (options.bass === "pumping" && options.kicks) duckOnKicks(channels, options.kicks, options.rate);
  let peak = 0;
  for (const pcm of channels) for (const value of pcm) peak = Math.max(peak, Math.abs(value));
  const ceiling = 10 ** (-1 / 20);
  if (peak > ceiling) for (const pcm of channels) for (let i = 0; i < pcm.length; i++) pcm[i] *= ceiling / peak;
  return { channels, sampleRate: options.rate };
}
