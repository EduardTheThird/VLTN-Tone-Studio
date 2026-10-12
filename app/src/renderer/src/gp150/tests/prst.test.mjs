import assert from "node:assert/strict";
import { test } from "node:test";
import { NONE_FXID } from "../lib/protocol.mjs";
import { OFFSET, PRST_SIZE, applyPatchEdits, blankPrst, blocksOfMask, forImport, imagesMatch, isGp150Prst, normalize, parsePrst } from "../lib/prst.mjs";
import { PRST } from "./vectors.mjs";

const file = () => Uint8Array.from(Buffer.from(PRST, "hex"));

test("a stored preset parses: name, tempo, chain, models, knobs, footswitches", () => {
  const p = parsePrst(file());
  assert.equal(p.slot, 3);
  assert.equal(p.name, "Foxy Clean");
  assert.equal(p.tempo, 120);
  assert.equal(p.volume, 50);
  assert.deepEqual(p.chain, [5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(
    p.blocks.filter((b) => b.enabled).map((b) => [b.code, b.fxid]),
    [
      ["AMP", 0x07000011],
      ["CAB", 0x1a0001d0],
      ["RVB", 0x0c000004],
      ["VOL", NONE_FXID],
    ],
  );
  assert.deepEqual(p.knobs.map((k) => k.target), [12, 13, 4]);
  assert.deepEqual(p.footswitches.map(blocksOfMask), [[], [], [10]]);
});

test("no edits give the same bytes back", () => {
  assert.deepEqual(applyPatchEdits(file(), {}), file());
});

test("edits change their fields only and clear the unknown checksum", () => {
  const before = file();
  const after = applyPatchEdits(before, { name: "Glassy", tempo: 96, blocks: { 4: { params: { 0: 33.5 } }, 2: { enabled: true } } });
  const p = parsePrst(after);
  assert.equal(p.name, "Glassy");
  assert.equal(p.tempo, 96);
  assert.equal(p.blocks[4].params[0], 33.5);
  assert.equal(p.blocks[2].enabled, true);
  assert.equal(p.activeMask & (1 << 2), 1 << 2, "the active-module mask follows the module switch");
  assert.deepEqual([...after.subarray(OFFSET.CHECKSUM, OFFSET.CHECKSUM + 2)], [0, 0]);
  assert.deepEqual(parsePrst(after).blocks[6], parsePrst(before).blocks[6]);
});

test("names are cut to what the pedal's name list holds", () => {
  assert.equal(parsePrst(applyPatchEdits(file(), { name: "A very long preset name" })).name, "A very long pre");
});

test("a chain must hold each module once", () => {
  assert.throws(() => applyPatchEdits(file(), { chain: [5, 5, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11] }), RangeError);
  const moved = applyPatchEdits(file(), { chain: [5, 1, 0, 2, 3, 4, 6, 7, 8, 9, 10, 11] });
  assert.deepEqual(parsePrst(moved).chain.slice(0, 3), [5, 1, 0]);
});

test("import form: slot set, length 0x45C, checksum kept; normalize restores the stored form", () => {
  const imp = forImport(file(), 7);
  assert.equal(parsePrst(imp).slot, 7);
  assert.deepEqual([...imp.subarray(10, 12)], [0x5c, 0x04]);
  assert.deepEqual([...imp.subarray(OFFSET.CHECKSUM, OFFSET.CHECKSUM + 2)], [...file().subarray(OFFSET.CHECKSUM, OFFSET.CHECKSUM + 2)]);
  assert.deepEqual([...normalize(imp).subarray(10, 12)], [0x58, 0x04]);
  assert.ok(imagesMatch(imp, file()));
});

test("a blank preset is a valid file with empty modules", () => {
  const b = blankPrst(150, "INIT");
  assert.equal(b.length, PRST_SIZE);
  assert.ok(isGp150Prst(b));
  const p = parsePrst(b);
  assert.equal(p.slot, 150);
  assert.ok(p.blocks.every((x) => x.fxid === NONE_FXID));
  assert.equal(p.chain[0], 5);
});

test("files of another size or record are not GP-150 presets", () => {
  assert.equal(isGp150Prst(file().subarray(0, 1000)), false);
  const other = file();
  other[8] = 0;
  assert.equal(isGp150Prst(other), false);
});
