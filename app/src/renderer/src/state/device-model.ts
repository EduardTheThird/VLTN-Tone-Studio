// Pedal-model helpers shared by the device store, screens and file flows (GP-5 vs GP-50). Pure: no store access;
// the hook `usePedalName` lives in ./device.
import { DEVICES, GP50_ONLY_FXIDS, convertPrst, detectDevice, parsePrst } from "@/gp5/lib/prst.mjs";
import { encode, packetize } from "@/gp5/lib/protocol.mjs";
import { BLOCK_CODES, type DeviceKey } from "./device-types";

export const DEVICE_KEYS: readonly DeviceKey[] = ["gp5", "gp50"];

/** "GP-5" / "GP-50"; "pedal" when the model is not known yet (reads well in "Connect the pedal"). */
export function pedalName(device: DeviceKey | null): string {
  return device ? DEVICES[device].name : "pedal";
}

/** Copy about what both models share (SnapTones, IRs) or before any pedal was connected. */
export const BOTH_PEDALS = "GP-5 / GP-50";

/** The connected (or last connected) pedal's name, else both models. */
export function pedalNameOrBoth(device: DeviceKey | null): string {
  return device ? pedalName(device) : BOTH_PEDALS;
}

/** The name the pedal gives a slot without a user preset. Unknown model: either default name counts. */
export function isEmptySlotName(name: string, device: DeviceKey | null): boolean {
  const n = name.trim();
  return device ? n === DEVICES[device].emptyName : DEVICE_KEYS.some((k) => n === DEVICES[k].emptyName);
}

/** Model a .prst belongs to; throws when the bytes are not a GP-5 or GP-50 preset. */
export function presetDevice(prst: Uint8Array): DeviceKey {
  return detectDevice(prst).key as DeviceKey;
}

/** SysEx frames a full preset write of `prst` takes (26 on GP-5, 29 on GP-50). */
export function writeFrameCount(prst: Uint8Array): number {
  return packetize(encode.writePreset(0, prst)).length;
}

/** Blocks of `prst` whose model does not exist on `target`, e.g. ["PRE (PRE C-Wah)"]. Empty when nothing is lost. */
export function modelsMissingOn(prst: Uint8Array, target: DeviceKey): string[] {
  if (target === "gp50") return []; // every GP-5 model exists on the GP-50
  return parsePrst(prst).blocks.flatMap((b: { fxid: number }, k: number) => {
    const only = (GP50_ONLY_FXIDS as Record<number, string>)[b.fxid >>> 0];
    return only ? [`${BLOCK_CODES[k]} (${only})`] : [];
  });
}

export interface PreparedPreset {
  /** Bytes to write: the input when it already matches `target`, else a converted copy */
  prst: Uint8Array;
  from: DeviceKey;
  converted: boolean;
  /** Blocks cleared because their model does not exist on `target` (see modelsMissingOn) */
  dropped: string[];
}

/**
 * Make `prst` writable to a `target` pedal. GP-5 → GP-50 is lossless; GP-50 → GP-5 clears GP-50-only models,
 * which callers MUST show the user (the `dropped` list) before writing.
 */
export function prepareForDevice(prst: Uint8Array, target: DeviceKey): PreparedPreset {
  const from = presetDevice(prst);
  if (from === target) return { prst, from, converted: false, dropped: [] };
  const dropped = modelsMissingOn(prst, target);
  return { prst: convertPrst(prst, target, { force: dropped.length > 0 }), from, converted: true, dropped };
}
