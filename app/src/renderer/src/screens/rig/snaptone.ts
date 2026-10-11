import { snapToneLabel, type DeviceKey, type SlotTables } from "@shared/devices";
import type { BlockState, SlotName } from "@/state/device-types";

/** SnapTone slot (GP-5: 0–79) of an NS fxid. */
export const snapToneIndex = (fxid: number) => fxid & 0xffffff;

/** The slot is one a user can write (GP-5: 50–79); the ones below are factory captures. */
export const isUserSnapTone = (slot: number, snapTone: SlotTables) => slot >= snapTone.userRange[0] && slot <= snapTone.userRange[1];

/** "54 PNTR-CWBYS" from the pedal's SnapTone names when read, else the slot as the pedal numbers it ("SnapTone 54"). */
export function snapToneName(block: BlockState, snapTones: SlotName[] | null, device: DeviceKey): string {
  const n = snapToneIndex(block.fxid);
  const name = snapTones?.find((s) => s.slot === n)?.name;
  return name ? `${n} ${name}` : snapToneLabel(device, n);
}
