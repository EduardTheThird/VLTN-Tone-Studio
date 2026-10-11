// GP-50 codec facts from static RE of Valeton Suite 2.1.0 (test vectors from the RE; frames
// computed independently with packetize on the RE workstation). Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SYNC_DIVISIONS, displayedParam, findParam, isSynced, modelsFor, syncToggleFor } from "../lib/catalog.mjs";
import {
  CC_GP50,
  decodeExportedPreset,
  decodeGlobals,
  decodeMessage,
  decodeModified,
  encode,
  expTargetBlock,
  fromHex,
  globalsFor,
  isForbiddenFn,
  midi,
  packetize,
  parseSysex,
  toHex,
} from "../lib/protocol.mjs";
import { applyEdits, blankGp50Prst, convertPrst, parsePrst, validateFootswitches } from "../lib/prst.mjs";

const load = (n) => new Uint8Array(readFileSync(new URL(`../fixtures/${n}`, import.meta.url)));
const hex = (payload) => toHex(Uint8Array.from(payload));
const wire = (payload) => packetize(payload).map((m) => toHex(m));

// [name, payload from our encoder, Suite payload, USB wire frames]
const VECTORS = [
  ["patch VOL 80", encode.setPatchVolume(80), "11 42 01 20 00 00 50 00 00 00", "f0 00 0e 00 01 00 00 00 0a 01 01 04 02 00 01 02 00 00 00 00 00 05 00 00 00 00 00 00 00 f7"],
  ["BPM 140", encode.setPatchSetting(0x2002, 140), "11 42 02 20 00 00 8c 00 00 00", "f0 01 0e 00 01 00 00 00 0a 01 01 04 02 00 02 02 00 00 00 00 00 08 0c 00 00 00 00 00 00 f7"],
  ["EXP on", encode.setPatchSetting(0x2003, true), "11 42 03 20 00 00 01 00 00 00", "f0 0c 02 00 01 00 00 00 0a 01 01 04 02 00 03 02 00 00 00 00 00 00 01 00 00 00 00 00 00 f7"],
  ["EXP param min 13", encode.setPatchSetting(0x2004, 13), "11 42 04 20 00 00 0d 00 00 00", "f0 05 03 00 01 00 00 00 0a 01 01 04 02 00 04 02 00 00 00 00 00 00 0d 00 00 00 00 00 00 f7"],
  ["EXP param max 87", encode.setPatchSetting(0x2005, 87), "11 42 05 20 00 00 57 00 00 00", "f0 02 00 00 01 00 00 00 0a 01 01 04 02 00 05 02 00 00 00 00 00 05 07 00 00 00 00 00 00 f7"],
  ["EXP VOL position Post", encode.setPatchSetting(0x2006, 1), "11 42 06 20 00 00 01 00 00 00", "f0 09 0d 00 01 00 00 00 0a 01 01 04 02 00 06 02 00 00 00 00 00 00 01 00 00 00 00 00 00 f7"],
  ["EXP VOL min 10", encode.setPatchSetting(0x2007, 10), "11 42 07 20 00 00 0a 00 00 00", "f0 00 04 00 01 00 00 00 0a 01 01 04 02 00 07 02 00 00 00 00 00 00 0a 00 00 00 00 00 00 f7"],
  ["EXP VOL max 90", encode.setPatchSetting(0x2008, 90), "11 42 08 20 00 00 5a 00 00 00", "f0 01 09 00 01 00 00 00 0a 01 01 04 02 00 08 02 00 00 00 00 00 05 0a 00 00 00 00 00 00 f7"],
  ["EXP target DLY", encode.setPatchSetting(0x2009, 9), "11 42 09 20 00 00 09 00 00 00", "f0 0c 0c 00 01 00 00 00 0a 01 01 04 02 00 09 02 00 00 00 00 00 00 09 00 00 00 00 00 00 f7"],
  ["EXP target param 1", encode.setPatchSetting(0x200a, 1), "11 42 0a 20 00 00 01 00 00 00", "f0 04 09 00 01 00 00 00 0a 01 01 04 02 00 0a 02 00 00 00 00 00 00 01 00 00 00 00 00 00 f7"],
  ["FS1 DST+MOD, FS2 DLY", encode.setFootswitchMasks([2, 6], [7]), "11 4d 44 00 00 00 80 00 00 00", "f0 04 08 00 01 00 00 00 0a 01 01 04 0d 04 04 00 00 00 00 00 00 08 00 00 00 00 00 00 00 f7"],
  ["chain order", encode.setOrder([0, 1, 2, 9, 3, 4, 5, 6, 7, 8]), "11 44 00 01 02 09 03 04 05 06 07 08", "f0 09 06 00 01 00 00 00 0c 01 01 04 04 00 00 00 01 00 02 00 09 00 03 00 04 00 05 00 06 00 07 00 08 f7"],
  ["model swap DLY -> Pure Eko", encode.setModel("DLY", 0x0b000000), "11 47 07 00 00 00 07 00 00 00 00 00 00 0b", "f0 05 07 00 01 00 00 00 0e 01 01 04 07 00 07 00 00 00 00 00 00 00 07 00 00 00 00 00 00 00 00 00 00 00 00 00 0b f7"],
  ["DLY Sync on", encode.setParam("DLY", 3, 1), "11 48 07 00 00 00 03 00 00 00 00 00 80 3f", "f0 07 08 00 01 00 00 00 0e 01 01 04 08 00 07 00 00 00 00 00 00 00 03 00 00 00 00 00 00 00 00 00 00 08 00 03 0f f7"],
  ["DLY Time 1/8D (index 8)", encode.setParam("DLY", 1, 8), "11 48 07 00 00 00 01 00 00 00 00 00 00 41", "f0 09 05 00 01 00 00 00 0e 01 01 04 08 00 07 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 04 01 f7"],
  ["DLY on", encode.setBlockEnabled("DLY", true), "11 49 07 00 00 00 01 00 00 00", "f0 06 05 00 01 00 00 00 0a 01 01 04 09 00 07 00 00 00 00 00 00 00 01 00 00 00 00 00 00 f7"],
  ["select 55", encode.selectPreset(55), "11 43 37 00 00 00", "f0 0a 07 00 01 00 00 00 06 01 01 04 03 03 07 00 00 00 00 00 00 f7"],
  ["delete 55", encode.deletePreset(55), "11 46 37 00 00 00", "f0 04 0a 00 01 00 00 00 06 01 01 04 06 03 07 00 00 00 00 00 00 f7"],
  ["paste 56 <- 55", encode.pastePreset(56, 55), "11 4b 38 00 37 00", "f0 0f 0e 00 01 00 00 00 06 01 01 04 0b 03 08 00 00 03 07 00 00 f7"],
  ["move 55 -> 56", encode.movePreset(55, 56), "11 5a 37 00 00 00 38 00 00 00", "f0 03 0d 00 01 00 00 00 0a 01 01 05 0a 03 07 00 00 00 00 00 00 03 08 00 00 00 00 00 00 f7"],
  ["export read 55", encode.exportPreset(55), "12 4f 37 00 00 00", "f0 04 0a 00 01 00 00 00 06 01 02 04 0f 03 07 00 00 00 00 00 00 f7"],
  ["Monitor -20 dB (3,4)", encode.setGlobal("monitorLevel", -20, "gp50"), "11 11 03 04 00 00 ec ff ff ff", "f0 09 07 00 01 00 00 00 0a 01 01 01 01 00 03 00 04 00 00 00 00 0e 0c 0f 0f 0f 0f 0f 0f f7"],
  ["FS mode Stomp (1,6)", encode.setGlobal("footswitchMode", 1, "gp50"), "11 11 01 06 00 00 01 00 00 00", "f0 09 0d 00 01 00 00 00 0a 01 01 01 01 00 01 00 06 00 00 00 00 00 01 00 00 00 00 00 00 f7"],
  ["is-modified read", encode.read(0x45), "12 45", "f0 01 05 00 01 00 00 00 02 01 02 04 05 f7"],
];

test("GP-50 encoders reproduce Valeton Suite's payloads and USB frames", () => {
  for (const [name, payload, suite, frame] of VECTORS) {
    assert.equal(hex(payload), suite, name);
    assert.deepEqual(wire(payload), [frame], name);
  }
});

test("forbidden functions are recognised; the factory-reset frame is known so the simulator can refuse it", () => {
  for (const fn of [0x1c, 0x31, 0x33, 0x3f, 0x53, 0x60, 0x61, 0x6e]) assert.ok(isForbiddenFn(fn), `0x${fn.toString(16)}`);
  for (const fn of [0x11, 0x42, 0x43, 0x44, 0x46, 0x4b, 0x4d, 0x4f, 0x5a]) assert.ok(!isForbiddenFn(fn));
  assert.deepEqual(wire([0x11, 0x3f]), ["f0 04 0b 00 01 00 00 00 02 01 01 03 0f f7"]);
});

test("encoders validate their input", () => {
  assert.throws(() => encode.setPatchSetting(0x2002, 300), /bpm must be an integer 40..260/);
  assert.throws(() => encode.setPatchSetting(0x2009, 11), /targetModule/);
  assert.throws(() => encode.setPatchSetting(0x2010, 1), /unknown patch setting record/);
  assert.throws(() => encode.setFootswitchMasks([2, 2], []), /distinct block indices/);
  assert.throws(() => encode.setOrder([0, 1, 2]), /permutation/);
  assert.throws(() => encode.pastePreset(100, 1), RangeError);
  assert.throws(() => encode.setGlobal("btLevel", 3, "gp50"), /unknown gp50 global btLevel/);
  assert.throws(() => encode.setGlobal("monitorLevel", 3, "gp200"), /unknown device/);
});

test("globals tables differ per model and carry what a generic UI needs", () => {
  const gp5 = globalsFor("gp5");
  const gp50 = globalsFor("gp50");
  assert.deepEqual(gp5.monitorLevel.addr, [2, 4]);
  assert.deepEqual(gp50.monitorLevel.addr, [3, 4]);
  assert.deepEqual(gp50.btRecordLevel.addr, [2, 4]);
  assert.deepEqual([gp50.recModeLeft.addr, gp50.recModeRight.addr], [[4, 4], [5, 4]]);
  assert.equal(gp50.btLevel, undefined, "(5,4) is REC mode R on a GP-50, not a BT level");
  assert.deepEqual(gp50.fs3Function.labels.slice(0, 4), ["None", "Patch +", "Patch -", "Tap tempo"]);
  assert.equal(gp50.midiChannelUsb.labels[0], "Omni");
  assert.equal(gp50.dcUnplug.since, "1.1.0");
  for (const g of [...Object.values(gp5), ...Object.values(gp50)]) {
    assert.ok(g.label && g.group && ["number", "enum"].includes(g.kind), g.name);
    if (g.kind === "enum") assert.equal(g.labels.length, g.max - g.min + 1, g.name);
  }
  // writes clamp to the range and keep the int32 sign
  assert.equal(hex(encode.setGlobal("inputTrim", -50, "gp50")), "11 11 01 03 00 00 ec ff ff ff");
  assert.equal(hex(encode.setGlobal("masterVolume", 75)), "11 11 02 02 00 00 4b 00 00 00");
});

test("0x10 decode per model: GP-50 names, int32 negatives, firmware version", () => {
  const rec = (a, b, v) => [a, b, 4, 0, v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  const reply = Uint8Array.from([0x12, 0x10, ...rec(1, 1, 0x01010100), ...rec(2, 2, 70), ...rec(3, 4, -20), ...rec(2, 4, 5), ...rec(5, 4, 1), ...rec(1, 13, 1)]);
  const g = decodeGlobals(reply, "gp50");
  assert.equal(g.firmware, "1.1.0");
  assert.deepEqual([g.masterVolume, g.monitorLevel, g.btRecordLevel, g.recModeRight, g.dcUnplug], [70, -20, 5, 1, 1]);
  assert.equal(g.btLevel, undefined);
  const asGp5 = decodeGlobals(reply, "gp5");
  assert.deepEqual([asGp5.monitorLevel, asGp5.btLevel], [5, 1], "the same records read with the GP-5 map");
});

test("device -> host decoding: GP-5 and GP-50 0x47 layouts, 12 1B lists, 0x42/0x4D/0x44/0x11 echoes, 0x45, export", () => {
  const msg = (h) => {
    const { raw, ...rest } = decodeMessage(fromHex(h));
    void raw;
    return rest;
  };
  assert.deepEqual(msg("11 47 07 00 00 00 07 00 00 00 00 00 00 0b"), { type: "model", block: 7, fxid: 0x0b000000 });
  assert.deepEqual(msg("11 47 07 00 07 00 00 00 00 0b"), { type: "model", block: 7, fxid: 0x0b000000 }, "GP-50: s16 s16 s32");
  assert.deepEqual(msg("12 1b 02 00 00 00"), { type: "listChanged", list: "presets" });
  assert.deepEqual(msg("12 1b 03 00 00 00"), { type: "listChanged", list: "snaptones" });
  assert.deepEqual(msg("12 1b 04 00 00 00"), { type: "listChanged", list: "irs" });
  assert.equal(msg("12 1b 01 00 00 00").type, "presetChanged");
  assert.deepEqual(msg("12 43 37 00"), { type: "slot", slot: 55 });
  assert.deepEqual(msg("11 42 02 20 04 00 8c 00 00 00"), { type: "patchSetting", settings: [{ record: 0x2002, value: 140 }] });
  assert.deepEqual(msg("11 42 01 20 01 00 32 03 20 01 00 01"), { type: "patchSetting", settings: [{ record: 0x2001, value: 50 }, { record: 0x2003, value: 1 }] });
  assert.deepEqual(msg("11 4d 44 00 00 00 80 00 00 00"), { type: "footswitch", fs1: [2, 6], fs2: [7] });
  assert.deepEqual(msg("11 4d 00 00 26 00 00 00 82 00 00 00"), { type: "footswitch", fs1: [1, 2, 5], fs2: [1, 7] });
  assert.deepEqual(msg("11 44 00 01 02 09 03 04 05 06 08 07"), { type: "order", order: [0, 1, 2, 9, 3, 4, 5, 6, 8, 7] });
  assert.deepEqual(msg("11 11 03 04 04 00 ec ff ff ff"), { type: "global", a: 3, b: 4, value: -20 });
  assert.equal(decodeModified(fromHex("12 45 01")), true);
  assert.equal(decodeModified(fromHex("12 45 00")), false);
  // TonexOneController comment: a 0x45 reply frame
  assert.equal(decodeModified(parseSysex(fromHex("f0 07 0d 00 01 00 00 00 03 01 02 04 05 00 00 f7")).payload), false);
  const blank = blankGp50Prst();
  const exported = decodeExportedPreset(Uint8Array.from([0x12, 0x4f, ...blank.subarray(0x15)]));
  assert.equal(exported.name, "GP-50");
  assert.equal(exported.body.length, 511);
});

test("CC tables per model: the GP-50 chart has tempo, EXP, looper and drum CCs, no bank/song CCs", () => {
  for (const k of ["BANK_DOWN", "BANK_UP", "SONG_PATCH_DOWN", "SONG_PATCH_UP"]) assert.equal(CC_GP50[k], undefined, k);
  assert.deepEqual([CC_GP50.MASTER_VOLUME, CC_GP50.EXP_VALUE, CC_GP50.EXP_SWITCH, CC_GP50.TEMPO_MSB, CC_GP50.TEMPO_LSB, CC_GP50.CTL2, CC_GP50.LOOPER, CC_GP50.DRUM_PLAY], [1, 11, 13, 73, 74, 70, 59, 93]);
  assert.deepEqual(midi.programSelect(55), [0xc0, 55]);
  assert.throws(() => midi.programSelect(100), RangeError);
});

test("GP-5 -> GP-50 conversion computes the footswitch state bytes (06 = switch has blocks, all on)", () => {
  const usLead = load("gp50-US-Lead.prst");
  assert.deepEqual(Array.from(usLead.subarray(-2)), [0x06, 0x06]);
  const back = convertPrst(convertPrst(usLead, "gp5"), "gp50");
  assert.deepEqual(back, usLead, "GP-50 -> GP-5 -> GP-50 restores the state bytes and the blank EXP settings");
  const vox = load("gp50-76-VoxUltNAM.prst");
  assert.deepEqual(Array.from(vox.subarray(-2)), [0x05, 0x05], "its FS blocks are off");
  assert.deepEqual(convertPrst(convertPrst(vox, "gp5"), "gp50"), vox);
  const puppy = load("65-Puppy.prst");
  const p = parsePrst(puppy);
  const up = convertPrst(applyEdits(puppy, { footswitches: { fs1: [3], fs2: [] }, blocks: { AMP: { enabled: true } } }), "gp50");
  assert.deepEqual(Array.from(up.subarray(-2)), [0x06, 0x05]);
  assert.ok(p.crcValid);
});

test("blank GP-50 preset equals the MIT fixture byte for byte", () => {
  assert.deepEqual(blankGp50Prst(), load("gp50-blank.prst"));
  assert.equal(parsePrst(blankGp50Prst("Scratch")).name, "Scratch");
});

test("EXP settings: parsed for GP-50 presets, editable with validation, refused on GP-5 presets", () => {
  const usLead = load("gp50-US-Lead.prst");
  assert.deepEqual(parsePrst(usLead).settings.exp, { on: false, paramMin: 0, paramMax: 100, volPosition: 0, volMin: 0, volMax: 100, targetModule: 0, targetParam: 0 });
  const exp = { on: true, paramMin: 13, paramMax: 87, volPosition: 1, volMin: 10, volMax: 90, targetModule: 9, targetParam: 1 };
  const edited = applyEdits(usLead, { exp, bpm: 120 });
  assert.deepEqual(parsePrst(edited).settings.exp, exp);
  // example payload of the settings record (Suite 2.1.0 RE)
  const settings = "01 20 01 00 32 02 20 04 00 78 00 00 00 03 20 01 00 01 04 20 04 00 0d 00 00 00 05 20 04 00 57 00 00 00 06 20 01 00 01 07 20 01 00 0a 08 20 01 00 5a 09 20 01 00 09 0a 20 01 00 01";
  assert.equal(toHex(edited.subarray(0x55, 0x55 + 59)), settings);
  assert.equal(expTargetBlock(9), 7, "EXP target DLY = storage block 7");
  assert.equal(expTargetBlock(0), null);
  assert.throws(() => applyEdits(usLead, { exp: { paramMax: 101 } }), /paramMax/);
  assert.throws(() => applyEdits(usLead, { exp: { pedal: 1 } }), /unknown EXP setting/);
  assert.throws(() => applyEdits(load("65-Puppy.prst"), { exp: { on: true } }), /only GP-50/);
  assert.equal(parsePrst(load("65-Puppy.prst")).settings.exp, undefined);
  assert.equal(parsePrst(applyEdits(usLead, { bpm: 400 })).settings.bpm, 260, "BPM clamps to 40..260");
});

test("footswitch validation: at most 3 blocks per switch, disjoint", () => {
  assert.equal(validateFootswitches([2, 6], [7]), null);
  assert.match(validateFootswitches([0, 1, 2, 6], []), /at most 3/);
  assert.match(validateFootswitches([2], [2]), /one footswitch only/);
  assert.match(validateFootswitches([10], []), /0..9/);
  assert.throws(() => applyEdits(load("gp50-US-Lead.prst"), { footswitches: { fs1: [0, 1, 2, 6] } }), /at most 3/);
});

test("catalog: enum labels replace the wrong MidFreq unit; Sync toggles name the param they drive", () => {
  const midFreq = findParam(0x07000073, "MidFreq", "gp50");
  assert.deepEqual(midFreq.labels, ["220 Hz", "450 Hz", "800 Hz", "1.6 kHz", "3 kHz"]);
  assert.equal(midFreq.unit, undefined);
  assert.deepEqual(findParam(0x01000001, "Mode", "gp50").labels, ["Standard", "Jumbo", "Enhanced", "Piezo"]);
  assert.deepEqual(findParam(0x0100000f, "Mode", "gp50").labels, ["Guitar", "Bass"]);
  assert.deepEqual(findParam(0x07000027, "Char", "gp50").labels, ["Cool", "Hot"]);
  const toggles = modelsFor("gp50").flatMap((m) => m.params.filter((p) => p.syncs !== undefined));
  assert.equal(toggles.length, 22);
  assert.equal(modelsFor("gp5").flatMap((m) => m.params.filter((p) => p.syncs !== undefined)).length, 0);
  assert.equal(syncToggleFor(0x0b000006, 4, "gp50").name, "S-Sync", "Sweep Eko S-Sync drives S-Rate");
  assert.equal(syncToggleFor(0x0b000006, 1, "gp50").name, "D-Sync");
  assert.equal(syncToggleFor(0x04000019, 0, "gp50").index, 1, "Phaser 90 Sync@1 drives Rate@0");
  const pureEko = [20, 8, 30, 1, 0, 0, 0, 0];
  assert.ok(isSynced(0x0b000000, 1, pureEko, "gp50"));
  assert.ok(!isSynced(0x0b000000, 1, [20, 500, 30, 0], "gp50"));
  assert.ok(!isSynced(0x0b000000, 1, pureEko, "gp5"), "the GP-5 has no Sync");
  const shown = displayedParam(0x0b000000, 1, pureEko, "gp50");
  assert.deepEqual([shown.min, shown.max, shown.step, shown.labels[8], shown.unit], [0, 10, 1, "1/8D", undefined]);
  assert.equal(displayedParam(0x0b000000, 1, [20, 500, 30, 0], "gp50").unit, "ms");
  assert.equal(SYNC_DIVISIONS.length, 11);
});
