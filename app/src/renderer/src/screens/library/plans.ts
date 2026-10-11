// Multi-slot write plans (copy, move, swap, clear) as lists of "slot ← content of another slot" steps.
// Only slots whose content changes get a step; everything is read up front, then written one by one.
// A GP-50 can also clear, copy and move inside the pedal (NativeOp); the steps then only preview the result.
import { useGp200Catalog } from "@/gp200/app/catalog-store";
import type { Gp200Catalog } from "@/gp200/lib/catalog.mjs";
import { buildPrst, encodePatchImage } from "@/gp200/lib/prst.mjs";
import { defaultParamsFor, modelsFor } from "@/state/preset-codec";
import { profileFor, type DeviceKey } from "@shared/devices";

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

/** Name of the init patch a GP-200 family slot is reset to. */
export const INIT_NAME = "INIT";

/**
 * The "blank" of the GP-200 family, which has no empty slots: an init patch with the first model of every block in the
 * effect catalog at its defaults, every block off, named INIT. Written like any preset (full write, read back), not
 * with the pedal's own reset command, which hasn't been tested on hardware. Throws without a catalog: every block of a
 * GP-200 patch holds a model.
 */
export function gp200InitPatch(device: DeviceKey, catalog: Gp200Catalog | null = useGp200Catalog.getState().catalog): Uint8Array {
  const blocks = profileFor(device).blocks.map((_, k) => {
    const fxid = modelsFor(device, k, catalog)[0]?.fxid;
    if (fxid === undefined) throw new Error("Resetting a slot needs the GP-200 effect list: the init patch holds a model in every block. Import the list on the Device screen.");
    return { fxid, enabled: false, params: defaultParamsFor(device, k, fxid, catalog) };
  });
  return buildPrst(encodePatchImage({ name: INIT_NAME, blocks }));
}

/** Slots whose current content must be read before writing (sources), in ascending order. */
export function slotsToRead(steps: Step[]): number[] {
  return [...new Set(steps.flatMap((s) => (s.from === "blank" ? [] : [s.from])))].sort((a, b) => a - b);
}

/** A preset-management command the pedal runs itself (GP-50 delete / copy / move). */
export type NativeOp = { kind: "delete"; slots: number[] } | { kind: "copy"; from: number; to: number } | { kind: "move"; from: number; to: number };
