import { ENERGIES, type Energy, type Meter, type StyleId } from "./types";
import type { KeysInstrument } from "../keys-types";

export interface KeysPattern {
  left: number[];
  right: number[];
  gate: number;
}

const ORGAN: StyleId[] = ["rock", "metal", "shuffle", "reggae", "half-time"];
export function defaultKeysInstrument(style: StyleId): KeysInstrument {
  return ORGAN.includes(style) ? "organ" : style === "funk" ? "wurlitzer" : "piano";
}

export function keysPatterns(id: StyleId, { stepsPerBeat: step, beatsPerBar }: Meter): Record<Energy, KeysPattern[]> {
  const beats = Array.from({ length: beatsPerBar }, (_, i) => i * step);
  const offbeat = Math.ceil(step / 2);
  const half = beats.filter((_, i) => i % 2 === 0);
  const last = beats.at(-1)! + offbeat;
  const even = id === "reggae" ? beats.map((value) => value + offbeat) : id === "funk" ? [offbeat, ...half.slice(1), last] : half;
  const patterns: Record<Energy, KeysPattern[]> = {
    1: [{ left: [0], right: [0], gate: 1 }, { left: [0], right: [0], gate: 0.9 }],
    2: [{ left: [0], right: id === "reggae" ? even : half, gate: 0.8 }, { left: [0], right: [0, last], gate: 0.74 }],
    3: [{ left: half, right: even, gate: id === "reggae" ? 0.3 : 0.72 }, { left: [0], right: [...even, last], gate: 0.65 }],
    4: [{ left: half, right: beats.flatMap((value) => [value, value + offbeat]), gate: 0.62 }, { left: beats, right: [...even, last], gate: 0.55 }],
    5: [{ left: beats, right: beats.flatMap((value) => [value, value + offbeat]), gate: 0.75 }, { left: half, right: [...beats, last], gate: 0.5 }],
  };
  for (const energy of ENERGIES) for (const pattern of patterns[energy]) pattern.right = [...new Set(pattern.right)].sort((a, b) => a - b);
  return patterns;
}
