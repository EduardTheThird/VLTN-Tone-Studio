import { describe, expect, it } from "vitest";
import { groupOf, groupsOf, joinAnd, moveBlock, moveToGroup, nudge, orderHint } from "./order";
import { MERGE_MS, invert, pushEdit, type Edit } from "./history";

// 0 NR, 1 PRE, 2 DST, 3 AMP, 4 CAB, 5 EQ, 6 MOD, 7 DLY, 8 RVB, 9 NS
const DEFAULT = [0, 1, 2, 9, 3, 4, 5, 6, 7, 8];

describe("groupsOf", () => {
  it("splits around AMP and CAB", () => {
    expect(groupsOf("gp5", DEFAULT)).toEqual({ before: [0, 1, 2, 9], amp: [3, 4], after: [5, 6, 7, 8] });
  });
  it("puts movable blocks with the side they sit on", () => {
    const order = [7, 0, 2, 9, 3, 4, 5, 1, 6, 8];
    expect(groupsOf("gp5", order)).toEqual({ before: [7, 0, 2, 9], amp: [3, 4], after: [5, 1, 6, 8] });
    expect(groupOf("gp5", order, 7)).toBe("before");
    expect(groupOf("gp5", order, 1)).toBe("after");
    expect(groupOf("gp5", order, 4)).toBe("amp");
  });
});

describe("GP-200 family chains", () => {
  // 0 PRE, 1 WAH, 2 DST, 3 AMP, 4 NR, 5 CAB, 6 EQ, 7 MOD, 8 DLY, 9 RVB, 10 VOL
  const GP200 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const CODES = ["PRE", "WAH", "DST", "AMP", "NR", "CAB", "EQ", "MOD", "DLY", "RVB", "VOL"];
  it("groups around AMP and CAB without losing the block between them", () => {
    expect(groupsOf("gp200", GP200)).toEqual({ before: [0, 1, 2], amp: [3, 5], after: [4, 6, 7, 8, 9, 10] });
    expect(groupOf("gp200", GP200, 4)).toBe("after");
  });
  it("moves every block, the amp too", () => {
    expect(moveBlock("gp200", GP200, 3, 0, "before")).toEqual([3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10]);
    expect(moveToGroup("gp200", GP200, 9, "before")).toEqual([0, 1, 2, 9, 3, 4, 5, 6, 7, 8, 10]);
    expect(nudge("gp200", GP200, 5, -1)).toEqual([0, 1, 2, 3, 5, 4, 6, 7, 8, 9, 10]);
    expect(orderHint("gp200", GP200, "before", CODES)).toBe("Drag a pedal to reorder. PRE, WAH and DST can move.");
  });
});

describe("moveBlock", () => {
  it("moves a movable block next to another", () => {
    expect(moveBlock("gp5", DEFAULT, 0, 1, "after")).toEqual([1, 0, 2, 9, 3, 4, 5, 6, 7, 8]);
    expect(moveBlock("gp5", DEFAULT, 8, 6, "before")).toEqual([0, 1, 2, 9, 3, 4, 5, 8, 6, 7]);
    expect(moveBlock("gp5", DEFAULT, 7, 0, "before")).toEqual([7, 0, 1, 2, 9, 3, 4, 5, 6, 8]);
  });
  it("never splits the core", () => {
    expect(moveBlock("gp5", DEFAULT, 0, 2, "after")).toBeNull(); // between DST and NS
    expect(moveBlock("gp5", DEFAULT, 6, 3, "before")).toBeNull(); // between NS and AMP
    expect(moveBlock("gp5", DEFAULT, 6, 4, "after")).toBeNull(); // between CAB and EQ
  });
  it("allows the core edges", () => {
    expect(moveBlock("gp5", DEFAULT, 6, 2, "before")).toEqual([0, 1, 6, 2, 9, 3, 4, 5, 7, 8]);
    expect(moveBlock("gp5", DEFAULT, 0, 5, "after")).toEqual([1, 2, 9, 3, 4, 5, 0, 6, 7, 8]);
  });
  it("refuses fixed blocks, self drops and no-op moves", () => {
    expect(moveBlock("gp5", DEFAULT, 2, 0, "before")).toBeNull();
    expect(moveBlock("gp5", DEFAULT, 9, 0, "before")).toBeNull();
    expect(moveBlock("gp5", DEFAULT, 0, 0, "after")).toBeNull();
    expect(moveBlock("gp5", DEFAULT, 0, 1, "before")).toBeNull();
  });
  it("refuses to work on an invalid order", () => {
    expect(moveBlock("gp5", [0, 1, 2, 3, 9, 4, 5, 6, 7, 8], 0, 1, "after")).toBeNull();
  });
});

describe("moveToGroup", () => {
  it("drops just ahead of the core or at the chain end", () => {
    expect(moveToGroup("gp5", DEFAULT, 7, "before")).toEqual([0, 1, 7, 2, 9, 3, 4, 5, 6, 8]);
    expect(moveToGroup("gp5", DEFAULT, 0, "after")).toEqual([1, 2, 9, 3, 4, 5, 6, 7, 8, 0]);
  });
  it("never drops into the amp group or moves fixed blocks", () => {
    expect(moveToGroup("gp5", DEFAULT, 0, "amp")).toBeNull();
    expect(moveToGroup("gp5", DEFAULT, 5, "before")).toBeNull();
  });
  it("returns null when the block is already there", () => {
    expect(moveToGroup("gp5", DEFAULT, 8, "after")).toBeNull();
  });
});

describe("orderHint", () => {
  const CODES = ["NR", "PRE", "DST", "AMP", "CAB", "EQ", "MOD", "DLY", "RVB", "NS"];
  it("names the pedals that can move and the ones that stay, per side", () => {
    expect(orderHint("gp5", DEFAULT, "before", CODES)).toBe("Drag a pedal to reorder. NR and PRE can move; DST and NS stay in front of the amp.");
    expect(orderHint("gp5", DEFAULT, "after", CODES)).toBe("Drag a pedal to reorder. MOD, DLY and RVB can move; EQ stays right after the cab.");
  });
  it("follows the pedals when they change sides", () => {
    const allBefore = [0, 1, 6, 7, 8, 2, 9, 3, 4, 5];
    expect(orderHint("gp5", allBefore, "before", CODES)).toBe("Drag a pedal to reorder. NR, PRE, MOD, DLY and RVB can move; DST and NS stay in front of the amp.");
    expect(orderHint("gp5", allBefore, "after", CODES)).toBe("EQ stays right after the cab. To bring a pedal here, drag it onto “After the amp” in the chain overview.");
  });
  it("joins lists in plain English", () => {
    expect(joinAnd([])).toBe("");
    expect(joinAnd(["A"])).toBe("A");
    expect(joinAnd(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("nudge", () => {
  it("steps one position", () => {
    expect(nudge("gp5", DEFAULT, 0, 1)).toEqual([1, 0, 2, 9, 3, 4, 5, 6, 7, 8]);
    expect(nudge("gp5", DEFAULT, 7, -1)).toEqual([0, 1, 2, 9, 3, 4, 5, 7, 6, 8]);
  });
  it("jumps over the core as a unit", () => {
    expect(nudge("gp5", [0, 1, 2, 9, 3, 4, 5, 6, 7, 8], 1, 1)).toEqual([0, 2, 9, 3, 4, 5, 1, 6, 7, 8]);
    expect(nudge("gp5", DEFAULT, 6, -1)).toEqual([0, 1, 6, 2, 9, 3, 4, 5, 7, 8]);
  });
  it("stops at the ends and refuses fixed blocks", () => {
    expect(nudge("gp5", DEFAULT, 0, -1)).toBeNull();
    expect(nudge("gp5", DEFAULT, 8, 1)).toBeNull();
    expect(nudge("gp5", DEFAULT, 3, 1)).toBeNull();
  });
});

describe("undo history", () => {
  const param = (to: number, at: number, index = 0, from = 0): Edit => ({ kind: "param", block: 2, index, from, to, at });

  it("merges a gesture on the same param into one step", () => {
    let past = pushEdit([], param(10, 0, 0, 5));
    past = pushEdit(past, param(20, 300));
    past = pushEdit(past, param(30, 600));
    expect(past).toEqual([{ kind: "param", block: 2, index: 0, from: 5, to: 30, at: 600 }]);
  });
  it("starts a new step after a pause or on another param", () => {
    let past = pushEdit([], param(10, 0));
    past = pushEdit(past, param(20, MERGE_MS + 1));
    past = pushEdit(past, param(30, MERGE_MS + 2, 1));
    expect(past).toHaveLength(3);
  });
  it("inverts by swapping from and to", () => {
    expect(invert({ kind: "enabled", block: 1, from: true, to: false })).toEqual({ kind: "enabled", block: 1, from: false, to: true });
    expect(invert({ kind: "order", from: [1], to: [2] })).toEqual({ kind: "order", from: [2], to: [1] });
  });
});
