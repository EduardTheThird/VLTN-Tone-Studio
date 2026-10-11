// Multi-slot write plans (copy, move, swap, clear) as lists of "slot ← content of another slot" steps.
// Only slots whose content changes get a step; everything is read up front, then written one by one.
// A GP-50 can also clear, copy and move inside the pedal (NativeOp); the steps then only preview the result.

export interface Step {
  /** Slot that gets written */
  slot: number;
  /** Slot whose current preset goes there, or "blank" for an empty preset */
  from: number | "blank";
}

/** Copy `sources` (ascending) into consecutive slots starting at `target`. Null when it would run past the pedal's last slot. */
export function copySteps(sources: number[], target: number, slotCount: number): Step[] | null {
  if (!sources.length || target < 0 || target + sources.length > slotCount) return null;
  return sources.map((from, i) => ({ slot: target + i, from })).filter((s) => s.slot !== s.from);
}

/**
 * Move `selected` (ascending) so they sit together from `target` on; the slots in between shift to close the gap,
 * like dragging rows in a list. Null when it would run past the pedal's last slot.
 */
export function moveSteps(selected: number[], target: number, slotCount: number): Step[] | null {
  const k = selected.length;
  if (!k || target < 0 || target + k > slotCount) return null;
  const lo = Math.min(selected[0], target);
  const hi = Math.max(selected[k - 1], target + k - 1);
  const rest: number[] = [];
  for (let s = lo; s <= hi; s++) if (!selected.includes(s)) rest.push(s);
  const arranged = [...rest.slice(0, target - lo), ...selected, ...rest.slice(target - lo)];
  return arranged.flatMap((from, i) => (from === lo + i ? [] : [{ slot: lo + i, from }]));
}

export function swapSteps(a: number, b: number): Step[] {
  return a === b ? [] : [
    { slot: a, from: b },
    { slot: b, from: a },
  ];
}

export function clearSteps(slots: number[]): Step[] {
  return slots.map((slot) => ({ slot, from: "blank" as const }));
}

/** Slots whose current content must be read before writing (sources), in ascending order. */
export function slotsToRead(steps: Step[]): number[] {
  return [...new Set(steps.flatMap((s) => (s.from === "blank" ? [] : [s.from])))].sort((a, b) => a - b);
}

/** A preset-management command the pedal runs itself (GP-50 delete / copy / move). */
export type NativeOp = { kind: "delete"; slots: number[] } | { kind: "copy"; from: number; to: number } | { kind: "move"; from: number; to: number };

/** Slots whose content a native command changes, ascending: a move shifts every slot between `from` and `to`. */
export function affectedSlots(op: NativeOp): number[] {
  switch (op.kind) {
    case "delete":
      return [...new Set(op.slots)].sort((a, b) => a - b);
    case "copy":
      return op.from === op.to ? [] : [op.to];
    case "move": {
      if (op.from === op.to) return [];
      const lo = Math.min(op.from, op.to);
      return Array.from({ length: Math.max(op.from, op.to) - lo + 1 }, (_, i) => lo + i);
    }
  }
}
