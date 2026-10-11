// GP-200 patch image (1168 bytes of TLV records) and the 1224-byte `.prst` file. Pure, isomorphic ESM.
// Evidence: static RE of the GP-200 editor 1.8.0 (export @0x100135e50, import @0x10014b7a0).
//
// Image (editor order): 0x0002 info (88) | 0x0008 chain (16) | 0x0014 x 11 blocks (68) | 0x000C x 9 EXP slots (12) |
//   0x0010 x 3 Quick-Access knobs (4) | 0x000F x 8 CTRL masks (8). Files from editors before 1.4.0 have 4 CTRL records
//   (1120-byte image, 1176-byte file). Always walk the TLVs; never trust fixed offsets.
// .prst: "TSRP" | 0x0A u16 firmware tag | "2-PG" @0x10 | u16 0x0100 | u16 layout (1 patch, 2 + RISU User-IR chunk) |
//   0x20 chunk table {u32 offset 0x28, u32 size} | "MRAP" | u32 size | image | u32 own file position (the editor's
//   CRC-32 slot) | u32 BIG-endian byte sum of everything before it (the only check the importer does).
//   The MRAP size covers the image plus the 4-byte position word ("data minus last 4 bytes" on import); the chunk
//   table size adds the 8-byte chunk header (inferred from the layout; the importer does not check it).

import { BLOCKS, REC, TARGET, imageWithSlot, readAscii, readF32, readU16, readU32, rec, sanitizeName, walkTlv } from "./protocol.mjs";

export const IMAGE_SIZE = 1168;
export const IMAGE_SIZE_4CTRL = 1120;
export const PRST_SIZE = 1224;
export const PRST_SIZE_4CTRL = 1176;
export const PARAM_COUNT = 15;
export const EXP_SLOTS = 9;
export const QA_KNOBS = 3;
export const CTRL_COUNT = 8;
const BLOCK_COUNT = BLOCKS.length;

const FILE = Object.freeze({ IMAGE: 0x30, CHUNK_TABLE: 0x20, CHUNK: 0x28 });
const MAGIC = Object.freeze({ TSRP: [0x54, 0x53, 0x52, 0x50], PG: [0x32, 0x2d, 0x50, 0x47], MRAP: [0x4d, 0x52, 0x41, 0x50] });
const toBytes = (b) => (b instanceof Uint8Array ? b : Uint8Array.from(b));
const has = (b, o, magic) => magic.every((x, i) => b[o + i] === x);
const blockIndex = (k) => (typeof k === "number" ? k : BLOCKS.indexOf(String(k).toUpperCase()));

// ------------------------------------------------------------------------------------------- image

/** Every record of an image with its decoded position; throws when the image is not a GP-200 patch. */
function recordsOf(image) {
  const recs = walkTlv(image);
  const bad = recs.find((r) => r.truncated);
  if (bad) throw new Error(`patch image is cut off inside record 0x${bad.type.toString(16).padStart(4, "0")}`);
  const info = recs.find((r) => r.type === REC.INFO);
  const chain = recs.find((r) => r.type === REC.CHAIN);
  const blocks = recs.filter((r) => r.type === REC.BLOCK);
  if (!info || info.len < 88) throw new Error("patch image has no 0x0002 info record");
  if (!chain || chain.len < 16) throw new Error("patch image has no 0x0008 chain record");
  if (blocks.length !== BLOCK_COUNT || new Set(blocks.map((b) => b.data[0])).size !== BLOCK_COUNT || blocks.some((b) => b.data[0] >= BLOCK_COUNT)) {
    throw new Error(`patch image must hold blocks 0..${BLOCK_COUNT - 1} once each`);
  }
  return {
    info,
    chain,
    blocks: [...blocks].sort((a, b) => a.data[0] - b.data[0]),
    exp: recs.filter((r) => r.type === REC.EXP),
    qa: recs.filter((r) => r.type === REC.QUICK_ACCESS),
    ctrl: recs.filter((r) => r.type === REC.CTRL),
  };
}

/** Position of EXP key (exp << 4 | para) in the 9-slot list: EXP1A 0-2, EXP1B 3-5, EXP2 6-8. */
export const expIndex = (key) => (key >> 4) * 3 + (key & 0x0f);
export const expKey = (index) => ((Math.floor(index / 3) << 4) | index % 3) & 0xff;

/**
 * Image -> neutral patch structure:
 * { slot, name, author, note, tempo, volume, pan, style, sendLevel, returnLevel, loopMode,
 *   chain: { sendPos, returnPos, order[11] }, blocks[11]: { index, name, enabled, fxid, params[15] },
 *   exp[9]: { key, pedal (0 EXP1A, 1 EXP1B, 2 EXP2), para, block | null, param, max, min },
 *   quickAccess[3]: { index, block (0-10, 0x0B patch VOL, 0x0C tempo) | null, param }, ctrl[4|8]: { index, state, mask } }
 */
export function parsePatch(image) {
  const img = toBytes(image);
  const r = recordsOf(img);
  const d = r.info.data;
  const c = r.chain.data;
  return {
    slot: readU16(d, 0),
    tempo: readU16(d, 2),
    volume: readU16(d, 4),
    pan: (d[7] << 24) >> 24,
    style: readU16(d, 8),
    sendLevel: readU16(d, 10),
    returnLevel: readU16(d, 12),
    loopMode: d[14],
    name: readAscii(d, 16, 16),
    author: readAscii(d, 32, 16),
    note: readAscii(d, 48, 40),
    chain: { sendPos: c[2], returnPos: c[3], order: Array.from(c.subarray(4, 4 + BLOCK_COUNT)) },
    blocks: r.blocks.map((b) => ({
      index: b.data[0],
      name: BLOCKS[b.data[0]],
      enabled: b.data[1] === 1,
      fxid: readU32(b.data, 4),
      params: Array.from({ length: PARAM_COUNT }, (_, i) => readF32(b.data, 8 + 4 * i)),
    })),
    exp: r.exp.map((e) => ({
      key: e.data[0],
      pedal: e.data[0] >> 4,
      para: e.data[0] & 0x0f,
      block: e.data[1] === TARGET.NONE ? null : e.data[1],
      param: readU16(e.data, 2),
      max: readF32(e.data, 4),
      min: readF32(e.data, 8),
    })),
    quickAccess: r.qa.map((q) => ({ index: q.data[0], block: q.data[1] === TARGET.NONE ? null : q.data[1], param: q.data[2] })),
    ctrl: r.ctrl.map((x) => ({ index: x.data[0], state: x.data[1], mask: readU16(x.data, 4) & 0x7ff })),
  };
}

/** True when `order` is a permutation of the 11 block indexes. */
export function validateOrder(order) {
  return Array.isArray(order) && order.length === BLOCK_COUNT && [...order].sort((a, b) => a - b).every((v, i) => v === i);
}

const setU16 = (b, o, v) => {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
};
const setU32 = (b, o, v) => new DataView(b.buffer, b.byteOffset).setUint32(o, v >>> 0, true);
const setF32 = (b, o, v) => new DataView(b.buffer, b.byteOffset).setFloat32(o, Number(v), true);
const setText = (b, o, width, text) => {
  const s = sanitizeName(text, width);
  for (let i = 0; i < width; i++) b[o + i] = i < s.length ? s.charCodeAt(i) : 0;
};
const field = (rec, o) => rec.offset + 4 + o;

function editInfo(out, info, e) {
  const at = (o) => field(info, o);
  if (e.slot !== undefined) setU16(out, at(0), e.slot);
  if (e.tempo !== undefined) setU16(out, at(2), e.tempo);
  if (e.volume !== undefined) setU16(out, at(4), e.volume);
  if (e.pan !== undefined) out[at(7)] = e.pan & 0xff;
  if (e.style !== undefined) setU16(out, at(8), e.style);
  if (e.sendLevel !== undefined) setU16(out, at(10), e.sendLevel);
  if (e.returnLevel !== undefined) setU16(out, at(12), e.returnLevel);
  if (e.loopMode !== undefined) out[at(14)] = e.loopMode;
  if (e.name !== undefined) setText(out, at(16), 16, e.name);
  if (e.author !== undefined) setText(out, at(32), 16, e.author);
  if (e.note !== undefined) setText(out, at(48), 40, e.note);
}

function editChain(out, chain, e) {
  if (e.sendPos !== undefined) out[field(chain, 2)] = e.sendPos;
  if (e.returnPos !== undefined) out[field(chain, 3)] = e.returnPos;
  if (e.order !== undefined) {
    if (!validateOrder(e.order)) throw new RangeError(`chain order must be a permutation of 0..${BLOCK_COUNT - 1}`);
    out.set(e.order, field(chain, 4));
  }
}

function editBlock(out, block, e) {
  if (e.enabled !== undefined) out[field(block, 1)] = e.enabled ? 1 : 0;
  if (e.fxid !== undefined) setU32(out, field(block, 4), e.fxid);
  const params = Array.isArray(e.params) ? Object.fromEntries(e.params.map((v, i) => [i, v])) : (e.params ?? {});
  for (const [id, v] of Object.entries(params)) {
    const i = Number(id);
    if (!Number.isInteger(i) || i < 0 || i >= PARAM_COUNT) throw new RangeError(`param id must be 0..${PARAM_COUNT - 1}, got ${id}`);
    setF32(out, field(block, 8 + 4 * i), v);
  }
}

const targetByte = (block) => (block === null ? TARGET.NONE : block);

/**
 * Returns a new image with `edits` applied; everything not named (incl. hidden floats and unknown bytes) is kept.
 * edits: { slot?, name?, author?, note?, tempo?, volume?, pan?, style?, sendLevel?, returnLevel?, loopMode?,
 *   chain?: { order?, sendPos?, returnPos? }, blocks?: { [index | "AMP"]: { enabled?, fxid?, params?: {id: v} | v[] } },
 *   exp?: { [0..8]: { block?, param?, max?, min? } }, quickAccess?: { [0..2]: { block?, param? } },
 *   ctrl?: { [0..7]: { state?, mask? } } }
 * Changing a block's fxid keeps the old floats unless params are given (the pedal does the same on a full write).
 */
export function applyPatchEdits(image, edits = {}) {
  const out = toBytes(image).slice();
  const r = recordsOf(out);
  editInfo(out, r.info, edits);
  if (edits.chain) editChain(out, r.chain, edits.chain);
  for (const [k, e] of Object.entries(edits.blocks ?? {})) {
    const i = blockIndex(Number.isNaN(Number(k)) ? k : Number(k));
    if (!r.blocks[i]) throw new RangeError(`unknown block ${k}`);
    editBlock(out, r.blocks[i], e);
  }
  for (const [k, e] of Object.entries(edits.exp ?? {})) {
    const x = r.exp.find((rr) => expIndex(rr.data[0]) === Number(k));
    if (!x) throw new RangeError(`unknown EXP slot ${k}`);
    if (e.block !== undefined) out[field(x, 1)] = targetByte(e.block);
    if (e.param !== undefined) setU16(out, field(x, 2), e.param);
    if (e.max !== undefined) setF32(out, field(x, 4), e.max);
    if (e.min !== undefined) setF32(out, field(x, 8), e.min);
  }
  for (const [k, e] of Object.entries(edits.quickAccess ?? {})) {
    const q = r.qa.find((rr) => rr.data[0] === Number(k));
    if (!q) throw new RangeError(`unknown Quick-Access knob ${k}`);
    if (e.block !== undefined) out[field(q, 1)] = targetByte(e.block);
    if (e.param !== undefined) setU16(out, field(q, 2), e.param);
  }
  for (const [k, e] of Object.entries(edits.ctrl ?? {})) {
    const x = r.ctrl.find((rr) => rr.data[0] === Number(k));
    if (!x) throw new RangeError(`unknown CTRL ${k}`);
    if (e.state !== undefined) out[field(x, 1)] = e.state;
    if (e.mask !== undefined) setU16(out, field(x, 4), e.mask & 0x7ff);
  }
  return out;
}

/**
 * Neutral structure (as parsePatch returns; missing fields get init values) -> 1168-byte image in editor order.
 * Use it to create patches; use applyPatchEdits to change existing ones without losing unknown bytes.
 */
export function encodePatchImage(p = {}) {
  const info = new Uint8Array(88);
  const blocks = Array.from({ length: BLOCK_COUNT }, (_, i) => p.blocks?.[i] ?? {});
  const exp = Array.from({ length: EXP_SLOTS }, (_, i) => ({ block: null, param: 0, max: 100, min: 0, ...p.exp?.[i], key: expKey(i) }));
  const qa = Array.from({ length: QA_KNOBS }, (_, i) => ({ block: null, param: 0, ...p.quickAccess?.[i] }));
  const ctrlCount = p.ctrl?.length === 4 ? 4 : CTRL_COUNT;
  const ctrl = Array.from({ length: ctrlCount }, (_, i) => ({ state: 0, mask: 0, ...p.ctrl?.[i] }));
  const parts = [
    concatRecord(REC.INFO, info),
    rec.chain(p.slot ?? 0, { sendPos: p.chain?.sendPos ?? 0, returnPos: p.chain?.returnPos ?? 0, order: p.chain?.order ?? BLOCKS.map((_, i) => i) }).subarray(0, 20),
    ...blocks.map((b, i) => rec.block({ block: i, enabled: b.enabled ?? false, fxid: b.fxid ?? 0, params: b.params })),
    ...exp.map((e) => rec.exp({ key: e.key, block: targetByte(e.block), param: e.param, max: e.max, min: e.min })),
    ...qa.map((q, i) => rec.quickAccess(i, targetByte(q.block), q.param)),
    ...ctrl.map((c, i) => rec.ctrl(i, c.state, c.mask)),
  ];
  const image = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of parts) {
    image.set(x, o);
    o += x.length;
  }
  const defaults = { slot: 0, tempo: 120, volume: 50, pan: 0, style: 0, sendLevel: 0, returnLevel: 0, loopMode: 0, name: "", author: "", note: "" };
  const fields = Object.fromEntries(Object.keys(defaults).map((k) => [k, p[k] ?? defaults[k]]));
  return imageWithSlot(applyPatchEdits(image, fields), fields.slot);
}

function concatRecord(type, data) {
  const out = new Uint8Array(4 + data.length);
  setU16(out, 0, type);
  setU16(out, 2, data.length);
  out.set(data, 4);
  return out;
}

/** Image with 8 CTRL records (adds zeroed CTRL 5-8 to a pre-1.4.0 image); 8-CTRL images are returned as a copy. */
export function withEightCtrl(image) {
  const img = toBytes(image);
  const ctrl = recordsOf(img).ctrl;
  if (ctrl.length >= CTRL_COUNT) return img.slice();
  const extra = Array.from({ length: CTRL_COUNT - ctrl.length }, (_, i) => rec.ctrl(ctrl.length + i, 0, 0));
  const out = new Uint8Array(img.length + extra.reduce((n, x) => n + x.length, 0));
  out.set(img);
  let o = img.length;
  for (const x of extra) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

/**
 * Bytes to ignore when comparing a written image with its read-back (DP HW + editor RE): slot mirrors (0x0002 +0,
 * 0x0008 +0), dead bytes (0x0002 +6 and +15, 0x0008 +15; ~15 % of read-backs differ at 0x0008 +15), the CTRL junk
 * words, the 0x0014 opaque word, the high byte of the Quick-Access param.
 */
export function volatileMask(image) {
  const img = toBytes(image);
  const mask = new Uint8Array(img.length);
  const mark = (r, ...offs) => offs.forEach((o) => o < r.len && (mask[field(r, o)] = 1));
  for (const r of walkTlv(img)) {
    if (r.truncated) continue;
    if (r.type === REC.INFO) mark(r, 0, 1, 6, 15);
    else if (r.type === REC.CHAIN) mark(r, 0, 1, 15);
    else if (r.type === REC.CTRL) mark(r, 2, 3, 6, 7);
    else if (r.type === REC.BLOCK) mark(r, 2, 3);
    else if (r.type === REC.QUICK_ACCESS) mark(r, 3);
  }
  return mask;
}

/** First byte offset where two images differ outside the volatile bytes of either, or -1 when they match. */
export function firstDifference(a, b) {
  const x = toBytes(a);
  const y = toBytes(b);
  if (x.length !== y.length) return Math.min(x.length, y.length);
  const mx = volatileMask(x);
  const my = volatileMask(y);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && !mx[i] && !my[i]) return i;
  return -1;
}
export const imagesMatch = (a, b) => firstDifference(a, b) === -1;

/** Image as a pedal stores it after a write: slot fields set, dead bytes and CTRL junk zeroed (simulator). */
export function normalizeStored(image, slot) {
  const out = imageWithSlot(image, slot);
  for (const r of walkTlv(out)) {
    if (r.truncated) continue;
    if (r.type === REC.INFO) [6, 15].forEach((o) => (out[field(r, o)] = 0));
    else if (r.type === REC.CHAIN) out[field(r, 15)] = 0;
    else if (r.type === REC.CTRL) [2, 3, 6, 7].forEach((o) => (out[field(r, o)] = 0));
  }
  return out;
}

// ------------------------------------------------------------------------------------------- .prst

/** Sniff: "TSRP" at 0 and "2-PG" at 0x10. */
export function isGp200Prst(bytes) {
  const b = toBytes(bytes);
  return b.length >= FILE.IMAGE + 8 && has(b, 0, MAGIC.TSRP) && has(b, 0x10, MAGIC.PG);
}

const sumBe = (b, end) => {
  let s = 0;
  for (let i = 0; i < end; i++) s = (s + b[i]) >>> 0;
  return s;
};
const readU32Be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** True when the trailing big-endian byte sum matches. */
export function isChecksumValid(bytes) {
  const b = toBytes(bytes);
  return b.length >= 4 && readU32Be(b, b.length - 4) === sumBe(b, b.length - 4);
}

/**
 * .prst -> { size, fwTag, layout, hasUserIr, ctrlCount, checksumOk, image, patch }. Throws on a file that is not a
 * GP-200 preset. Layout 2 files carry the User IR of their CAB in a RISU chunk, which is not decoded: the patch is.
 */
export function parsePrst(bytes) {
  const b = toBytes(bytes);
  if (!isGp200Prst(b)) throw new Error("not a GP-200 .prst (TSRP/2-PG header missing)");
  const chunk = readU32(b, FILE.CHUNK_TABLE);
  if (chunk + 8 > b.length || !has(b, chunk, MAGIC.MRAP)) throw new Error("GP-200 .prst has no MRAP patch chunk");
  const declared = readU32(b, chunk + 4);
  const fallback = b.length - chunk - 8 - 8;
  const imageLen = declared >= 4 && chunk + 8 + declared <= b.length - 4 ? declared - 4 : fallback;
  const image = b.slice(chunk + 8, chunk + 8 + imageLen);
  const patch = parsePatch(image);
  const layout = readU16(b, 0x16);
  return {
    size: b.length,
    fwTag: readU16(b, 0x0a),
    layout,
    hasUserIr: layout === 2,
    ctrlCount: patch.ctrl.length,
    checksumOk: isChecksumValid(b),
    image,
    patch,
  };
}

/**
 * Image -> .prst (layout 1). `fwTag` = first u16 of the pedal's 0x1007 at export time; the editor wrote 6 in
 * 1224-byte files and 3 in 1176-byte files, which are the defaults.
 */
export function buildPrst(image, { fwTag } = {}) {
  const img = toBytes(image);
  parsePatch(img);
  const end = FILE.IMAGE + img.length;
  const out = new Uint8Array(end + 8);
  const dv = new DataView(out.buffer);
  out.set(MAGIC.TSRP, 0);
  dv.setUint16(0x0a, fwTag ?? (img.length === IMAGE_SIZE_4CTRL ? 3 : 6), true);
  out.set(MAGIC.PG, 0x10);
  dv.setUint16(0x14, 0x0100, true);
  dv.setUint16(0x16, 1, true);
  dv.setUint32(FILE.CHUNK_TABLE, FILE.CHUNK, true);
  dv.setUint32(FILE.CHUNK_TABLE + 4, img.length + 4 + 8, true);
  out.set(MAGIC.MRAP, FILE.CHUNK);
  dv.setUint32(FILE.CHUNK + 4, img.length + 4, true);
  out.set(img, FILE.IMAGE);
  dv.setUint32(end, end, true);
  dv.setUint32(end + 4, sumBe(out, end + 4), false);
  return out;
}

/** Edit a .prst: parse, applyPatchEdits on its image, rebuild with the same firmware tag. */
export function applyEdits(prst, edits) {
  const p = parsePrst(prst);
  return buildPrst(applyPatchEdits(p.image, edits), { fwTag: p.fwTag });
}

/** Image from either a .prst or a raw image (validated). */
export function imageOf(bytes) {
  const b = toBytes(bytes);
  if (isGp200Prst(b)) return parsePrst(b).image;
  parsePatch(b);
  return b.slice();
}
