import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, type BandSettings, type SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { CRASH, DRUM_DURATION, KICK, SNARE, type NoteEvent } from "./note";
import { generateDrums } from "./drums";
import { findStyle } from "./styles";
import { STYLE_IDS } from "./styles/types";

/** A grid of `count` beats, `interval` seconds apart. Intervals of 0.5 keep every step time exact in binary. */
function steady(count: number, downbeat = 0, beatsPerBar = 4): BeatGrid {
  return { beatsPerBar, beats: Array.from({ length: count }, (_, i) => i * 0.5), downbeat, bpm: 120, steady: null };
}

/** The same grid with beats that drift: a few hundredths of a second early or late, moving smoothly. */
function drifting(count: number): BeatGrid {
  const grid = steady(count);
  return { ...grid, beats: grid.beats.map((time, i) => time + 0.02 * Math.sin(i * 0.7)), steady: null };
}

/** A plan from `startBeat` to `endBeat`. The fixture grids put a beat every 0.5 s, so beat n is at n / 2 seconds. */
function plan(startBeat: number, endBeat: number, overrides: Partial<SectionPlan> = {}): SectionPlan {
  return {
    sectionId: null,
    start: startBeat * 0.5,
    end: endBeat * 0.5,
    style: "rock",
    energy: 3,
    fill: false,
    play: { drums: true, bass: true },
    ...overrides,
  };
}

/** Settings that keep every hit: full complexity, no swing, ghosts on, no section crashes unless a test asks for them. */
function settingsFor(overrides: Partial<BandSettings> = {}): BandSettings {
  return { ...DEFAULT_BAND_SETTINGS, complexity: 1, swing: 0, ghostNotes: true, crashOnSections: false, ...overrides };
}

/** The beat a time falls in, and how far through it (0 to 1). */
function positionOf(beats: readonly number[], time: number): { beat: number; fraction: number } {
  let beat = 0;
  while (beat + 1 < beats.length && beats[beat + 1] <= time + 1e-9) beat++;
  const length = beat + 1 < beats.length ? beats[beat + 1] - beats[beat] : beats[beat] - beats[beat - 1];
  return { beat, fraction: (time - beats[beat]) / length };
}

describe("generateDrums", () => {
  it("gives the same notes for the same seed", () => {
    const grid = steady(64);
    const plans = [plan(0, 64)];
    expect(generateDrums(grid, plans, settingsFor(), 5)).toEqual(generateDrums(grid, plans, settingsFor(), 5));
  });

  it("gives different notes for a different seed", () => {
    // Two grooves to choose from per energy, so one pair of seeds can agree by chance. Across eight seeds they must not all agree.
    const grid = steady(64);
    const plans = [plan(0, 64)];
    const outputs = Array.from({ length: 8 }, (_, seed) => JSON.stringify(generateDrums(grid, plans, settingsFor(), seed + 1)));
    expect(new Set(outputs).size).toBeGreaterThan(1);
  });

  it("sorts the notes by time and keeps every velocity and duration in range", () => {
    const notes = generateDrums(steady(64), [plan(0, 32, { energy: 5, fill: true })], settingsFor(), 3);
    expect(notes.length).toBeGreaterThan(0);
    for (let i = 1; i < notes.length; i++) expect(notes[i].time).toBeGreaterThanOrEqual(notes[i - 1].time);
    for (const note of notes) {
      expect(note.velocity).toBeGreaterThanOrEqual(1);
      expect(note.velocity).toBeLessThanOrEqual(127);
      expect(note.duration).toBe(DRUM_DURATION);
    }
  });

  it.each(STYLE_IDS.map((id) => [id] as const))("puts every %s note on a step time when swing is 0", (id) => {
    const style = findStyle(id)!;
    const grid = steady(96, 0, style.meter.beatsPerBar);
    const notes = generateDrums(grid, [plan(0, 48, { style: id, energy: 5 }), plan(48, 96, { style: id, energy: 2 })], settingsFor(), 7);
    expect(notes.length).toBeGreaterThan(0);
    const lastBeat = grid.beats[grid.beats.length - 1];
    for (const note of notes.filter((n) => n.time < lastBeat)) {
      const { fraction } = positionOf(grid.beats, note.time);
      const step = fraction * style.meter.stepsPerBeat;
      expect(Math.abs(step - Math.round(step)), `${id} at ${note.time}`).toBeLessThan(1e-6);
    }
  });

  it("delays only the off-beat sixteenths when swing is on", () => {
    const grid = steady(32);
    const straight = generateDrums(grid, [plan(0, 32, { style: "funk", energy: 4, fill: false })], settingsFor(), 4);
    const swing = 0.6;
    const swung = generateDrums(grid, [plan(0, 32, { style: "funk", energy: 4, fill: false })], settingsFor({ swing }), 4);

    // Same seed, same hits: only the times move. The shift for an off-beat is swing × half a step, in beats, times the beat length.
    const shift = ((swing * 0.5) / 4) * 0.5;
    const expected: NoteEvent[] = straight
      .map((note) => {
        const { fraction } = positionOf(grid.beats, note.time);
        const offBeat = Math.round(fraction * 4) % 2 === 1;
        return { ...note, time: offBeat ? note.time + shift : note.time };
      })
      .sort((a, b) => a.time - b.time || a.pitch - b.pitch);
    const actual = [...swung].sort((a, b) => a.time - b.time || a.pitch - b.pitch);

    expect(actual).toHaveLength(expected.length);
    expected.forEach((note, i) => {
      expect(actual[i].pitch).toBe(note.pitch);
      expect(actual[i].time).toBeCloseTo(note.time, 9);
    });
    expect(straight.some((note) => Math.round(positionOf(grid.beats, note.time).fraction * 4) % 2 === 1)).toBe(true);
  });

  it("does not swing the on-beats", () => {
    const grid = steady(16);
    const notes = generateDrums(grid, [plan(0, 16, { style: "funk", energy: 2, fill: false })], settingsFor({ swing: 0.75 }), 2);
    const onBeats = notes.filter((note) => Math.round(positionOf(grid.beats, note.time).fraction * 4) % 4 === 0);
    for (const note of onBeats) {
      const { beat, fraction } = positionOf(grid.beats, note.time);
      expect(fraction * 4 - Math.round(fraction * 4)).toBeCloseTo(0, 9);
      expect(beat).toBeGreaterThanOrEqual(0);
    }
    expect(onBeats.length).toBeGreaterThan(0);
  });

  it("ignores swing on a triplet grid", () => {
    const grid = steady(24, 0, 4);
    const straight = generateDrums(grid, [plan(0, 24, { style: "shuffle", energy: 4, fill: false })], settingsFor(), 9);
    const swung = generateDrums(grid, [plan(0, 24, { style: "shuffle", energy: 4, fill: false })], settingsFor({ swing: 0.75 }), 9);
    expect(swung).toEqual(straight);
  });

  it("puts a fill in the last bar of a plan and leaves the rest of the song alone", () => {
    // Plan A covers beats 0 to 31 (bars at 0, 4, … 28). Plan B covers 32 to 63 at energy 2, with no crash at its start.
    const grid = steady(64);
    const plans = (fill: boolean) => [plan(0, 32, { fill }), plan(32, 64, { energy: 2 })];
    const without = generateDrums(grid, plans(false), settingsFor(), 12);
    const withFill = generateDrums(grid, plans(true), settingsFor(), 12);

    const before = (notes: NoteEvent[], time: number) => notes.filter((note) => note.time < time);
    const from = (notes: NoteEvent[], time: number) => notes.filter((note) => note.time >= time);
    const within = (notes: NoteEvent[], from: number, to: number) => notes.filter((note) => note.time >= from && note.time < to);

    // The bar at beat 28 is the last bar of plan A. Its first half is the groove in both versions, so those notes match.
    expect(before(withFill, grid.beats[30])).toEqual(before(without, grid.beats[30]));
    // The fill changes the second half of that bar.
    expect(within(withFill, grid.beats[30], grid.beats[32])).not.toEqual(within(without, grid.beats[30], grid.beats[32]));
    // The bar at beat 32 may gain a crash after a fill, so compare from the second beat of that bar on.
    expect(from(withFill, grid.beats[33])).toEqual(from(without, grid.beats[33]));
  });

  it("uses a bar fill, not a half fill, at energy 4 and up", () => {
    // Forty beats, so bar 28 is the last bar of the plan and not the end of the song.
    const grid = steady(40);
    const withFill = generateDrums(grid, [plan(0, 32, { energy: 4, fill: true })], settingsFor(), 8);
    const lastBar = withFill.filter((note) => note.time >= grid.beats[28] && note.time < grid.beats[32]);
    // A bar fill has hits in the first half too (its toms start on the downbeat), unlike a half fill.
    expect(lastBar.some((note) => note.time < grid.beats[30])).toBe(true);
  });

  it("has more notes per bar at energy 5 than at energy 1", () => {
    const grid = steady(64);
    const count = (energy: 1 | 5) => generateDrums(grid, [plan(0, 64, { energy, fill: false })], settingsFor(), 21).length;
    expect(count(5)).toBeGreaterThan(count(1) * 1.5);
  });

  it("drops optional hits at low complexity", () => {
    const grid = steady(64);
    const busy = generateDrums(grid, [plan(0, 64, { style: "funk", energy: 5, fill: false })], settingsFor({ complexity: 1 }), 14);
    const sparse = generateDrums(grid, [plan(0, 64, { style: "funk", energy: 5, fill: false })], settingsFor({ complexity: 0 }), 14);
    expect(sparse.length).toBeLessThan(busy.length);
  });

  it("is silent in the pickup before the downbeat", () => {
    const grid = steady(32, 2);
    const notes = generateDrums(grid, [plan(0, 16)], settingsFor(), 4);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect(note.time).toBeGreaterThanOrEqual(grid.beats[2]);
  });

  it("gives no notes in a section whose drums are off", () => {
    const grid = steady(64);
    const notes = generateDrums(grid, [plan(0, 32, { fill: false }), plan(32, 64, { play: { drums: false, bass: true } })], settingsFor(), 16);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((note) => note.time < grid.beats[32])).toBe(true);
  });

  it("drops every ghost note when ghost notes are off", () => {
    const grid = steady(64);
    const plans = [plan(0, 64, { style: "funk", energy: 3, fill: false })];
    const with_ = generateDrums(grid, plans, settingsFor({ ghostNotes: true }), 30);
    const without = generateDrums(grid, plans, settingsFor({ ghostNotes: false }), 30);
    expect(with_.some((note) => note.velocity <= 45)).toBe(true);
    expect(without.some((note) => note.velocity <= 45)).toBe(false);
    expect(without.length).toBeLessThan(with_.length);
  });

  it("places notes from the actual beat times when the beats drift", () => {
    const grid = drifting(64);
    const notes = generateDrums(grid, [plan(0, 64, { style: "rock", energy: 4, fill: false })], settingsFor(), 17);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes.filter((n) => n.time < grid.beats[63])) {
      const { fraction } = positionOf(grid.beats, note.time);
      const step = fraction * 4;
      expect(Math.abs(step - Math.round(step))).toBeLessThan(1e-6);
    }
    // Some notes are moved off the straight grid, so the drift is really in use.
    const straight = generateDrums(steady(64), [plan(0, 64, { style: "rock", energy: 4, fill: false })], settingsFor(), 17);
    expect(notes.map((n) => n.time)).not.toEqual(straight.map((n) => n.time));
  });

  it("ends the song on a crash and a kick on the last downbeat, with nothing after", () => {
    const grid = steady(64);
    const notes = generateDrums(grid, [plan(0, 64, { fill: true })], settingsFor(), 19);
    const lastDownbeat = grid.beats[60];
    const last = notes.filter((note) => note.time === lastDownbeat);
    expect(last.map((note) => note.pitch).sort((a, b) => a - b)).toEqual([KICK, CRASH].sort((a, b) => a - b));
    expect(notes.every((note) => note.time <= lastDownbeat)).toBe(true);
    expect(notes.some((note) => note.time < lastDownbeat && note.time >= grid.beats[56])).toBe(true);
  });

  it("keeps notes within the final beat plus one beat on a partial last bar", () => {
    const grid = steady(62);
    const notes = generateDrums(grid, [plan(0, 62)], settingsFor(), 23);
    expect(notes.length).toBeGreaterThan(0);
    const limit = grid.beats[61] + 0.5;
    expect(notes.every((note) => note.time <= limit)).toBe(true);
  });

  it("crashes on a section start from energy 3 when crashOnSections is on", () => {
    const grid = steady(64);
    const plans = [plan(0, 32, { energy: 2, fill: false }), plan(32, 64, { energy: 4, fill: false })];
    const on = generateDrums(grid, plans, settingsFor({ crashOnSections: true }), 25);
    const off = generateDrums(grid, plans, settingsFor({ crashOnSections: false }), 25);
    const crashAt = (notes: NoteEvent[]) => notes.some((note) => note.pitch === CRASH && note.time === grid.beats[32]);
    expect(crashAt(on)).toBe(true);
    expect(crashAt(off)).toBe(false);
  });

  it("does not crash a section start below energy 3", () => {
    const grid = steady(64);
    const plans = [plan(0, 32, { fill: false }), plan(32, 64, { energy: 2, fill: false })];
    const notes = generateDrums(grid, plans, settingsFor({ crashOnSections: true }), 26);
    expect(notes.some((note) => note.pitch === CRASH && note.time === grid.beats[32])).toBe(false);
  });

  it("crashes on the first downbeat after a fill, even when crashOnSections is off", () => {
    const grid = steady(64);
    const plans = [plan(0, 32, { fill: true }), plan(32, 64, { energy: 1, fill: false })];
    const notes = generateDrums(grid, plans, settingsFor({ crashOnSections: false }), 27);
    expect(notes.some((note) => note.pitch === CRASH && note.time === grid.beats[32])).toBe(true);
  });

  it("uses the snare on the backbeat of a rock groove at energy 2", () => {
    const grid = steady(16);
    const notes = generateDrums(grid, [plan(0, 16, { style: "rock", energy: 2, fill: false })], settingsFor(), 28);
    // Steps 4 and 12 are beats 2 and 4 of the bar, so beats 1 and 3 of the grid.
    expect(notes.some((note) => note.pitch === SNARE && note.time === grid.beats[1])).toBe(true);
  });
});
