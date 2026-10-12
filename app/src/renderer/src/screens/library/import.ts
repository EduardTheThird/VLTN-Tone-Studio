// Import: validate picked/dropped .prst files with the toolkit, then copy them into "Imported files".
import { isCrcValid } from "@/gp5/lib/prst.mjs";
import { isChecksumValid } from "@/gp200/lib/prst.mjs";
import { host } from "@/host";
import { isGp5Family } from "@/state/device-model";
import type { DeviceKey } from "@/state/device-types";
import { orderError, toPresetState } from "@/state/preset-codec";
import { PRST_MODELS, profileFor, sniffPrst } from "@shared/devices";
import { IMPORTED_ID, type LocalPreset, type NewPreset, type PickedFile } from "@shared/host/files";

export interface Rejected {
  fileName: string;
  reason: string;
}

const NOT_A_PRESET = `Not a ${PRST_MODELS} preset.`;

/** Check one preset file of any model as stored; converting for the connected pedal happens when it is written. */
export function checkPrst(bytes: Uint8Array): { ok: true; name: string; device: DeviceKey } | { ok: false; reason: string } {
  const device = sniffPrst(bytes);
  if (!device) return { ok: false, reason: NOT_A_PRESET };
  try {
    const p = toPresetState(0, bytes);
    // The GP-150's file checksum (offset 0x0E) is not known: its files are checked by layout and chain only.
    const checksumOk = isGp5Family(device) ? isCrcValid(bytes) : profileFor(device).family === "gp200" ? isChecksumValid(bytes) : true;
    if (!checksumOk) return { ok: false, reason: "The file is damaged (its checksum doesn't match)." };
    if (orderError(device, p.order)) return { ok: false, reason: "The file is damaged (its chain order is invalid)." };
    return { ok: true, name: p.name || "Untitled", device };
  } catch {
    return { ok: false, reason: NOT_A_PRESET };
  }
}

/** Validate and store; returns what was added and what was turned away (with reasons). */
export async function importPicked(files: PickedFile[]): Promise<{ added: LocalPreset[]; rejected: Rejected[] }> {
  const rejected: Rejected[] = [];
  const items: NewPreset[] = [];
  for (const f of files) {
    if (f.error || !f.bytes) {
      rejected.push({ fileName: f.fileName, reason: f.error ?? "Couldn't read the file." });
      continue;
    }
    const check = checkPrst(f.bytes);
    if (!check.ok) rejected.push({ fileName: f.fileName, reason: check.reason });
    else items.push({ name: check.name, prst: f.bytes, source: f.fileName, fileName: f.fileName });
  }
  const added = items.length ? await host.files.addPresets(IMPORTED_ID, items) : [];
  return { added, rejected };
}
