// SnapTone (NAM capture) blobs for the GP-200 family. Pure, isomorphic ESM, zero dependencies.
//
// The GP-200 editor runs the same clone pipeline as Valeton Suite for the GP-5 (NAM render -> HTKPA fit -> 0x2288
// "VTSI" blob) and then cuts the second float array (the impulse response) to 1024 taps: 0x88 header + 0x1200 bytes
// of float data = 0x1288 bytes, CRC-16/MODBUS recomputed (RE @0x100115a30 + an MIT upload capture, protocol.md §7).
// The blob travels in record 0x1013, zero-padded to 0x2000 bytes.
//
// Blob layout (little-endian): 0x00 "VTSI" | 0x04 u32 size | 0x08 u16 CRC-16/MODBUS over [0x0C, size) stored
// big-endian | 0x12 type, 0x13 version (both 0) | 0x14 u32 float-data length | 0x78 arr1 {offset, count} |
// 0x80 arr2 {offset, count} | 0x88 float data.

export const SNAPTONE = Object.freeze({
  MAGIC: 0x49535456, // "VTSI" as u32 LE
  CLONE_SIZE: 0x2288, // blob from the clone algorithm
  EXTEND_OFFSET: 0x88,
  EXTEND_SIZE: 0x1200, // GP-200: arr1 (128 floats) + arr2 capped at 1024 taps
  BLOB_SIZE: 0x88 + 0x1200,
  ARR2_MAX: 0x400,
  SLOTS: 10, // 0-4 AMP SnapTone 1-5, 5-9 DST SnapTone 6-10
  AMP_SLOTS: 5,
  FXID_BASE: 0x0f000000, // slot n = FXID_BASE + n (AMP 0x0F000000-04, DST 0x0F000005-09)
});

const readU32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const toBytes = (b) => (b instanceof Uint8Array ? b : Uint8Array.from(b));

/** CRC-16/MODBUS (poly 0xA001 reflected, init 0xFFFF). crc16Modbus("123456789") === 0x4B37. */
export function crc16Modbus(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

const storedCrc = (b) => (b[8] << 8) | b[9];

function checkHeader(b) {
  if (b.length < SNAPTONE.EXTEND_OFFSET) return `SnapTone data is too short (${b.length} bytes)`;
  if (readU32(b, 0) !== SNAPTONE.MAGIC) return "SnapTone data does not start with VTSI";
  const size = readU32(b, 4);
  if (size > b.length || size < 12) return `SnapTone size field ${size} does not fit ${b.length} bytes`;
  if (b[0x12] !== 0 || b[0x13] !== 0) return "SnapTone data is not type 0, version 0";
  if (crc16Modbus(b.subarray(12, size)) !== storedCrc(b)) return "SnapTone CRC-16 mismatch";
  return null;
}

/** Validate a 0x1288-byte GP-200 SnapTone blob (the upload unit). Returns null when valid, else the reason. */
export function checkGp200SnapTone(blob) {
  const b = toBytes(blob);
  const err = checkHeader(b);
  if (err) return err;
  if (b.length !== SNAPTONE.BLOB_SIZE || readU32(b, 4) !== SNAPTONE.BLOB_SIZE) return `a GP-200 SnapTone is ${SNAPTONE.BLOB_SIZE} bytes`;
  if (readU32(b, 0x14) !== SNAPTONE.EXTEND_SIZE) return "SnapTone float-data length is wrong";
  if (readU32(b, 0x84) > SNAPTONE.ARR2_MAX) return "SnapTone impulse response is longer than 1024 taps";
  return null;
}

/**
 * Clone blob (0x2288 bytes from the clone pipeline) -> 0x1288-byte GP-200 SnapTone: keep the header and the first
 * 0x1200 bytes of float data, patch size / float-data length / arr2 count, redo the CRC. A blob that already is a
 * valid GP-200 SnapTone is returned as a copy.
 */
export function toGp200SnapTone(blob) {
  const b = toBytes(blob);
  if (!checkGp200SnapTone(b)) return b.slice();
  const err = checkHeader(b);
  if (err) throw new Error(`Not a SnapTone clone: ${err}`);
  if (readU32(b, 0x14) < SNAPTONE.EXTEND_SIZE || b.length < SNAPTONE.BLOB_SIZE) throw new Error("Not a SnapTone clone: float data is too short");
  const out = b.slice(0, SNAPTONE.BLOB_SIZE);
  const dv = new DataView(out.buffer);
  dv.setUint32(4, SNAPTONE.BLOB_SIZE, true);
  dv.setUint32(0x14, SNAPTONE.EXTEND_SIZE, true);
  dv.setUint32(0x84, Math.min(dv.getUint32(0x84, true), SNAPTONE.ARR2_MAX), true);
  const crc = crc16Modbus(out.subarray(12, SNAPTONE.BLOB_SIZE));
  out[8] = crc >> 8;
  out[9] = crc & 0xff;
  return out;
}

export const isSnapToneSlot = (slot) => Number.isInteger(slot) && slot >= 0 && slot < SNAPTONE.SLOTS;

/** AMP or DST fxid of SnapTone slot 0..9. */
export function snapToneFxid(slot) {
  if (!isSnapToneSlot(slot)) throw new RangeError(`SnapTone slot must be 0..${SNAPTONE.SLOTS - 1}, got ${slot}`);
  return SNAPTONE.FXID_BASE + slot;
}
