import { expect, it } from "vitest";
import { parseChordName } from "./harmony";
import { KEYS_RANGE, leftHand, rightHand } from "./keys-voicing";
import { DEFAULT_KEYS, KEYS_REGISTERS } from "./keys-types";

it("keeps close inversions and common tones across a four-chord progression", () => {
  const settings = { ...DEFAULT_KEYS, voices: 4 as const };
  let previous: number[] = [];
  for (const name of ["C", "Am", "F", "G"]) {
    const voicing = rightHand(parseChordName(name)!, settings, previous);
    expect(voicing).toHaveLength(4);
    if (previous.length) {
      expect(Math.max(...voicing.map((pitch, i) => Math.abs(pitch - previous[i])))).toBeLessThanOrEqual(4);
      if (name !== "G") expect(voicing.some((pitch) => previous.includes(pitch))).toBe(true);
    }
    previous = voicing;
  }
});

it("uses the slash bass in the left hand and respects extensions and each register", () => {
  expect(leftHand(parseChordName("D/F#")!, "root")[0] % 12).toBe(6);
  for (const register of KEYS_REGISTERS) {
    const [low, high] = KEYS_RANGE[register];
    const triad = rightHand(parseChordName("Cmaj7")!, { ...DEFAULT_KEYS, register, extensions: false, voices: 4 });
    expect(triad.every((note) => note >= low && note <= high)).toBe(true);
    expect(new Set(triad.map((note) => note % 12))).toEqual(new Set([0, 4, 7]));
    const seventh = rightHand(parseChordName("Cmaj7")!, { ...DEFAULT_KEYS, register, voices: 4 });
    expect(seventh.some((note) => note % 12 === 11)).toBe(true);
  }
});
