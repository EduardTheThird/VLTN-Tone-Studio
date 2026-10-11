// Local undo/redo of Rig edits. Entries describe what changed; screens/rig/edits.ts applies them to the pedal.
import { create } from "zustand";
import type { ExpEdit, Gp200Edit } from "@/state/device-types";

/** Model, on/off and params of one block (enough to put it back exactly). */
export interface BlockSnapshot {
  index: number;
  fxid: number;
  enabled: boolean;
  params: number[];
}

export type Edit =
  | { kind: "param"; block: number; index: number; from: number; to: number; at: number }
  | { kind: "enabled"; block: number; from: boolean; to: boolean }
  | { kind: "order"; from: number[]; to: number[] }
  | { kind: "volume"; from: number; to: number; at: number }
  | { kind: "bpm"; from: number; to: number; at: number }
  | { kind: "exp"; from: ExpEdit; to: ExpEdit; at: number }
  | { kind: "footswitches"; from: number[][]; to: number[][] }
  /** GP-200 family patch fields; `from` holds the same fields at their previous values */
  | { kind: "patch"; from: Gp200Edit; to: Gp200Edit; at: number }
  | { kind: "block"; label: string; from: BlockSnapshot; to: BlockSnapshot };

/** Edits of the same control closer than this merge into one undo step (a drag, a wheel spin, key repeat). */
export const MERGE_MS = 1000;
const LIMIT = 200;

/** Which fields an edit names (nested keys kept, values dropped), to tell gestures on the same control apart. */
const shape = (x: object) => JSON.stringify(x, (_, v) => (v !== null && typeof v === "object" ? v : 0));

/** Push `e`, merging it into the last entry when it continues the same gesture. Pure, for tests. */
export function pushEdit(past: Edit[], e: Edit): Edit[] {
  const last = past[past.length - 1];
  if (last && e.kind === "param" && last.kind === "param" && last.block === e.block && last.index === e.index && e.at - last.at < MERGE_MS)
    return [...past.slice(0, -1), { ...last, to: e.to, at: e.at }];
  if (last && (e.kind === "volume" || e.kind === "bpm") && last.kind === e.kind && e.at - last.at < MERGE_MS) return [...past.slice(0, -1), { ...last, to: e.to, at: e.at }];
  // EXP and patch-field slider drags: the same fields within the window merge, keeping the first `from`
  if (last && e.kind === "exp" && last.kind === "exp" && Object.keys(e.to).join() === Object.keys(last.to).join() && e.at - last.at < MERGE_MS)
    return [...past.slice(0, -1), { ...last, to: e.to, at: e.at }];
  if (last && e.kind === "patch" && last.kind === "patch" && shape(e.to) === shape(last.to) && e.at - last.at < MERGE_MS)
    return [...past.slice(0, -1), { ...last, to: e.to, at: e.at }];
  return [...past, e].slice(-LIMIT);
}

/** The edit that undoes `e`. */
export function invert(e: Edit): Edit {
  return { ...e, from: e.to, to: e.from } as Edit;
}

interface HistoryState {
  past: Edit[];
  future: Edit[];
  record(e: Edit): void;
  /** Pops the newest edit and moves it to `future`; returns it (apply `invert(e)`) */
  takeUndo(): Edit | null;
  /** Pops the next redo and moves it back to `past`; returns it (apply as is) */
  takeRedo(): Edit | null;
  clear(): void;
}

export const useHistory = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  record: (e) => set({ past: pushEdit(get().past, e), future: [] }),
  takeUndo: () => {
    const { past, future } = get();
    const e = past[past.length - 1];
    if (!e) return null;
    set({ past: past.slice(0, -1), future: [...future, e] });
    return e;
  },
  takeRedo: () => {
    const { past, future } = get();
    const e = future[future.length - 1];
    if (!e) return null;
    set({ past: [...past, e], future: future.slice(0, -1) });
    return e;
  },
  clear: () => set({ past: [], future: [] }),
}));
