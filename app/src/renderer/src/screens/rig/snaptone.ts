import { snapToneLabel, type DeviceKey, type SlotTables } from "@shared/devices";
import { isGp5Family } from "@/state/device-model";
import type { BlockState, SlotName } from "@/state/device-types";
import { isCaptureFxid, modelTitle } from "@/components/gear";

/** SnapTone slot of a SnapTone fxid (GP-5 family: 0–79 in NS; GP-200 family: 0–9 in AMP or DST). */
export const snapToneIndex = (fxid: number) => fxid & 0xffffff;

/** The slot is one a user can write (GP-5: 50–79, below are factory captures; GP-200: all ten). */
export const isUserSnapTone = (slot: number, snapTone: SlotTables) => slot >= snapTone.userRange[0] && slot <= snapTone.userRange[1];

/** The pedal's name for SnapTone slot `n`, when read; the GP-200 family's placeholder for an empty or unlisted slot doesn't count. */
export function slotToneName(n: number, snapTones: SlotName[] | null, device: DeviceKey): string | undefined {
  const s = snapTones?.find((x) => x.slot === n);
  return s && (isGp5Family(device) || (s.kind !== "empty" && s.kind !== "unknown")) ? s.name : undefined;
}

/**
 * "54 PNTR-CWBYS" from the pedal's SnapTone names when read, else the slot as the pedal numbers it ("SnapTone 54").
 * A model of the NS module that is no SnapTone (a GP-150 NAM slot) shows its catalog title.
 */
export function snapToneName(block: BlockState, snapTones: SlotName[] | null, device: DeviceKey): string {
  if (!isCaptureFxid(block.fxid)) return modelTitle(block);
  const n = snapToneIndex(block.fxid);
  const name = slotToneName(n, snapTones, device);
  return name ? `${n} ${name}` : snapToneLabel(device, n);
}
