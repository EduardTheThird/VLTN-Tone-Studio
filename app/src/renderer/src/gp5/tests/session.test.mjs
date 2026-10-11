import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MockGp5 } from "../lib/mock-device.mjs";
import { applyEdits, convertPrst, parsePrst } from "../lib/prst.mjs";
import { Gp5Session } from "../lib/session.mjs";

const load = (n) => new Uint8Array(readFileSync(new URL(`../fixtures/${n}`, import.meta.url)));
const presets = [load("65-Puppy.prst"), load("67-OerdriveM.prst"), load("97-FF_CC.prst")];
const fast = { settleMs: 5, editSettleMs: 1, postSelectMs: 5, readTimeoutMs: 500, interMessageMs: 20 };

function setup(opts = {}) {
  const dev = new MockGp5({ presets, ...opts });
  const s = new Gp5Session(dev.transport(), { timing: fast });
  return { dev, s };
}

test("reads names, current slot, body and globals", async () => {
  const { dev, s } = setup();
  const names = await s.readPresetNames();
  assert.equal(names.length, 100);
  assert.deepEqual(names.slice(0, 4).map((n) => n.name), ["Puppy", "Oerdrive M", "FF CC", "GP-5"]);
  assert.equal(await s.readCurrentSlot(), 0);
  assert.deepEqual(await s.readCurrentBody(), dev.buffer);
  assert.equal((await s.readGlobals()).masterVolume, 80);
  assert.equal((await s.readSnapTones()).length, 80);
  assert.deepEqual(dev.violations, [], "session must keep >= 15 ms between messages");
  await s.close();
});

test("selectPreset auto: CC#0 first, SysEx fallback when CC is ignored", async () => {
  const { dev, s } = setup();
  assert.equal(await s.selectPreset(2), 2);
  assert.equal(dev.current, 2);
  dev.acceptCcSelect = false;
  assert.equal(await s.selectPreset(1), 1);
  assert.deepEqual(Array.from(dev.log.at(-2).subarray(0, 2)), [0x11, 0x43], "fell back to SysEx 11 43");
  const p = await s.readPreset(1);
  assert.equal(parsePrst(p).name, "Oerdrive M");
  assert.deepEqual(p, presets[1]);
  await s.close();
});

test("live edits change the active buffer; savePreset needs confirm", async () => {
  const { dev, s } = setup();
  await s.setParam("AMP", 0, 33);
  await s.setBlockEnabled("DLY", true);
  await s.setPatchVolume(64);
  const live = parsePrst((await s.syncState()).prst);
  assert.equal(live.blocks[3].params[0], 33);
  assert.ok(live.blocks[7].enabled);
  assert.equal(live.settings.volume, 64);
  await assert.rejects(s.savePreset(10, "Mine"), /confirm/);
  const r = await s.savePreset(10, "Mine", { confirm: true });
  assert.equal(r.acked, 1);
  assert.equal(dev.slots[10].name, "Mine");
  await s.close();
});

test("writePreset streams 26 ACKed frames and verifies by read-back", async () => {
  const { dev, s } = setup();
  const edited = applyEdits(presets[2], { name: "Written", blocks: { RVB: { params: { 0: 12 } } } });
  const r = await s.writePreset(42, edited, { confirm: true });
  assert.deepEqual(r, { frames: 26, acked: 26, attempts: 1, verified: true });
  assert.equal(dev.slots[42].name, "Written");
  await s.close();
});

test("writePreset restarts the stream when a frame is not acknowledged", async () => {
  const { dev, s } = setup();
  dev.dropFrames = 1;
  const r = await s.writePreset(7, applyEdits(presets[0], { name: "Retry" }), { confirm: true });
  assert.equal(r.attempts, 2);
  assert.ok(r.verified);
  assert.equal(dev.slots[7].name, "Retry");
  await s.close();
});

test("unsolicited pedal events reach listeners", async () => {
  const { dev, s } = setup();
  const seen = [];
  s.addEventListener("message", (e) => seen.push(e.message));
  dev.pressPreset(5);
  dev.turnKnob(3, 0, 12.5);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(seen.map((m) => m.type), ["slot", "param"]);
  assert.equal(seen[0].slot, 5);
  assert.equal(seen[1].value, 12.5);
  await s.close();
});

test("backupAll restores the original slot", async () => {
  const { dev, s } = setup();
  await s.selectPreset(1);
  const progress = [];
  const all = await s.backupAll({ slots: [0, 2, 3], onProgress: (d, t) => progress.push(`${d}/${t}`) });
  assert.deepEqual(all.map((e) => e.name), ["Puppy", "FF CC", "GP-5"]);
  assert.deepEqual(progress, ["1/3", "2/3", "3/3"]);
  assert.equal(dev.current, 1);
  await s.close();
});

const gp50Presets = [load("gp50-US-Lead.prst"), load("gp50-76-VoxUltNAM.prst")];

test("GP-50: the body length identifies the pedal; reads rebuild 552-byte presets", async () => {
  const dev = new MockGp5({ presets: gp50Presets });
  const s = new Gp5Session(dev.transport(), { timing: fast });
  assert.equal(s.device, null);
  const snap = await s.syncState();
  assert.equal(snap.device, "gp50");
  assert.equal(s.device, "gp50");
  assert.deepEqual(snap.prst, gp50Presets[0]);
  assert.equal(snap.names[2].name, "GP-50", "empty slots carry the GP-50 default name");
  assert.deepEqual(await s.readPreset(1, { names: snap.names }), gp50Presets[1]);
  await s.close();
});

test("GP-50: writePreset streams 29 frames; a preset of the other model is refused", async () => {
  const dev = new MockGp5({ presets: gp50Presets });
  const s = new Gp5Session(dev.transport(), { timing: fast });
  const edited = applyEdits(gp50Presets[0], { name: "Lead 50", blocks: { DLY: { params: { 3: 1 } } } });
  const r = await s.writePreset(42, edited, { confirm: true });
  assert.deepEqual(r, { frames: 29, acked: 29, attempts: 1, verified: true });
  assert.equal(dev.slots[42].name, "Lead 50");
  await assert.rejects(s.writePreset(43, presets[0], { confirm: true }), /GP-5 preset but the pedal is a GP-50/);
  const converted = await s.writePreset(43, convertPrst(presets[0], "gp50"), { confirm: true });
  assert.ok(converted.verified);
  await s.close();
});

test("a GP-5 session refuses a GP-50 preset", async () => {
  const { s } = setup();
  await assert.rejects(s.writePreset(10, gp50Presets[0], { confirm: true }), /GP-50 preset but the pedal is a GP-5/);
  await s.close();
});
