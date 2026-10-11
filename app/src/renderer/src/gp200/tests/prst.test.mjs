import assert from "node:assert/strict";
import { test } from "node:test";
import { BLOCKS, REC, walkTlv } from "../lib/protocol.mjs";
import {
  IMAGE_SIZE,
  IMAGE_SIZE_4CTRL,
  PRST_SIZE,
  PRST_SIZE_4CTRL,
  applyEdits,
  applyPatchEdits,
  buildPrst,
  encodePatchImage,
  firstDifference,
  imageOf,
  imagesMatch,
  isChecksumValid,
  isGp200Prst,
  normalizeStored,
  parsePatch,
  parsePrst,
  validateOrder,
  volatileMask,
  withEightCtrl,
} from "../lib/prst.mjs";

const sample = (extra = {}) =>
  encodePatchImage({
    slot: 12,
    name: "Round Trip",
    author: "Tester",
    note: "a note",
    tempo: 128,
    volume: 61,
    pan: -12,
    chain: { order: [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 4], sendPos: 4, returnPos: 5 },
    blocks: BLOCKS.map((_, i) => ({ enabled: i % 2 === 0, fxid: 0x07000000 + i, params: [i, 50, 75.5] })),
    exp: { 0: { block: 3, param: 0, max: 69, min: 61 } },
    quickAccess: { 2: { block: 0x0b, param: 0 } },
    ctrl: Array.from({ length: 8 }, (_, i) => ({ mask: i === 0 ? 0b100 : 0 })),
    ...extra,
  });
const beSum = (b, end) => b.subarray(0, end).reduce((s, x) => (s + x) >>> 0, 0);

test("image layout: 1168 bytes in editor record order", () => {
  const img = sample();
  assert.equal(img.length, IMAGE_SIZE);
  const types = walkTlv(img).map((r) => r.type);
  assert.deepEqual(types, [REC.INFO, REC.CHAIN, ...Array(11).fill(REC.BLOCK), ...Array(9).fill(REC.EXP), ...Array(3).fill(REC.QUICK_ACCESS), ...Array(8).fill(REC.CTRL)]);
});

test("parsePatch reads every field back", () => {
  const p = parsePatch(sample());
  assert.equal(p.slot, 12);
  assert.equal(p.name, "Round Trip");
  assert.equal(p.author, "Tester");
  assert.equal(p.note, "a note");
  assert.equal(p.tempo, 128);
  assert.equal(p.volume, 61);
  assert.equal(p.pan, -12);
  assert.deepEqual(p.chain, { order: [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 4], sendPos: 4, returnPos: 5 });
  assert.equal(p.blocks.length, 11);
  assert.deepEqual(p.blocks[3], { index: 3, name: "AMP", enabled: false, fxid: 0x07000003, params: [3, 50, 75.5, ...Array(12).fill(0)] });
  assert.deepEqual(p.exp[0], { key: 0, pedal: 0, para: 0, block: 3, param: 0, max: 69, min: 61 });
  assert.deepEqual(p.exp[8], { key: 0x22, pedal: 2, para: 2, block: null, param: 0, max: 100, min: 0 });
  assert.deepEqual(p.quickAccess[2], { index: 2, block: 0x0b, param: 0 });
  assert.equal(p.ctrl.length, 8);
  assert.equal(p.ctrl[0].mask, 0b100);
});

test(".prst round trip: TSRP/2-PG/MRAP, position word, big-endian byte sum", () => {
  const img = sample();
  const file = buildPrst(img);
  assert.equal(file.length, PRST_SIZE);
  assert.ok(isGp200Prst(file));
  assert.equal(new TextDecoder().decode(file.subarray(0, 4)), "TSRP");
  assert.equal(new TextDecoder().decode(file.subarray(0x10, 0x14)), "2-PG");
  assert.equal(new TextDecoder().decode(file.subarray(0x28, 0x2c)), "MRAP");
  assert.deepEqual([...file.subarray(0x4c0, 0x4c4)], [0xc0, 0x04, 0x00, 0x00]);
  assert.equal(new DataView(file.buffer).getUint32(0x4c4, false), beSum(file, 0x4c4));
  const p = parsePrst(file);
  assert.equal(p.checksumOk, true);
  assert.equal(p.fwTag, 6);
  assert.equal(p.layout, 1);
  assert.equal(p.ctrlCount, 8);
  assert.deepEqual(p.image, img);
  assert.deepEqual(buildPrst(p.image, { fwTag: p.fwTag }), file);
  assert.deepEqual(imageOf(file), img);
});

test("4-CTRL files (editor < 1.4.0): 1120-byte image, 1176-byte file, upgrade to 8 CTRL", () => {
  const img4 = sample({ ctrl: Array.from({ length: 4 }, (_, i) => ({ mask: i === 3 ? 0x400 : 0 })) });
  assert.equal(img4.length, IMAGE_SIZE_4CTRL);
  const file = buildPrst(img4);
  assert.equal(file.length, PRST_SIZE_4CTRL);
  assert.deepEqual([...file.subarray(0x490, 0x494)], [0x90, 0x04, 0x00, 0x00]);
  const p = parsePrst(file);
  assert.equal(p.fwTag, 3);
  assert.equal(p.ctrlCount, 4);
  assert.equal(p.checksumOk, true);
  const img8 = withEightCtrl(img4);
  assert.equal(img8.length, IMAGE_SIZE);
  const ctrl = parsePatch(img8).ctrl;
  assert.deepEqual(ctrl.map((c) => c.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(ctrl[3].mask, 0x400);
  assert.deepEqual(withEightCtrl(img8), img8);
});

test("a corrupted file fails the checksum; foreign files are not GP-200 presets", () => {
  const file = buildPrst(sample());
  const bad = file.slice();
  bad[0x100] ^= 1;
  assert.equal(isChecksumValid(bad), false);
  assert.equal(parsePrst(bad).checksumOk, false);
  assert.equal(isGp200Prst(new Uint8Array(507)), false);
  assert.throws(() => parsePrst(new Uint8Array(1224)), /not a GP-200/);
  assert.throws(() => parsePatch(sample().subarray(0, 500)), /cut off|blocks/);
});

test("applyPatchEdits changes only what it names, incl. hidden floats and unknown bytes", () => {
  const img = sample();
  img[4 + 6] = 0x77; // 0x0002 +6: unknown byte, kept
  const edited = applyPatchEdits(img, {
    name: "Edited!",
    tempo: 90,
    blocks: { AMP: { enabled: true, params: { 14: 1.25 } }, 9: { fxid: 0x0c000002 } },
    chain: { order: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0] },
    ctrl: { 1: { mask: 0x7ff } },
    quickAccess: { 0: { block: 3, param: 2 } },
    exp: { 3: { block: 8, param: 1, max: 80 } },
  });
  const p = parsePatch(edited);
  assert.equal(p.name, "Edited!");
  assert.equal(p.tempo, 90);
  assert.equal(p.blocks[3].enabled, true);
  assert.equal(p.blocks[3].params[14], 1.25);
  assert.equal(p.blocks[9].fxid, 0x0c000002);
  assert.deepEqual(p.blocks[9].params.slice(0, 3), [9, 50, 75.5], "a model change in a file keeps the floats");
  assert.deepEqual(p.chain.order, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.equal(p.ctrl[1].mask, 0x7ff);
  assert.deepEqual(p.quickAccess[0], { index: 0, block: 3, param: 2 });
  assert.deepEqual(p.exp[3], { key: 0x10, pedal: 1, para: 0, block: 8, param: 1, max: 80, min: 0 });
  assert.equal(edited[4 + 6], 0x77);
  assert.equal(img[4 + 16], "R".charCodeAt(0), "the input image is not mutated");
  assert.throws(() => applyPatchEdits(img, { chain: { order: [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9] } }), /permutation/);
  const file = applyEdits(buildPrst(img), { name: "Via File" });
  assert.equal(parsePrst(file).patch.name, "Via File");
  assert.equal(isChecksumValid(file), true);
});

test("volatile mask: slot mirrors, dead bytes and CTRL junk are ignored by verification", () => {
  const img = sample();
  const back = normalizeStored(img, 99);
  back[0x9f - 0x30] = 0x5a; // file 0x9F: the OSS verify glitch
  const ctrl = walkTlv(back).find((r) => r.type === REC.CTRL);
  back[ctrl.offset + 4 + 6] = 0xab;
  assert.ok(imagesMatch(img, back));
  const mask = volatileMask(img);
  assert.equal(mask[4], 1, "0x0002 slot");
  assert.equal(mask[0x13], 1, "file 0x43");
  assert.equal(mask[0x6f], 1, "file 0x9F");
  const changed = applyPatchEdits(back, { volume: 1 });
  assert.equal(firstDifference(img, changed), 4 + 4);
  assert.equal(imagesMatch(img, img.subarray(0, 1000)), false);
});

test("validateOrder", () => {
  assert.ok(validateOrder([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  assert.ok(!validateOrder([0, 1, 2]));
  assert.ok(!validateOrder([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11]));
});
