import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyEdits, bodyOf, convertPrst, deviceByBodyLength, isCrcValid, parsePrst, rebuildPrst, validateOrder } from "../lib/prst.mjs";
import { defaultParams, findParam, modelByFxid, modelsForBlock } from "../lib/catalog.mjs";

const load = (n) => new Uint8Array(readFileSync(new URL(`../fixtures/${n}`, import.meta.url)));
const puppy = load("65-Puppy.prst");
const ffcc = load("97-FF_CC.prst");
const usLead = load("gp50-US-Lead.prst");
const voxNam = load("gp50-76-VoxUltNAM.prst");

test("decodes real GP-5 presets", () => {
  const p = parsePrst(ffcc);
  assert.equal(p.device, "gp5");
  assert.equal(p.name, "FF CC");
  assert.ok(p.crcValid);
  assert.equal(p.mask, 0x1fb);
  assert.equal(p.blocks[3].fxid, 0x07000004); // Dark Twin
  assert.deepEqual(p.blocks[3].params.slice(0, 3), [70, 85, 40]);
  assert.equal(p.blocks[4].fxid, 0x0a100001); // User IR 2
  assert.deepEqual(p.blocks[7].params.slice(0, 3), [3, 308, 42]); // Ping Pong: Time 308 ms at algId 1
});

test("rebuild(name, body, device) round-trips GP-5 and GP-50 files byte-for-byte", () => {
  for (const f of [puppy, ffcc, load("67-OerdriveM.prst"), usLead, voxNam, load("gp50-blank.prst")]) {
    const p = parsePrst(f);
    assert.deepEqual(rebuildPrst(p.name, bodyOf(f), p.device), f);
  }
  assert.throws(() => rebuildPrst("x", bodyOf(puppy), "gp50"), /511-byte GP-50 body/);
  assert.throws(() => rebuildPrst("x", bodyOf(puppy)), /unknown device/);
});

test("the body length identifies the pedal", () => {
  assert.equal(deviceByBodyLength(bodyOf(puppy).length).key, "gp5");
  assert.equal(deviceByBodyLength(bodyOf(usLead).length).key, "gp50");
  assert.equal(deviceByBodyLength(500), null);
});

test("GP-50 presets: u8 volume and footswitch mode bytes survive edits", () => {
  const out = applyEdits(voxNam, { volume: 64, bpm: 90, footswitches: { fs1: [0, 2], fs2: [] } });
  assert.equal(out.length, 552);
  assert.ok(isCrcValid(out));
  const p = parsePrst(out);
  assert.equal(p.device, "gp50");
  assert.deepEqual([p.settings.volume, p.settings.bpm], [64, 90]);
  assert.deepEqual(p.footswitches, { fs1: [0, 2], fs2: [] });
  assert.deepEqual(out.subarray(-2), voxNam.subarray(-2), "the 2 GP-50 footswitch mode bytes are kept");
});

test("applyEdits changes only the addressed bytes and fixes the CRC", () => {
  const out = applyEdits(puppy, { name: "Lead 2", volume: 70, blocks: { AMP: { params: { 0: 61 } }, DLY: { enabled: true } } });
  assert.ok(isCrcValid(out));
  const p = parsePrst(out);
  assert.equal(p.name, "Lead 2");
  assert.equal(p.settings.volume, 70);
  assert.equal(p.blocks[3].params[0], 61);
  assert.ok(p.blocks[7].enabled);
  assert.deepEqual(puppy, load("65-Puppy.prst"), "input must not be mutated");
});

test("chain order rules: fixed core DST,NS,AMP,CAB,EQ", () => {
  assert.equal(validateOrder([0, 1, 2, 9, 3, 4, 5, 6, 8, 7]), null);
  assert.equal(validateOrder([8, 0, 1, 2, 9, 3, 4, 5, 6, 7]), null);
  assert.match(validateOrder([0, 1, 2, 3, 9, 4, 5, 6, 7, 8]), /contiguous/);
  assert.throws(() => applyEdits(puppy, { order: [0, 0, 1, 2, 3, 4, 5, 6, 7, 8] }));
});

test("GP-50 -> GP-5 -> GP-50 conversion is lossless for shared models", () => {
  const cap = JSON.parse(readFileSync(new URL("../fixtures/gp50_suite_write_slot0.json", import.meta.url), "utf8"));
  const gp50 = Uint8Array.from(Buffer.from(cap.prst_b64, "base64"));
  const gp5 = convertPrst(gp50, "gp5");
  assert.equal(gp5.length, 507);
  assert.equal(parsePrst(gp5).name, "US Lead");
  assert.deepEqual(parsePrst(gp5).blocks, parsePrst(gp50).blocks);
});

test("GP-5 -> GP-50 is lossless; GP-50-only models block the way back unless forced", () => {
  const up = convertPrst(puppy, "gp50");
  assert.equal(up.length, 552);
  assert.deepEqual(parsePrst(up).blocks, parsePrst(puppy).blocks);
  assert.deepEqual(convertPrst(up, "gp5"), puppy);
  const wah = applyEdits(usLead, { blocks: { PRE: { fxid: 0x05000008 } } }); // PRE C-Wah, GP-50 only
  assert.throws(() => convertPrst(wah, "gp5"), /C-Wah/);
  assert.equal(parsePrst(convertPrst(wah, "gp5", { force: true })).blocks[1].fxid, 0);
});

test("catalog is per device: GP-50 adds 3 models and tempo-sync params", () => {
  assert.equal(modelByFxid(0x05000008, "gp5"), undefined);
  assert.equal(modelByFxid(0x05000008, "gp50").title, "Cry Wah");
  assert.equal(modelsForBlock("PRE", "gp50").length - modelsForBlock("PRE", "gp5").length, 2);
  assert.equal(modelsForBlock("CAB", "gp50").length - modelsForBlock("CAB", "gp5").length, 1);
  const pureEko = parsePrst(usLead).blocks[7].fxid;
  assert.deepEqual(modelByFxid(pureEko, "gp5").params.map((p) => p.name), ["Mix", "Time", "F.Back", "Trail"]);
  assert.deepEqual(modelByFxid(pureEko, "gp50").params.map((p) => p.name), ["Mix", "Time", "F.Back", "Sync", "Trail"]);
  assert.equal(findParam(pureEko, "Sync", "gp50").index, 3);
  assert.throws(() => findParam(pureEko, "Sync", "gp5"), /no param Sync/);
  assert.equal(defaultParams(pureEko, "gp50")[4], defaultParams(pureEko, "gp5")[4]);
  assert.throws(() => modelByFxid(pureEko), /unknown device/);
});
