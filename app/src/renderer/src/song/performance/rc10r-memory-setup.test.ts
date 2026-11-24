import { expect, it } from "vitest";
import { compareRc10rMemory, newRc10rMemorySetup, parseRc10rMemorySetup } from "./rc10r-memory-setup";

it("uses an editable song-style default and validates saved fields", () => {
  const suggested = newRc10rMemorySetup("funk", 2);
  expect(suggested).toEqual({ kit: "R&B", level: 100, reverb: 50, intro: true, stopMode: "measure-ending", playMode: "first-second" });
  expect(parseRc10rMemorySetup({ kit: "Heavy", level: 90, reverb: 102, stopMode: "immediate", playMode: "__proto__" }, suggested))
    .toEqual({ ...suggested, kit: "Heavy", level: 90, stopMode: "immediate" });
});

it("compares numeric levels and keeps unverified pedal codes explicit", () => {
  const rows = compareRc10rMemory(newRc10rMemorySetup("rock", 1), { Kit: 4, Level: 100, ReverbLevel: 21, StopMode: 3 });
  expect(rows.map(({ field, comparison }) => [field, comparison])).toEqual([
    ["Kit", "Capture pending"], ["Level", "Match"], ["ReverbLevel", "Different"], ["Intro", "Unavailable"],
    ["StopMode", "Capture pending"], ["PlayMode", "Unavailable"],
  ]);
});
