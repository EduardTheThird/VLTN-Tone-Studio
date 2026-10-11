import { describe, expect, it } from "vitest";
import { affectedSlots, clearSteps, copySteps, moveSteps, slotsToRead, swapSteps } from "./plans";

// A GP-5's 100 slots.
const SLOTS = 100;

describe("moveSteps", () => {
  it("moves one slot down and shifts the ones in between up", () => {
    expect(moveSteps([57], 60, SLOTS)).toEqual([
      { slot: 57, from: 58 },
      { slot: 58, from: 59 },
      { slot: 59, from: 60 },
      { slot: 60, from: 57 },
    ]);
  });
  it("moves a block up and shifts the rest down", () => {
    expect(moveSteps([10, 11], 8, SLOTS)).toEqual([
      { slot: 8, from: 10 },
      { slot: 9, from: 11 },
      { slot: 10, from: 8 },
      { slot: 11, from: 9 },
    ]);
  });
  it("gathers scattered slots at the target and touches only changed slots", () => {
    expect(moveSteps([57, 59], 57, SLOTS)).toEqual([
      { slot: 58, from: 59 },
      { slot: 59, from: 58 },
    ]);
  });
  it("is empty when nothing moves and null past slot 99", () => {
    expect(moveSteps([5, 6], 5, SLOTS)).toEqual([]);
    expect(moveSteps([5, 6], 99, SLOTS)).toBeNull();
  });
  it("is a permutation: every source lands exactly once", () => {
    const steps = moveSteps([3, 20, 41], 30, SLOTS)!;
    expect(new Set(steps.map((s) => s.slot)).size).toBe(steps.length);
    expect(steps.map((s) => s.from).sort()).toEqual(steps.map((s) => s.slot).sort());
  });
});

describe("copy, swap, clear", () => {
  it("copies into consecutive slots and skips copying a slot onto itself", () => {
    expect(copySteps([57, 59], 64, SLOTS)).toEqual([
      { slot: 64, from: 57 },
      { slot: 65, from: 59 },
    ]);
    expect(copySteps([5], 5, SLOTS)).toEqual([]);
    expect(copySteps([1, 2], 99, SLOTS)).toBeNull();
    expect(copySteps([1, 2], 98, SLOTS)).not.toBeNull();
  });
  it("swaps two slots", () => {
    expect(swapSteps(57, 59)).toEqual([
      { slot: 57, from: 59 },
      { slot: 59, from: 57 },
    ]);
  });
  it("clears with blank presets and reads only real sources", () => {
    const steps = [...clearSteps([3]), ...copySteps([9, 2], 20, SLOTS)!];
    expect(slotsToRead(steps)).toEqual([2, 9]);
  });
});

describe("affectedSlots", () => {
  it("deletes exactly the given slots, once each, ascending", () => {
    expect(affectedSlots({ kind: "delete", slots: [9, 3, 9] })).toEqual([3, 9]);
  });
  it("copies onto the target only", () => {
    expect(affectedSlots({ kind: "copy", from: 57, to: 64 })).toEqual([64]);
    expect(affectedSlots({ kind: "copy", from: 5, to: 5 })).toEqual([]);
  });
  it("moves down: every slot from the source to the target shifts", () => {
    expect(affectedSlots({ kind: "move", from: 57, to: 60 })).toEqual([57, 58, 59, 60]);
  });
  it("moves up: every slot from the target to the source shifts", () => {
    expect(affectedSlots({ kind: "move", from: 12, to: 9 })).toEqual([9, 10, 11, 12]);
  });
  it("matches the slots a full-write move rewrites", () => {
    expect(affectedSlots({ kind: "move", from: 40, to: 35 })).toEqual(moveSteps([40], 35, SLOTS)!.map((s) => s.slot));
    expect(affectedSlots({ kind: "move", from: 4, to: 4 })).toEqual([]);
  });
});
