import { expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, parseBandSettings, planSections, type BandSettings } from "./arrangement";
import { fixedBeatGrid } from "./beat-grid";
import { parseChordName } from "./harmony";
import { leftHand, rightHand } from "./keys-voicing";
import { generateKeys } from "./keys";
import { ENERGIES, STYLES } from "./styles";

it("keeps keys off in saved songs and accepts their controls when present", () => {
  expect(parseBandSettings({ parts: { drums: true, bass: true } }).parts.keys).toBeFalsy();
  const saved = parseBandSettings({ parts: { drums: false, bass: false, keys: true }, keys: { sound: "grand", left: "root-fifth", voices: 4, extensions: false, register: "high" }, sections: { verse: { keysPart: "stabs", keysOctave: -1 } } });
  expect(saved.parts.keys).toBe(true);
  expect(saved.keys).toEqual({ sound: "grand", left: "root-fifth", voices: 4, extensions: false, register: "high" });
  expect(saved.sections.verse).toEqual({ keysPart: "stabs", keysOctave: -1 });
});

it("has playable keys rhythms at every energy", () => {
  for (const style of Object.values(STYLES)) {
    const steps = style.meter.beatsPerBar * style.meter.stepsPerBeat;
    for (const energy of ENERGIES) {
      const patterns = style.keys[energy];
      expect(patterns.length).toBeGreaterThanOrEqual(2);
      for (const pattern of patterns) expect([...pattern.left, ...pattern.right].every((step) => step >= 0 && step < steps)).toBe(true);
    }
  }
});

it("generates repeatably, respects a marked stop and plays the last held chord", () => {
  const grid = fixedBeatGrid(120, 0, 4, 8);
  const harmony = grid.beats.map((time, beat) => ({ time, beat, chord: parseChordName(beat < 8 ? "C" : "Am") }));
  const settings: BandSettings = {
    ...DEFAULT_BAND_SETTINGS, parts: { drums: false, bass: false, keys: true },
    marks: [{ time: 2, kind: "stop", beats: 4 }], ending: { kind: "hold" }, style: "pop",
  };
  const plans = planSections([], 8, settings);
  const notes = generateKeys(grid, harmony, plans, settings, 42);
  expect(notes).toEqual(generateKeys(grid, harmony, plans, settings, 42));
  expect(notes.some((note) => note.time < 2)).toBe(true);
  expect(notes.some((note) => note.time >= 2 && note.time < 4)).toBe(false);
  const held = notes.filter((note) => note.time >= 8);
  expect(held.length).toBeGreaterThan(2);
  expect(held.every((note) => note.duration >= 2 && [0, 4, 9].includes(note.pitch % 12))).toBe(true);
});

it("voices the altered fifth and respects the bass under an inversion", () => {
  const pcs = (notes: number[]) => notes.map((note) => note % 12);
  const keys = { voices: 4 as const, extensions: true, register: "mid" as const };
  expect(pcs(rightHand(parseChordName("C7♭5")!, keys)).sort((a, b) => a - b)).toEqual([0, 4, 6, 10]);
  expect(pcs(leftHand(parseChordName("C/E")!, "root-fifth"))).toEqual([4, 7]);
});
