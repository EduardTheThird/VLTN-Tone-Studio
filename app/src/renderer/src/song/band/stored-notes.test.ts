import { describe, expect, it } from "vitest";
import { bandNotesOf, fromStoredNotes, parseBandNotes, toStoredNotes, updatedBandNotes } from "./stored-notes";
import type { NoteEvent } from "./note";

const NOTES: NoteEvent[] = [
  { time: 0.5, pitch: 36, velocity: 100, duration: 0.1 },
  { time: 1.25, pitch: 33, velocity: 80, duration: 0.4, slideFrom: 2 },
  { time: 2.0005, pitch: 33, velocity: 40, duration: 0.05, dead: true },
];

describe("stored band notes", () => {
  it("round trips times to the millisecond", () => {
    const back = fromStoredNotes(toStoredNotes(NOTES));
    expect(back.map((n) => [n.time, n.pitch, n.velocity, n.duration])).toEqual([
      [0.5, 36, 100, 0.1],
      [1.25, 33, 80, 0.4],
      [2.001, 33, 40, 0.05],
    ]);
  });

  it("keeps the dead and slide flags", () => {
    const stored = toStoredNotes(NOTES);
    expect(stored.map((note) => note[4])).toEqual([0, 2, 1]);
    const back = fromStoredNotes(stored);
    expect(back[0].dead).toBeUndefined();
    expect(back[1].slideFrom).toBeDefined();
    expect(back[2].dead).toBe(true);
  });

  it("survives a trip through JSON", () => {
    const saved = bandNotesOf({ drums: NOTES.slice(0, 1), bass: NOTES.slice(1) }, 2, 77);
    expect(parseBandNotes(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("gives none for malformed input", () => {
    const good = bandNotesOf({ drums: NOTES, bass: [] }, 2, 1);
    expect(parseBandNotes(undefined)).toBeNull();
    expect(parseBandNotes("notes")).toBeNull();
    expect(parseBandNotes({ ...good, seed: "x" })).toBeNull();
    expect(parseBandNotes({ ...good, drums: [[1, 2, 3]] })).toBeNull();
    expect(parseBandNotes({ ...good, drums: [[0, 200, 100, 100, 0]] })).toBeNull();
    expect(parseBandNotes({ ...good, bass: [[0, 36, 100, 100, 256]] })).toBeNull();
    expect(parseBandNotes({ ...good, bass: "none" })).toBeNull();
    expect(parseBandNotes({ ...good, drums: Array.from({ length: 20001 }, () => [0, 36, 100, 100, 0]) })).toBeNull();
  });

  it("keeps the notes of a part that was not generated this time, and drops a part that is off", () => {
    const before = bandNotesOf({ drums: NOTES.slice(0, 1), bass: NOTES.slice(1) }, 2, 5);
    const bassOnly = updatedBandNotes(before, { drums: [], bass: NOTES.slice(2) }, { drums: false, bass: true }, { drums: true, bass: true }, 2, 5);
    expect(bassOnly.drums).toEqual(before.drums);
    expect(bassOnly.bass).toHaveLength(1);
    const drumsOff = updatedBandNotes(before, { drums: [], bass: NOTES }, { drums: false, bass: true }, { drums: false, bass: true }, 2, 6);
    expect(drumsOff.drums).toEqual([]);
    expect(drumsOff.seed).toBe(6);
  });
});

it("keeps learned-drum results across a bass-only render and clears them when drums are removed", () => {
  const notes = { drums: NOTES.slice(0, 1), bass: NOTES.slice(1) };
  const learnedDrums = [{ start: 0, confidence: 0.78, learned: true }];
  const saved = updatedBandNotes(null, notes, { drums: true, bass: true }, { drums: true, bass: true }, 3, 19, learnedDrums);
  expect(parseBandNotes(JSON.parse(JSON.stringify(saved)))?.learnedDrums).toEqual(learnedDrums);
  const bassOnly = updatedBandNotes(saved, notes, { drums: false, bass: true }, { drums: true, bass: true }, 3, 20);
  expect(bassOnly.learnedDrums).toEqual(learnedDrums);
  const removed = updatedBandNotes(saved, notes, { drums: false, bass: true }, { drums: false, bass: true }, 3, 20);
  expect(removed.learnedDrums).toBeUndefined();
});


it("preserves the staccato flag alongside the earlier note flags", () => {
  const note = { time: 1, pitch: 26, velocity: 90, duration: 0.1, staccato: true } as const;
  const stored = toStoredNotes([note]);
  expect(parseBandNotes({ engine: 3, seed: 2, drums: [], bass: stored })?.bass).toEqual(stored);
  expect(fromStoredNotes(stored)).toEqual([note]);
});


it("preserves detected stop times and filters damaged entries", () => {
  const saved = parseBandNotes({ engine: 3, seed: 1, drums: [], bass: [], detectedStops: [2, "3", -1, 2.5] })!;
  expect(saved.detectedStops).toEqual([2, 2.5]);
  expect(updatedBandNotes(saved, { drums: [], bass: [] }, { drums: true, bass: true }, { drums: true, bass: true }, 3, 1, undefined, [5]).detectedStops).toEqual([5]);
});


it("round trips rim and explicit bass articulation flags", () => {
  const drums: NoteEvent[] = [{ time: 0, pitch: 38, velocity: 100, duration: 0.1, rim: true }];
  const bass: NoteEvent[] = [
    { time: 0, pitch: 36, velocity: 85, duration: 0.5, articulation: "legato" },
    { time: 0.5, pitch: 36, velocity: 85, duration: 0.125, articulation: "staccato", staccato: true },
  ];
  const saved = parseBandNotes(bandNotesOf({ drums, bass }, 4, 1))!;
  expect(fromStoredNotes(saved.drums)).toEqual(drums);
  expect(fromStoredNotes(saved.bass)).toEqual(bass);
});
