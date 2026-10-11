// Valeton GP-5 / GP-50 .prst preset codec. Pure isomorphic ESM.
// Port of drewmerc302/valeton-gp50 app/static/prst.js (MIT, (c) 2026 Andrew Mercurio) restructured around a
// parsed preset object. Both devices share the container; GP-5 = 507 bytes, GP-50 = 552 bytes. Layout (GP-5):
//   0x00 20-byte header "GP-5\0..\0\x01\0"   0x14 CRC-8/0x07 over [0x15:]   0x15 FF FF FF FF
//   0x19 16-byte name (latin1, NUL padded)   0x29 body = TLV chain [u16 tag][u16 len][payload]:
//     0x00FF (16)  constant prefix + devtag 0a 45 4d 51
//     0x0000 (16)  constant 01 10 04 00 0a 00 00 00 02 10 04 00 08 00 00 00
//     0x0001 (16)  settings: [01 20 04 00 u32 VOL][02 20 04 00 u32 BPM]
//     0x0002 (390) tone: [01 30 04 00 u32 enable mask][02 30 0a 00 order[10]][03 30 28 00 10 x u32 fxid][04 30 40 01 80 x f32]
//     0x0003 (8)   footswitch masks fs1 u32, fs2 u32
// GP-50 differences: header "GP-50", devtag "GP50", settings 0x0001 = 59 bytes (u8 VOL, u32 BPM + the 8 EXP records
// ids 3..10, protocol.mjs PATCH_SETTINGS), footswitch 0x0003 = 10 bytes (masks + 2 state bytes: 06 when the switch has
// blocks and all are enabled, else 05). The 390-byte tone block is identical.

import { BLOCKS, EXP_FIELDS, PATCH_SETTINGS, blockMask, blocksOfMask, crc8, patchSettingValue, u32le } from "./protocol.mjs";

export const NAME_OFF = 0x19;
export const NAME_LEN = 16;
export const BODY_OFF = 0x29;
export const CRC_OFF = 0x14;
export const N_BLOCKS = 10;
export const PARAMS_PER_BLOCK = 8;

const hx = (s) => Uint8Array.from(s.match(/../g), (h) => parseInt(h, 16));
const profile = (key, name, header, length, devtag) =>
  // emptyName: what the pedal names a slot that holds no user preset (the factory default name)
  Object.freeze({ key, name, header: hx(header), length, bodyLength: length - BODY_OFF, devtag: hx(devtag), emptyName: name });
export const DEVICES = Object.freeze({
  gp5: profile("gp5", "GP-5", "47502d3500000000000000000000000000000100", 507, "0a454d51"),
  gp50: profile("gp50", "GP-50", "47502d3530000000000000000000000000000100", 552, "47503530"),
});
export const DEVICE_KEYS = Object.freeze(Object.keys(DEVICES));

/** Profile for a device key ("gp5" | "gp50"); throws on anything else. */
export function deviceProfile(key) {
  const d = DEVICES[key];
  if (!d) throw new RangeError(`unknown device ${JSON.stringify(key)}; known: ${DEVICE_KEYS.join(", ")}`);
  return d;
}

/** Device whose 0x41 body (== .prst[0x29:]) has `length` bytes (466 GP-5, 511 GP-50), or null. */
export function deviceByBodyLength(length) {
  return Object.values(DEVICES).find((d) => d.bodyLength === length) ?? null;
}

const REC = Object.freeze({ MASK: [0x01, 0x30, 0x04, 0x00], ORDER: [0x02, 0x30, 0x0a, 0x00], MODELS: [0x03, 0x30, 0x28, 0x00], PARAMS: [0x04, 0x30, 0x40, 0x01] });
/** fxids that exist only on the GP-50. */
export const GP50_ONLY_FXIDS = Object.freeze({ 0x01000001: "PRE AC Sim", 0x05000008: "PRE C-Wah", 0x0a00003c: "CAB AC" });
/** Blocks that may move in the chain; DST, NS, AMP, CAB, EQ form a fixed contiguous core in this order. */
export const MOVABLE_BLOCKS = Object.freeze([0, 1, 6, 7, 8]);
export const CORE_SEQUENCE = Object.freeze([2, 9, 3, 4, 5]);
export const DEFAULT_ORDER = Object.freeze([0, 1, 2, 9, 3, 4, 5, 6, 7, 8]);

const u8 = (b) => (b instanceof Uint8Array ? b : Uint8Array.from(b));
const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
function find(hay, needle, from = 0) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
const tlv = (tag, payload) => {
  const out = new Uint8Array(4 + payload.length);
  view(out).setUint16(0, tag, true);
  view(out).setUint16(2, payload.length, true);
  out.set(payload, 4);
  return out;
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** Identify the device a .prst belongs to (header first, then length). */
export function detectDevice(prst) {
  const b = u8(prst);
  for (const d of Object.values(DEVICES)) if (d.header.every((v, i) => b[i] === v)) return d;
  for (const d of Object.values(DEVICES)) if (b.length === d.length) return d;
  throw new Error(`unrecognized .prst (length ${b.length})`);
}

export function computeCrc(prst) {
  return crc8(u8(prst).subarray(CRC_OFF + 1));
}
export function isCrcValid(prst) {
  return u8(prst)[CRC_OFF] === computeCrc(prst);
}
/** Recompute the file CRC in place; returns the buffer. */
export function refixCrc(prst) {
  prst[CRC_OFF] = computeCrc(prst);
  return prst;
}

/** Walk the body TLV chain -> [{ tag, offset (absolute, of payload), length }]. */
export function listRecords(prst) {
  const b = u8(prst);
  const d = view(b);
  const out = [];
  for (let off = BODY_OFF; off + 4 <= b.length; ) {
    const tag = d.getUint16(off, true);
    const length = d.getUint16(off + 2, true);
    if (off + 4 + length > b.length) throw new Error(`TLV 0x${tag.toString(16)} at 0x${off.toString(16)} overruns the file`);
    out.push({ tag, offset: off + 4, length });
    off += 4 + length;
  }
  return out;
}

function toneOffsets(b) {
  const at = (rec) => {
    const i = find(b, rec, BODY_OFF);
    if (i < 0) throw new Error(`tone record ${rec.map((x) => x.toString(16)).join(" ")} not found`);
    return i + 4;
  };
  return { mask: at(REC.MASK), order: at(REC.ORDER), models: at(REC.MODELS), params: at(REC.PARAMS) };
}

/** Name helpers (16 bytes in the file; the device's rename/save commands carry only 10). */
export function readName(prst) {
  const b = u8(prst);
  let s = "";
  for (let i = NAME_OFF; i < NAME_OFF + NAME_LEN && b[i]; i++) s += String.fromCharCode(b[i]);
  return s.trim();
}
function writeName(b, name) {
  const s = String(name);
  for (let i = 0; i < NAME_LEN; i++) {
    const c = i < s.length ? s.charCodeAt(i) : 0;
    if (i < s.length && (c < 0x20 || c > 0x7e)) throw new RangeError(`name must be printable ASCII: ${JSON.stringify(s)}`);
    b[NAME_OFF + i] = c;
  }
}

const SETTING_FIELD = Object.freeze(Object.fromEntries(Object.entries(PATCH_SETTINGS).map(([field, s]) => [s.id, field])));
/** Byte size of each settings TLV entry by id. GP-5: VOL and BPM as u32; GP-50 (Suite 2.1.0 RE) below. */
export const SETTING_SIZES = Object.freeze({ gp5: Object.freeze({ 1: 4, 2: 4 }), gp50: Object.freeze({ 1: 1, 2: 4, 3: 1, 4: 4, 5: 4, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1 }) });
/** EXP settings of an empty GP-50 slot (gp50-blank.prst). */
export const EXP_DEFAULTS = Object.freeze({ on: false, paramMin: 0, paramMax: 100, volPosition: 0, volMin: 0, volMax: 100, targetModule: 0, targetParam: 0 });

/** Call fn(field, valueOffset, size) for every entry of the settings record 0x0001. */
function forEachSetting(b, rec, fn) {
  const d = view(b);
  for (let i = rec.offset; i + 4 <= rec.offset + rec.length; ) {
    const len = d.getUint16(i + 2, true);
    fn(SETTING_FIELD[b[i]], i + 4, len);
    i += 4 + len;
  }
}

/** Settings record 0x0001 (absent = the defaults) -> { volume, bpm, exp? (GP-50) }. */
function readSettings(b, rec, device) {
  const d = view(b);
  const raw = {};
  if (rec)
    forEachSetting(b, rec, (field, at, len) => {
      raw[field] = len === 4 ? d.getInt32(at, true) : len === 2 ? d.getUint16(at, true) : b[at];
    });
  const settings = { volume: raw.volume ?? 50, bpm: raw.bpm ?? 120 };
  if (device === "gp50") settings.exp = Object.fromEntries(EXP_FIELDS.map((f) => [f, f === "on" ? raw.on === 1 : (raw[f] ?? EXP_DEFAULTS[f])]));
  return settings;
}

/** GP-50 footswitch state byte (Suite 2.1.0 RE): 06 when the switch has blocks and all of them are enabled, else 05. */
export const footswitchState = (enableMask, fsMask) => (fsMask !== 0 && (enableMask & fsMask) === fsMask ? 0x06 : 0x05);

/**
 * Parse a .prst into a plain object.
 * blocks[k] = { name, enabled, fxid, params: number[8] } in storage order NR..NS.
 * settings = { volume, bpm, exp? } — `exp` (EXP_FIELDS, `on` as a boolean) only for GP-50 presets.
 */
export function parsePrst(prst) {
  const b = u8(prst);
  const device = detectDevice(b);
  if (b.length !== device.length) throw new Error(`${device.name} .prst must be ${device.length} bytes, got ${b.length}`);
  const d = view(b);
  const off = toneOffsets(b);
  const mask = d.getUint32(off.mask, true);
  const order = Array.from(b.subarray(off.order, off.order + N_BLOCKS));
  const blocks = BLOCKS.map((name, k) => ({
    name,
    enabled: !!(mask & (1 << k)),
    fxid: d.getUint32(off.models + k * 4, true),
    params: Array.from({ length: PARAMS_PER_BLOCK }, (_, i) => d.getFloat32(off.params + (k * PARAMS_PER_BLOCK + i) * 4, true)),
  }));
  const recs = listRecords(b);
  const settings = readSettings(b, recs.find((r) => r.tag === 0x0001), device.key);
  const fsRec = recs.find((r) => r.tag === 0x0003);
  const footswitches = fsRec
    ? { fs1: blocksOfMask(d.getUint32(fsRec.offset, true)), fs2: blocksOfMask(d.getUint32(fsRec.offset + 4, true)) }
    : { fs1: [], fs2: [] };
  return { device: device.key, name: readName(b), crcValid: isCrcValid(b), mask, order, blocks, settings, footswitches };
}

/** Validate a chain order: permutation of 0..9 with the fixed core DST,NS,AMP,CAB,EQ contiguous. */
export function validateOrder(order) {
  if (!Array.isArray(order) || order.length !== N_BLOCKS || new Set(order).size !== N_BLOCKS || order.some((v) => !Number.isInteger(v) || v < 0 || v > 9))
    return "order must be a permutation of 0..9";
  const start = order.indexOf(CORE_SEQUENCE[0]);
  if (CORE_SEQUENCE.some((blk, i) => order[start + i] !== blk)) return "DST, NS, AMP, CAB, EQ must stay contiguous in that order";
  return null;
}

/** Most blocks one GP-50 footswitch may switch (Suite UI rule). */
export const MAX_FOOTSWITCH_BLOCKS = 3;

/** Validate GP-50 footswitch assignments: block indices 0..9, at most 3 per switch, no block on both. null = valid. */
export function validateFootswitches(fs1, fs2) {
  for (const [label, list] of [["FS1", fs1], ["FS2", fs2]]) {
    if (!Array.isArray(list) || new Set(list).size !== list.length || list.some((k) => !Number.isInteger(k) || k < 0 || k > 9))
      return `${label} must list distinct block indices 0..9`;
    if (list.length > MAX_FOOTSWITCH_BLOCKS) return `${label} can switch at most ${MAX_FOOTSWITCH_BLOCKS} blocks`;
  }
  if (fs1.some((k) => fs2.includes(k))) return "a block can be on one footswitch only";
  return null;
}

function applySettings(b, rec, edits, device) {
  const d = view(b);
  const values = {};
  if (edits.volume !== undefined) values.volume = Math.max(0, Math.min(100, Math.trunc(edits.volume)));
  if (edits.bpm !== undefined) values.bpm = Math.max(PATCH_SETTINGS.bpm.min, Math.min(PATCH_SETTINGS.bpm.max, Math.trunc(edits.bpm)));
  if (edits.exp) {
    if (device !== "gp50") throw new RangeError("only GP-50 presets have EXP settings");
    for (const [field, v] of Object.entries(edits.exp)) {
      if (!EXP_FIELDS.includes(field)) throw new RangeError(`unknown EXP setting ${field}`);
      values[field] = patchSettingValue(field, v);
    }
  }
  forEachSetting(b, rec, (field, at, len) => {
    if (values[field] === undefined) return;
    if (len === 4) d.setInt32(at, values[field], true);
    else b[at] = values[field];
  });
}

/** Write the footswitch masks (both models) and, on a GP-50, recompute the two state bytes from the enable mask. */
function applyFootswitches(b, rec, device, enableMask, edit) {
  const d = view(b);
  const fs1 = edit?.fs1 ?? blocksOfMask(d.getUint32(rec.offset, true));
  const fs2 = edit?.fs2 ?? blocksOfMask(d.getUint32(rec.offset + 4, true));
  if (device === "gp50") {
    const err = validateFootswitches(fs1, fs2);
    if (err) throw new RangeError(err);
  }
  d.setUint32(rec.offset, blockMask(fs1), true);
  d.setUint32(rec.offset + 4, blockMask(fs2), true);
  if (device === "gp50") b.set([footswitchState(enableMask, blockMask(fs1)), footswitchState(enableMask, blockMask(fs2))], rec.offset + 8);
}

/**
 * Return a NEW .prst with edits applied and CRC fixed. edits:
 *  { name, volume (0..100), bpm (40..260), exp: Partial<{ on, paramMin, paramMax, volPosition, volMin, volMax,
 *    targetModule, targetParam }> (GP-50 only), order: number[10], footswitches: { fs1?: number[], fs2?: number[] },
 *    blocks: { [blockIndexOrName]: { enabled?, fxid?, params?: { [algId]: value } } } }
 * On a GP-50 a footswitch or on/off edit also recomputes the footswitch state bytes; footswitches are validated
 * with validateFootswitches.
 */
export function applyEdits(prst, edits = {}) {
  const b = Uint8Array.from(u8(prst));
  const device = detectDevice(b).key;
  const d = view(b);
  const off = toneOffsets(b);
  let enableChanged = false;
  for (const [key, e] of Object.entries(edits.blocks ?? {})) {
    const k = /^\d+$/.test(key) ? Number(key) : BLOCKS.indexOf(key.toUpperCase());
    if (k < 0 || k > 9) throw new RangeError(`unknown block ${key}`);
    if (e.fxid !== undefined) d.setUint32(off.models + k * 4, e.fxid >>> 0, true);
    if (e.enabled !== undefined) {
      const m = d.getUint32(off.mask, true);
      d.setUint32(off.mask, (e.enabled ? m | (1 << k) : m & ~(1 << k)) >>> 0, true);
      enableChanged = true;
    }
    for (const [alg, value] of Object.entries(e.params ?? {})) {
      const i = Number(alg);
      if (!Number.isInteger(i) || i < 0 || i >= PARAMS_PER_BLOCK) throw new RangeError(`param index ${alg} out of range`);
      d.setFloat32(off.params + (k * PARAMS_PER_BLOCK + i) * 4, Number(value), true);
    }
  }
  if (edits.order) {
    const err = validateOrder(edits.order);
    if (err) throw new RangeError(err);
    b.set(edits.order, off.order);
  }
  const recs = listRecords(b);
  if (edits.volume !== undefined || edits.bpm !== undefined || edits.exp) applySettings(b, recs.find((x) => x.tag === 0x0001), edits, device);
  if (edits.footswitches || (enableChanged && device === "gp50"))
    applyFootswitches(b, recs.find((x) => x.tag === 0x0003), device, d.getUint32(off.mask, true), edits.footswitches);
  if (edits.name !== undefined) writeName(b, edits.name);
  return refixCrc(b);
}

/** Rebuild a full .prst from a device read: name (from 0x40) + body (from 0x41) for device `deviceKey`. */
export function rebuildPrst(name, body, deviceKey) {
  const dev = deviceProfile(deviceKey);
  const bb = u8(body);
  if (bb.length !== dev.bodyLength) throw new Error(`expected a ${dev.bodyLength}-byte ${dev.name} body, got ${bb.length}`);
  const out = concat(dev.header, [0], [0xff, 0xff, 0xff, 0xff], new Uint8Array(NAME_LEN), bb);
  writeName(out, name);
  return refixCrc(out);
}

/** Body part of a .prst (what the device returns for read 0x41). */
export const bodyOf = (prst) => u8(prst).slice(BODY_OFF);

/** 390-byte tone record payload: enable mask, order[10], fxid[10], f32 params[80]. */
function tonePayload({ mask, order, fxids, params }) {
  const out = new Uint8Array(390);
  const v = view(out);
  out.set(REC.MASK, 0);
  v.setUint32(4, mask >>> 0, true);
  out.set(REC.ORDER, 8);
  out.set(order, 12);
  out.set(REC.MODELS, 22);
  fxids.forEach((fx, k) => v.setUint32(26 + k * 4, fx >>> 0, true));
  out.set(REC.PARAMS, 66);
  params.forEach((p, i) => v.setFloat32(70 + i * 4, p, true));
  return out;
}

/** Assemble a .prst of `target` from its parts (settings = { volume, bpm, exp? }, tone = 390-byte record payload). */
function assemblePrst(target, name, settings, tone, footswitches) {
  const sizes = SETTING_SIZES[target.key];
  const values = { volume: settings.volume, bpm: settings.bpm, ...(target.key === "gp50" ? { ...EXP_DEFAULTS, ...settings.exp } : {}) };
  const settingsPayload = concat(
    ...Object.entries(sizes).map(([id, size]) => {
      const entry = new Uint8Array(4 + size);
      entry.set([Number(id), 0x20, size, 0]);
      const v = Number(values[SETTING_FIELD[id]]);
      if (size === 4) view(entry).setInt32(4, v, true);
      else entry[4] = v;
      return entry;
    })
  );
  const enableMask = view(tone).getUint32(4, true);
  const fs1 = blockMask(footswitches.fs1);
  const fs2 = blockMask(footswitches.fs2);
  const fsPayload = concat(u32le(fs1), u32le(fs2));
  const fsRecord = target.key === "gp50" ? concat(fsPayload, [footswitchState(enableMask, fs1), footswitchState(enableMask, fs2)]) : fsPayload;
  const body = concat(
    tlv(0x00ff, concat(hx("010004000100000002000400"), target.devtag)),
    tlv(0x0000, hx("011004000a0000000210040008000000")),
    tlv(0x0001, settingsPayload),
    tlv(0x0002, tone),
    tlv(0x0003, fsRecord)
  );
  return rebuildPrst(name, body, target.key);
}

/**
 * Convert GP-50 .prst -> GP-5 (or back). The 390-byte tone block is shared, so this is a re-wrap.
 * GP-5 -> GP-50 gets the blank EXP settings and computed footswitch state bytes; GP-50 -> GP-5 drops EXP.
 * GP-50-only models block conversion unless { force: true } (their model records get zeroed).
 */
export function convertPrst(prst, targetKey, { force = false } = {}) {
  const b = u8(prst);
  const source = detectDevice(b);
  const target = deviceProfile(targetKey);
  if (source.key === target.key) return b.slice();
  const toneRec = listRecords(b).find((r) => r.tag === 0x0002);
  if (!toneRec || toneRec.length !== 390) throw new Error("unexpected tone block");
  const tone = b.slice(toneRec.offset, toneRec.offset + 390);
  const models = find(tone, REC.MODELS) + 4;
  const tv = view(tone);
  const problems = [];
  for (let k = 0; k < N_BLOCKS; k++) {
    const fx = tv.getUint32(models + k * 4, true);
    if (target.key === "gp5" && GP50_ONLY_FXIDS[fx]) problems.push(`${BLOCKS[k]} (${GP50_ONLY_FXIDS[fx]})`);
  }
  if (problems.length && !force) throw new Error(`no GP-5 equivalent for ${problems.join(", ")}; pass { force: true } to drop them`);
  if (force) for (let k = 0; k < N_BLOCKS; k++) if (GP50_ONLY_FXIDS[tv.getUint32(models + k * 4, true)]) tv.setUint32(models + k * 4, 0, true);
  const { settings, footswitches } = parsePrst(b);
  return assemblePrst(target, readName(b), { volume: settings.volume, bpm: settings.bpm }, tone, footswitches);
}

// The empty GP-50 slot (drewmerc302/valeton-gp50 app/static/data/presets.json slot 0, MIT; fixtures/gp50-blank.prst).
const BLANK_FXIDS = [0x1b, 0, 0x03000000, 0x07000001, 0x0a000001, 0x01000035, 0x04000000, 0x0b000000, 0x0c00000b, 0x0f000000];
const BLANK_PARAMS = [[20], [20, 50], [40, 70, 50], [30, 50, 50], [50], [0, 0, 0, 0, 0, 50], [50, 0.5, 50], [20, 500, 30], [30, 0, 50], [50, 50, 50, 50, 50]];

/** A new empty GP-50 preset (what the pedal holds in a cleared slot), named `name`. */
export function blankGp50Prst(name = DEVICES.gp50.emptyName) {
  const params = BLANK_PARAMS.flatMap((p) => [...p, ...new Array(PARAMS_PER_BLOCK - p.length).fill(0)]);
  const tone = tonePayload({ mask: 0, order: DEFAULT_ORDER, fxids: BLANK_FXIDS, params });
  return assemblePrst(DEVICES.gp50, name, { volume: 50, bpm: 120, exp: EXP_DEFAULTS }, tone, { fs1: [], fs2: [] });
}
