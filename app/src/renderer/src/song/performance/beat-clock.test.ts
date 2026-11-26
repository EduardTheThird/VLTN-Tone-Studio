import { expect, it } from "vitest";
import { BeatClock, clockSource, openingBeatTempo } from "./beat-clock";

it("keeps written tempo on saved songs unless the user changes it", () => {
  expect(clockSource(undefined, false)).toBe("tempo");
  expect(clockSource(undefined, true)).toBe("beats");
  expect(clockSource("tempo", true)).toBe("tempo");
  expect(clockSource("beats", false)).toBe("beats");
});

it("starts at the correct pulse after a seek into the middle of a beat", () => {
  const clock = new BeatClock(Array.from({ length: 14 }, (_, i) => i * 0.5));
  expect(clock.next(5.25)).toBe(252);
  expect(clock.next(5.251)).toBe(253);
  expect(clock.at(252)).toBe(5.25);
});

it("averages the first two bars from the downbeat, including a shorter bar", () => {
  const beats = [0, 0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75, 4.55, 5.35, 6.15];
  expect(openingBeatTempo({ beats, downbeat: 1, beatsPerBar: 4, barStarts: [1, 4, 8] })).toBe(120);
  expect(openingBeatTempo({ beats, downbeat: 1, beatsPerBar: 4 })).toBeCloseTo(480 / 4.3);
  expect(openingBeatTempo({ beats: [0], downbeat: 0, beatsPerBar: 4 })).toBeNull();
});

it("keeps quarter-note MIDI timing when the played pulse is a dotted quarter", () => {
  const grid = { beats: [0, 0.6, 1.2], beatsPerBar: 2, downbeat: 0, meter: "6/8" as const };
  expect(openingBeatTempo(grid)).toBe(150);
  const clock = new BeatClock(grid.beats, 36);
  expect(clock.next(0.6)).toBe(36);
  expect(clock.at(24)).toBeCloseTo(0.4);
});
