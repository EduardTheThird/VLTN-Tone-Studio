import { describe, expect, it } from "vitest";
import { parseChart } from "./chart";
import { rigPedalFor, rigResetMessages, soloMessages, soloReturn, updateRigState } from "./rig-state";

const library = {
  profiles: [], owned: ["valeton-gp180", "strymon-timeline", "boss-ir200"], presets: {},
  channels: { "valeton-gp180": 16 },
  assignments: { "boss-ir200:solo": 68 },
};

describe("rig state and live changes", () => {
  it("uses configured channels, preserves a banked preset, and observes GP-origin changes", () => {
    const state = updateRigState({}, "valeton-gp180", [0xbf, 0, 1], 100, "sent");
    const recall = updateRigState(state, "valeton-gp180", [0xcf, 4], 101, "sent");
    expect(recall["valeton-gp180"]).toMatchObject({ slot: 132, source: "sent", at: 101 });
    expect(rigPedalFor([0xc0, 8], library, 16, true)).toBeUndefined();
    expect(rigPedalFor([0xcf, 8], library, 16, true)).toBe("valeton-gp180");
    const received = updateRigState(recall, "valeton-gp180", [0xcf, 8], 105, "pedal");
    expect(received["valeton-gp180"]).toMatchObject({ slot: 136, source: "pedal", at: 105 });
    const collision = { ...library, channels: { ...library.channels, "boss-ir200": 16 } };
    expect(rigPedalFor([0xcf, 9], collision, 16, true)).toBeUndefined();
  });

  it("resets using last lasting cues and uses the load row for song start", () => {
    const chart = [
      "{midi@load:cc 16 0 1} {midi@load:pc 16 4} {midi@load:pc 1 12}",
      "[00:04] {midi:cc 3 68 127} {midi:cc 3 68 0}",
      "[00:05] {midi:pc 1 21} {midi:cc 1 14 50}",
      "[00:06] {nochase} {midi:cc 1 102 0}",
    ].join("\n");
    const cues = parseChart(chart);
    const triggers: [number, number][] = [[3, 68]];
    expect(rigResetMessages(cues, 8, true, library, 16, triggers)).toEqual([[0xc0, 12], [0xbf, 0, 1], [0xcf, 4]]);
    expect(rigResetMessages(cues, 8, false, library, 16, triggers)).toEqual([[0xc0, 21], [0xb0, 14, 50], [0xbf, 0, 1], [0xcf, 4]]);
  });

  it("sends Solo with the GP last and restores the current row", () => {
    const options = { cells: { "valeton-gp180": { preset: 7 }, "boss-ir200": { extras: [{ action: "solo" }] },
      "strymon-timeline": { extras: [{ action: "mix", value: 88 }] } } };
    const plan = soloMessages(options, {}, library, 16);
    expect(plan.send).toEqual([[0xb0, 14, 88], [0xb2, 68, 127], [0xb2, 68, 0], [0xbf, 0, 0], [0xcf, 7]]);
    expect(soloReturn(plan, [[0xb0, 14, 61], [0xbf, 0, 1], [0xcf, 9]], {}, library, 16)).toEqual([
      [0xb2, 68, 127], [0xb2, 68, 0], [0xb0, 14, 61], [0xbf, 0, 1], [0xcf, 9],
    ]);
    expect(soloMessages({}, { "strymon-timeline": { controls: { 14: 70 }, at: 1, source: "sent" } }, library, 16).send).toContainEqual([0xb0, 14, 95]);
  });
});
