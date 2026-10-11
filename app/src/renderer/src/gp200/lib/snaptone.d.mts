// Type declarations for snaptone.mjs (the JS stays the tested source of truth; keep these in sync).
import type { Bytes } from "./protocol.mjs";

export const SNAPTONE: Readonly<{
  MAGIC: number;
  CLONE_SIZE: 0x2288;
  EXTEND_OFFSET: 0x88;
  EXTEND_SIZE: 0x1200;
  BLOB_SIZE: 0x1288;
  ARR2_MAX: 0x400;
  SLOTS: 10;
  AMP_SLOTS: 5;
  FXID_BASE: number;
}>;
export function crc16Modbus(bytes: Iterable<number>): number;
/** null when `blob` is a valid 0x1288-byte GP-200 SnapTone, else the reason. */
export function checkGp200SnapTone(blob: Bytes): string | null;
/** 0x2288 clone (or a GP-200 blob) -> 0x1288-byte GP-200 SnapTone; throws Error on anything else. */
export function toGp200SnapTone(blob: Bytes): Uint8Array;
export function isSnapToneSlot(slot: number): boolean;
export function snapToneFxid(slot: number): number;
