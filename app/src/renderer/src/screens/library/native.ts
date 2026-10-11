// In-pedal preset management (GP-50 delete / copy / move): always back up the slots it replaces first, then let the
// pedal do it. The store re-reads the names (and the active preset when it was affected) afterwards.
import { host } from "@/host";
import { useDevice } from "@/state/device";
import { REPLACED_ID } from "@shared/host/files";
import { slotsToRead, type NativeOp, type Step } from "./plans";
import { emptyName, isEmptyName, useLibrary } from "./store";

/** Current preset of a slot: the saved body of the active slot, otherwise a read (the GP-50 export read leaves the active preset alone). */
export async function readSlot(slot: number): Promise<Uint8Array> {
  const d = useDevice.getState();
  const prst = d.slot === slot && d.saved ? d.saved.prst : await d.readPreset(slot);
  useLibrary.getState().setBody(slot, prst, "pedal");
  return prst;
}

function runOp(op: NativeOp): Promise<void> {
  const d = useDevice.getState();
  if (op.kind === "delete") return d.deletePresets(op.slots);
  if (op.kind === "copy") return d.copyPreset(op.from, op.to);
  return d.movePreset(op.from, op.to);
}

/** After a native command: the bodies it moved are known (read up front), the cleared ones are not. */
function noteResult(steps: readonly Step[], read: ReadonlyMap<number | "blank", Uint8Array>) {
  const bodies = { ...useLibrary.getState().bodies };
  const at = new Date().toISOString();
  for (const s of steps) {
    const prst = s.from === "blank" ? undefined : read.get(s.from);
    if (prst) bodies[s.slot] = { prst, from: "pedal", at };
    else delete bodies[s.slot];
  }
  useLibrary.setState({ bodies });
}

/**
 * Read `sources` and, when backing up, every replaced (non-empty) slot of `steps`, then save the replaced ones to
 * Replaced presets (once: skipped when `backedUp`). Bodies already in `read` are not read again.
 */
export async function readAndBackUp(job: {
  steps: readonly Step[];
  sources: number[];
  backUp: boolean;
  backedUp: boolean;
  pedal: string;
  read: Map<number | "blank", Uint8Array>;
  /** `done` of `reads` slots read so far */
  onStatus?(text: string, done: number, reads: number): void;
}): Promise<{ replaced: number[]; toRead: number[]; backedUp: boolean }> {
  const names = useDevice.getState().names;
  const nameOf = (slot: number) => names[slot]?.name ?? emptyName();
  const replaced = job.steps.filter((s) => !isEmptyName(nameOf(s.slot))).map((s) => s.slot);
  const backUp = job.backUp && replaced.length > 0 && !job.backedUp;
  const toRead = backUp ? [...new Set([...job.sources, ...replaced])].sort((a, b) => a - b) : job.sources;
  for (const [i, slot] of toRead.entries()) {
    if (job.read.has(slot)) continue;
    job.onStatus?.(`Reading slot ${slot}`, i, toRead.length);
    job.read.set(slot, await readSlot(slot));
  }
  if (backUp) {
    job.onStatus?.("Saving the replaced slots", toRead.length, toRead.length);
    await host.files.addPresets(
      REPLACED_ID,
      replaced.map((slot) => ({ name: nameOf(slot), prst: job.read.get(slot)!, slot, source: `Slot ${slot} on ${job.pedal}` })),
    );
  }
  return { replaced, toRead, backedUp: job.backedUp || backUp };
}

export interface NativeRun {
  op: NativeOp;
  /** Preview of the result (plans.ts), slot ← content */
  steps: readonly Step[];
  /** Pedal name for the backup's source line ("GP-50") */
  pedal: string;
  /** Bodies already read (kept across a retry; the dialog's map also holds its "blank" preset) */
  read: Map<number | "blank", Uint8Array>;
  /** The replaced slots are already in Replaced presets (a retry) */
  backedUp: boolean;
  onStatus?(text: string, progress: number): void;
}

/**
 * Read the sources and every replaced (non-empty) slot, save the replaced ones to Replaced presets, then run the
 * command on the pedal. Resolves with the slots that were backed up (empty when nothing was replaced).
 */
export async function runNative(run: NativeRun): Promise<number[]> {
  const job = await readAndBackUp({ ...run, sources: slotsToRead([...run.steps]), backUp: true, onStatus: (text, done, reads) => run.onStatus?.(text, done / (reads + 1)) });
  run.backedUp = job.backedUp;
  const { replaced, toRead } = job;
  const total = toRead.length + 1;
  run.onStatus?.(`The ${run.pedal} is changing ${run.steps.length === 1 ? "the slot" : `${run.steps.length} slots`}`, toRead.length / total);
  await runOp(run.op);
  noteResult(run.steps, run.read);
  run.onStatus?.("Done", 1);
  return replaced;
}
