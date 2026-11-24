export const SYNTH_PARTS = ["auto", "pad", "moving", "stabs", "pulse", "rest"] as const;
export const SYNTH_PRESET_IDS = ["warm", "bright", "strings", "stab"] as const;
export const SYNTH_BASS_IDS = ["sub", "pumping", "sequenced"] as const;
export type SynthPart = (typeof SYNTH_PARTS)[number];
export type SynthMode = Exclude<SynthPart, "auto" | "rest">;
export type SynthPreset = (typeof SYNTH_PRESET_IDS)[number];
export type SynthBass = (typeof SYNTH_BASS_IDS)[number];
export type Waveform = "saw" | "square" | "sine" | "triangle";

export interface Adsr {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface SynthVoice {
  waves: readonly [Waveform, Waveform];
  blend: number;
  detune: number;
  sub: number;
  noise: number;
  cutoff: number;
  resonance: number;
  filterAmount: number;
  keyTracking: number;
  amp: Adsr;
  filter: Adsr;
  lfo: { wave: "sine" | "triangle"; rate: number; depth: number; target: "cutoff" | "pitch" };
  portamento: number;
  stereo: number;
  pitchDrop?: number;
  gate?: number;
}

const pad: SynthVoice = {
  waves: ["saw", "triangle"], blend: 0.55, detune: 6, sub: 0.08, noise: 0.004,
  cutoff: 1300, resonance: 0.25, filterAmount: 650, keyTracking: 0.35,
  amp: { attack: 0.4, decay: 0.3, sustain: 0.78, release: 0.7 },
  filter: { attack: 0.3, decay: 0.4, sustain: 0.55, release: 0.5 },
  lfo: { wave: "sine", rate: 0.29, depth: 0, target: "cutoff" }, portamento: 0, stereo: 0.56,
};

export const SYNTH_PRESETS: Record<SynthPreset, SynthVoice> = {
  warm: pad,
  bright: { ...pad, waves: ["saw", "saw"], cutoff: 2700, filterAmount: 1400, detune: 8 },
  strings: { ...pad, waves: ["saw", "saw"], cutoff: 1900, detune: 11, amp: { ...pad.amp, attack: 0.58, release: 0.9 },
    lfo: { wave: "sine", rate: 0.34, depth: 0.08, target: "pitch" } },
  stab: { ...pad, waves: ["square", "saw"], cutoff: 1150, resonance: 0.45, filterAmount: 1800,
    amp: { attack: 0.006, decay: 0.12, sustain: 0.68, release: 0.07 }, filter: { ...pad.filter, attack: 0.008, decay: 0.19 } },
};

const sub: SynthVoice = {
  waves: ["sine", "triangle"], blend: 0.18, detune: 0, sub: 0, noise: 0,
  cutoff: 1000, resonance: 0.12, filterAmount: 300, keyTracking: 0.22,
  amp: { attack: 0.007, decay: 0.12, sustain: 0.86, release: 0.05 },
  filter: { attack: 0.007, decay: 0.16, sustain: 0.45, release: 0.04 },
  lfo: { wave: "triangle", rate: 0.5, depth: 0, target: "cutoff" },
  portamento: 0.055, stereo: 0, pitchDrop: 2.8,
};

export const SYNTH_BASS_VOICES: Record<SynthBass, SynthVoice> = {
  sub,
  pumping: { ...sub, waves: ["saw", "triangle"], blend: 0.32, sub: 0.15, cutoff: 660, filterAmount: 580,
    resonance: 0.26, portamento: 0, pitchDrop: 0 },
  sequenced: { ...sub, waves: ["square", "square"], blend: 0.28, detune: 3, sub: 0.15, cutoff: 530,
    filterAmount: 1900, resonance: 0.36, portamento: 0.035, pitchDrop: 0, gate: 0.68, amp: { ...sub.amp, release: 0.025 } },
};
