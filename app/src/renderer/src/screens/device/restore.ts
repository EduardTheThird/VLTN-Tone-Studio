// Restore sources: a backup collection or a folder picked by the user → slot-addressed presets to write, each
// prepared for the connected pedal's model (GP-5 ⇄ GP-50).
import { DEVICES, applyEdits, readName } from "@/gp5/lib/prst.mjs";
import { parseSlotFileName } from "@shared/files-naming";
import { isEmptySlotName, prepareForDevice, presetDevice, type PreparedPreset } from "@/state/device-model";
import type { BackupEntry, DeviceKey } from "@/state/device-types";

/** An entry made on the other model, converted for the connected pedal. */
export interface RestoreConversion {
  slot: number;
  name: string;
  from: DeviceKey;
  /** Blocks left empty because their model doesn't exist on the pedal, e.g. "PRE (PRE C-Wah)" */
  dropped: string[];
}

export interface RestoreSource {
  /** "gp5-2026-10-07" or the picked folder's name */
  title: string;
  /** "backups/gp5-2026-10-07" or the folder path */
  location: string;
  /** One per slot, sorted by slot, ready to write to the connected pedal */
  entries: BackupEntry[];
  /** Entries converted from the other model, sorted by slot (the dialog lists dropped blocks before writing) */
  converted: RestoreConversion[];
  /** Files that can't be restored, with the reason */
  skipped: string[];
}

export interface SourceFile {
  fileName: string;
  /** Slot recorded with the file (backups), otherwise taken from an `NN-` file name prefix */
  slot?: number | null;
  bytes: Uint8Array | null;
  error?: string | null;
}

/**
 * Keep presets of either model with a known slot, one per slot (the first wins); explain everything else.
 * `target` is the connected pedal's model: other-model presets are converted for it, and an empty slot of the other
 * model is renamed to the target's empty name so it still reads as empty. Null target: entries stay as they are.
 */
export function restoreEntries(files: SourceFile[], target: DeviceKey | null): Omit<RestoreSource, "title" | "location"> {
  const bySlot = new Map<number, { entry: BackupEntry; conversion: RestoreConversion | null }>();
  const skipped: string[] = [];
  for (const f of files) {
    if (!f.bytes) {
      skipped.push(`${f.fileName}: ${f.error ?? "unreadable"}`);
      continue;
    }
    const slot = f.slot ?? parseSlotFileName(f.fileName)?.slot ?? null;
    if (slot === null || slot < 0 || slot > 99) {
      skipped.push(`${f.fileName}: no slot number in the file name`);
      continue;
    }
    let prepared: PreparedPreset;
    try {
      prepared = prepareForDevice(f.bytes, target ?? presetDevice(f.bytes));
    } catch {
      skipped.push(`${f.fileName}: not a GP-5 or GP-50 preset`);
      continue;
    }
    if (bySlot.has(slot)) {
      skipped.push(`${f.fileName}: slot ${slot} appears twice`);
      continue;
    }
    const stored = readName(f.bytes).trim();
    if (prepared.converted && target && isEmptySlotName(stored, prepared.from)) {
      const empty = DEVICES[target].emptyName;
      bySlot.set(slot, { entry: { slot, name: empty, prst: applyEdits(prepared.prst, { name: empty }) }, conversion: null });
      continue;
    }
    const name = stored || DEVICES[prepared.from].emptyName;
    const conversion = prepared.converted ? { slot, name, from: prepared.from, dropped: prepared.dropped } : null;
    bySlot.set(slot, { entry: { slot, name, prst: prepared.prst }, conversion });
  }
  const sorted = [...bySlot.values()].sort((a, b) => a.entry.slot - b.entry.slot);
  return {
    entries: sorted.map((s) => s.entry),
    converted: sorted.flatMap((s) => (s.conversion ? [s.conversion] : [])),
    skipped,
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "Slots 00–99", "Slots 00–04 and 07", "Slot 12" */
export function describeSlots(slots: number[]): string {
  if (!slots.length) return "No slots";
  const runs: [number, number][] = [];
  for (const s of [...slots].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && s === last[1] + 1) last[1] = s;
    else runs.push([s, s]);
  }
  const parts = runs.map(([a, b]) => (a === b ? pad2(a) : `${pad2(a)}–${pad2(b)}`));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `${slots.length === 1 ? "Slot" : "Slots"} ${list}`;
}
