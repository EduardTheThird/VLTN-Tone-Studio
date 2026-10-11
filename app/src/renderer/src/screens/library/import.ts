// Import: validate picked/dropped .prst files with the toolkit, then copy them into "Imported files".
import { isCrcValid, parsePrst, validateOrder } from "@/gp5/lib/prst.mjs";
import { host } from "@/host";
import { isGp5Family, pedalName } from "@/state/device-model";
import type { Gp5FamilyKey } from "@/state/device-types";
import { PRST_MODELS, sniffPrst } from "@shared/devices";
import { IMPORTED_ID, type LocalPreset, type NewPreset, type PickedFile } from "@shared/host/files";

export interface Rejected {
  fileName: string;
  reason: string;
}

const NOT_A_PRESET = `Not a ${PRST_MODELS} preset.`;

/** Check one file of either GP-5 family model as stored; converting for the connected pedal happens when it is written. */
export function checkPrst(bytes: Uint8Array): { ok: true; name: string; device: Gp5FamilyKey } | { ok: false; reason: string } {
  const device = sniffPrst(bytes);
  if (!device) return { ok: false, reason: NOT_A_PRESET };
  // A recognised preset of a family the library can't edit yet gets its own reason, not a parse error.
  if (!isGp5Family(device)) return { ok: false, reason: `${pedalName(device)} presets can't be opened in this version yet.` };
  try {
    const p = parsePrst(bytes);
    if (!isCrcValid(bytes)) return { ok: false, reason: "The file is damaged (its checksum doesn't match)." };
    if (validateOrder(p.order)) return { ok: false, reason: "The file is damaged (its chain order is invalid)." };
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
