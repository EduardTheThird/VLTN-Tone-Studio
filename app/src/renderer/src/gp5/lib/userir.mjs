// User IR (CAB impulse response) upload format of the Valeton GP-5. Pure, isomorphic ESM, zero dependencies.
//
// Valeton Suite 2.1.0 sends an IR as ONE command, built field for field like the SnapTone import:
//   [0x11, 0x21, nId u32 = 0, fxId u32 = 0x0A100000 + slot, name[16], node[16] = 0, fPara f32[8] = 0, data[2048]]
//   = 2122 B, 112 frames, same per-frame ACK transport as SnapTone (no final reply).
// Evidence (Suite 2.1.0 Dart, Android arm64 build): PresetModel.importIR 0x7bc550 (payload, addSendData(33),
// charArray length 2048), ImportIRHelper._wavFileBytes2ListInt 0x815c14 (sample packing), PresetUtils.getFixId
// 0x814fac + module_data.json "User IR 1..20" (fxid), ImportIRHelper.importIrIndex (name rule = SnapTone's).
// Accepted by a GP-5 on 2026-10-10 (112 ACKs, 0x20 read-back).
//
// Data block: the first 512 samples of the IR at 44.1 kHz, each the sign-extended 24-bit value stored as int32
// little-endian (NOT left-justified), zero-padded to 2048 bytes. No header, size or CRC.

import { CMD, toBytes } from "./protocol.mjs";
import { decodeFileImport, encodeFileImport, sanitizeUserIrName } from "./snaptone.mjs";

export const USER_IR = Object.freeze({
  SLOTS: 20,
  SAMPLES: 512,
  DATA_BYTES: 2048,
  RATE: 44100,
  FXID_BASE: 0x0a100000, // CAB fxid of "User IR 1"; slot n = FXID_BASE + n
});

const S24_MIN = -0x800000;
const S24_MAX = 0x7fffff;

export const isUserIrSlot = (slot) => Number.isInteger(slot) && slot >= 0 && slot < USER_IR.SLOTS;

/** CAB-block fxid of User IR slot `slot` (0..19). */
export function userIrFxId(slot) {
  if (!isUserIrSlot(slot)) throw new RangeError(`User IR slot must be 0..${USER_IR.SLOTS - 1}, got ${slot}`);
  return USER_IR.FXID_BASE + slot;
}

/** 24-bit samples (44.1 kHz) -> 2048-byte data block: first 512 as int32 LE, rest zero. */
export function encodeUserIrData(samples24) {
  const out = new Uint8Array(USER_IR.DATA_BYTES);
  const dv = new DataView(out.buffer);
  const n = Math.min(samples24.length, USER_IR.SAMPLES);
  for (let i = 0; i < n; i++) {
    const s = samples24[i];
    if (!Number.isInteger(s) || s < S24_MIN || s > S24_MAX) throw new RangeError(`User IR sample ${i} is not a 24-bit integer: ${s}`);
    dv.setInt32(i * 4, s, true);
  }
  return out;
}

/** Command payload that imports the 2048-byte `data` block into User IR slot `slot` (0..19) as `name`. */
export function encodeImportUserIr(slot, name, data) {
  const fxId = userIrFxId(slot);
  const d = toBytes(data);
  if (d.length !== USER_IR.DATA_BYTES) throw new Error(`a User IR data block is ${USER_IR.DATA_BYTES} bytes, got ${d.length}`);
  return encodeFileImport(CMD.IMPORT_USER_IR, fxId, sanitizeUserIrName(name), d);
}

/** Inverse of encodeImportUserIr (mock pedal, tests): { slot, name, data } or null if it is not a User IR import. */
export function decodeImportUserIr(payload) {
  const up = decodeFileImport(payload, CMD.IMPORT_USER_IR, USER_IR.FXID_BASE, USER_IR.DATA_BYTES);
  return up && isUserIrSlot(up.slot) ? up : null;
}
