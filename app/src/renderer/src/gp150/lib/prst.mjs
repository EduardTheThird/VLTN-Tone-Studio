// GP-150 `.prst` codec (the same 1128-byte file as the GP-180). Pure, isomorphic ESM, zero dependencies.
// Layout from the 200 presets and the USB captures of majabojarska/Valeton-GP180-Rev-Eng (GPL-3.0) and the format notes
// of AlbertoBarba's GP150_PRST_FORMAT.md (facts only). The file is a chain of TLV records [u16 tag][u16 len][data],
// little-endian; the live-edit commands use the same tags:
//   0x000 3011 {len 0x464}: u32 slot
//   0x008 3010 {len 0x458; Suite sends 0x45C when it imports}: u16 0x1800, u16 checksum (algorithm unknown; the
//         pedal accepts 0, AlbertoBarba's note), then
//   0x010 FFFF {12 constant bytes}
//   0x020 3020 {80}: u16 tempo, u16 volume, u16 0, u16 NAM mode (0 SnapTone, 1 NAM), name (72, NUL padded)
//   0x074 3030 {828}: chain (12 module indices, signal order), 12 blocks of 68 bytes in module order:
//         u8 enabled, 3 zero, u32 model id, 15 × f32 params
//   0x3B4 3050 {12}: knobs 1-3 {u16 target, u16 param}; target 0-11 a module, 0x0C patch volume, 0x0D tempo, 0xFFFF none
//   0x3C4 3060 {112}: EXP (u32 target, then 9 × {f32 min, f32 max, u16 param, u16 flag})
//   0x438 3070 {4}
//   0x440 3080 {36}: u32 active-module mask, u32 masks of footswitches A, B, C, then 5 × u32

import { BLOCKS, NONE_FXID, PARAM_COUNT, readF32, readName, readU16, readU32, toBytes } from "./protocol.mjs";

export const PRST_SIZE = 1128;
const MAGIC = [0x11, 0x30, 0x64, 0x04];
const RECORD_3010 = [0x10, 0x30];
export const OFFSET = Object.freeze({
  SLOT: 0x04,
  BODY_LEN: 0x0a,
  CHECKSUM: 0x0e,
  CONFIG: 0x10,
  SETTINGS: 0x20,
  CHAIN: 0x78,
  BLOCKS: 0x84,
  KNOBS: 0x3b4,
  EXP: 0x3c4,
  STATE: 0x438,
  CTRL: 0x440,
});
const BLOCK_SIZE = 0x44;
const NAME_AT = OFFSET.SETTINGS + 4 + 8;
export const NAME_LEN = 72;
/** Longest name written: the name list holds 16 bytes per name (factory names reach 13), so 15 keep a closing NUL. */
export const NAME_MAX = 15;
export const EXP_ENTRIES = 9;
export const FOOTSWITCHES = 3;
const BODY_LEN_STORED = 0x458;
const BODY_LEN_IMPORT = 0x45c;

/** Header of an empty file: tags and lengths of every record, the constant FFFF record. */
const TEMPLATE = (() => {
  const b = new Uint8Array(PRST_SIZE);
  const rec = (o, tag, len) => {
    b[o] = tag & 0xff;
    b[o + 1] = tag >> 8;
    b[o + 2] = len & 0xff;
    b[o + 3] = len >> 8;
  };
  rec(0x000, 0x3011, 0x464);
  rec(0x008, 0x3010, BODY_LEN_STORED);
  b[0x0c] = 0x00;
  b[0x0d] = 0x18;
  rec(0x010, 0xffff, 12);
  b.set([0x10, 0x0c, 0x0f, 0x03, 0x03, 0x03, 0x04, 0x10, 0x28, 0x00, 0x00, 0xc8], 0x14);
  rec(0x020, 0x3020, 80);
  rec(0x074, 0x3030, 828);
  rec(0x3b4, 0x3050, 12);
  rec(0x3c4, 0x3060, 112);
  rec(0x438, 0x3070, 4);
  rec(0x440, 0x3080, 36);
  return b;
})();

/** Whether `bytes` are a GP-150 / GP-180 preset file. */
export function isGp150Prst(bytes) {
  const b = toBytes(bytes);
  return b.length === PRST_SIZE && MAGIC.every((v, i) => b[i] === v) && b[8] === RECORD_3010[0] && b[9] === RECORD_3010[1];
}

function check(bytes) {
  const b = toBytes(bytes);
  if (!isGp150Prst(b)) throw new Error(`not a GP-150 preset (${b.length} bytes)`);
  return b;
}

const blockAt = (i) => OFFSET.BLOCKS + i * BLOCK_SIZE;

/** Everything the app reads from a preset file. Unknown bytes stay in the file (edits patch it in place). */
export function parsePrst(bytes) {
  const b = check(bytes);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const blocks = BLOCKS.map((code, index) => {
    const o = blockAt(index);
    const params = [];
    for (let k = 0; k < PARAM_COUNT; k++) params.push(readF32(b, o + 8 + 4 * k));
    return { index, code, enabled: b[o] === 1, fxid: readU32(b, o + 4), params };
  });
  const knobs = [0, 1, 2].map((k) => ({ target: readU16(b, OFFSET.KNOBS + 4 + 4 * k), param: readU16(b, OFFSET.KNOBS + 6 + 4 * k) }));
  const exp = {
    target: readU32(b, OFFSET.EXP + 4),
    entries: Array.from({ length: EXP_ENTRIES }, (_, k) => {
      const o = OFFSET.EXP + 8 + 12 * k;
      return { min: view.getFloat32(o, true), max: view.getFloat32(o + 4, true), param: readU16(b, o + 8), flag: readU16(b, o + 10) };
    }),
  };
  const ctrlAt = OFFSET.CTRL + 4;
  return {
    slot: readU32(b, OFFSET.SLOT),
    name: readName(b, NAME_AT, NAME_LEN),
    tempo: readU16(b, OFFSET.SETTINGS + 4),
    volume: readU16(b, OFFSET.SETTINGS + 6),
    namMode: readU16(b, OFFSET.SETTINGS + 10),
    chain: [...b.subarray(OFFSET.CHAIN, OFFSET.CHAIN + BLOCKS.length)],
    blocks,
    knobs,
    exp,
    footswitches: Array.from({ length: FOOTSWITCHES }, (_, k) => readU32(b, ctrlAt + 4 + 4 * k)),
    activeMask: readU32(b, ctrlAt),
  };
}

/** Block indices set in a module mask, and back. */
export const blocksOfMask = (mask) => BLOCKS.flatMap((_, k) => (mask & (1 << k) ? [k] : []));
export function maskOf(blocks) {
  if (new Set(blocks).size !== blocks.length || !blocks.every((k) => Number.isInteger(k) && k >= 0 && k < BLOCKS.length))
    throw new RangeError(`A footswitch takes distinct modules 0..${BLOCKS.length - 1}, got ${JSON.stringify(blocks)}`);
  return blocks.reduce((m, k) => m | (1 << k), 0);
}

/** Whether `chain` is a permutation of the 12 modules. */
export const validChain = (chain) => chain.length === BLOCKS.length && new Set(chain).size === BLOCKS.length && chain.every((k) => Number.isInteger(k) && k >= 0 && k < BLOCKS.length);

/** The 80-byte patch-settings record of a preset (the live 0x3020 command sends it whole). */
export const settingsRecord = (bytes) => check(bytes).slice(OFFSET.SETTINGS + 4, OFFSET.SETTINGS + 4 + 80);
export const ctrlRecord = (bytes) => check(bytes).slice(OFFSET.CTRL + 4, OFFSET.CTRL + 4 + 36);
export const expRecord = (bytes) => check(bytes).slice(OFFSET.EXP + 4, OFFSET.EXP + 4 + 112);

/** ASCII name, at most NAME_MAX characters. */
function writeName(b, name) {
  b.fill(0, NAME_AT, NAME_AT + NAME_LEN);
  const s = String(name).slice(0, NAME_MAX);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    b[NAME_AT + i] = c >= 0x20 && c < 0x7f ? c : 0x3f;
  }
}

/**
 * New preset file with `edits` applied to `bytes` (or an empty preset). Edits: { slot, name, tempo, volume, namMode,
 * chain, blocks: { [index]: { enabled, fxid, params: { [id]: value } } }, knobs: { [k]: { target, param } },
 * footswitches: number[][] (modules per footswitch) }. The checksum is cleared on any change.
 */
export function applyPatchEdits(bytes, edits = {}) {
  const b = bytes ? check(bytes).slice() : TEMPLATE.slice();
  const view = new DataView(b.buffer);
  const before = bytes ? toBytes(bytes) : null;
  if (edits.slot !== undefined) view.setUint32(OFFSET.SLOT, edits.slot >>> 0, true);
  if (edits.name !== undefined) writeName(b, edits.name);
  if (edits.tempo !== undefined) view.setUint16(OFFSET.SETTINGS + 4, Math.round(edits.tempo), true);
  if (edits.volume !== undefined) view.setUint16(OFFSET.SETTINGS + 6, Math.round(edits.volume), true);
  if (edits.namMode !== undefined) view.setUint16(OFFSET.SETTINGS + 10, edits.namMode ? 1 : 0, true);
  if (edits.chain) {
    if (!validChain(edits.chain)) throw new RangeError(`The chain must hold each of the ${BLOCKS.length} modules once, got ${JSON.stringify(edits.chain)}`);
    b.set(edits.chain, OFFSET.CHAIN);
  }
  for (const [k, e] of Object.entries(edits.blocks ?? {})) {
    const i = Number(k);
    if (!(i >= 0 && i < BLOCKS.length)) throw new RangeError(`no module ${k}`);
    const o = blockAt(i);
    if (e.enabled !== undefined) b[o] = e.enabled ? 1 : 0;
    if (e.fxid !== undefined) view.setUint32(o + 4, e.fxid >>> 0, true);
    for (const [p, v] of Object.entries(e.params ?? {})) {
      const id = Number(p);
      if (!(id >= 0 && id < PARAM_COUNT)) throw new RangeError(`no param ${p}`);
      view.setFloat32(o + 8 + 4 * id, v, true);
    }
  }
  for (const [k, knob] of Object.entries(edits.knobs ?? {})) {
    const o = OFFSET.KNOBS + 4 + 4 * Number(k);
    if (knob.target !== undefined) view.setUint16(o, knob.target, true);
    if (knob.param !== undefined) view.setUint16(o + 2, knob.param, true);
  }
  if (edits.footswitches) {
    if (edits.footswitches.length > FOOTSWITCHES) throw new RangeError(`at most ${FOOTSWITCHES} footswitches`);
    edits.footswitches.forEach((blocks, k) => view.setUint32(OFFSET.CTRL + 8 + 4 * k, maskOf(blocks), true));
  }
  // The active-module mask follows the blocks' on/off state.
  const active = BLOCKS.reduce((m, _, i) => (b[blockAt(i)] === 1 ? m | (1 << i) : m), 0);
  view.setUint32(OFFSET.CTRL + 4, active, true);
  if (!before || !imagesMatch(before, b)) view.setUint16(OFFSET.CHECKSUM, 0, true);
  return b;
}

/** An empty preset: every module empty ("None") and off, VOL on, tempo 120, volume 50. */
export function blankPrst(slot = 0, name = "INIT") {
  const blocks = Object.fromEntries(BLOCKS.map((code, i) => [i, { enabled: code === "VOL", fxid: NONE_FXID, params: { 0: 100 } }]));
  return applyPatchEdits(null, { slot, name, tempo: 120, volume: 50, chain: [5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11], blocks, knobs: { 0: { target: 0x0c, param: 0 }, 1: { target: 0x0d, param: 0 }, 2: { target: 0xffff, param: 0 } } });
}

/** The file Suite sends to write a preset into `slot`: slot set, 3010 length 0x45C. */
export function forImport(bytes, slot) {
  const b = applyPatchEdits(bytes, { slot });
  b[OFFSET.CHECKSUM] = toBytes(bytes)[OFFSET.CHECKSUM];
  b[OFFSET.CHECKSUM + 1] = toBytes(bytes)[OFFSET.CHECKSUM + 1];
  new DataView(b.buffer).setUint16(OFFSET.BODY_LEN, BODY_LEN_IMPORT, true);
  return b;
}

/** The stored form of a preset read back or imported (3010 length 0x458). */
export function normalize(bytes) {
  const b = check(bytes).slice();
  new DataView(b.buffer).setUint16(OFFSET.BODY_LEN, BODY_LEN_STORED, true);
  return b;
}

/** Same sound and settings: everything from the FFFF record on is equal (slot, length field and checksum aside). */
export function imagesMatch(a, b) {
  const x = toBytes(a);
  const y = toBytes(b);
  if (x.length !== PRST_SIZE || y.length !== PRST_SIZE) return false;
  for (let i = OFFSET.CONFIG; i < PRST_SIZE; i++) if (x[i] !== y[i]) return false;
  return true;
}

export const prstName = (bytes) => parsePrst(bytes).name;
