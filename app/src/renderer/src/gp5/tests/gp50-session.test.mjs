// Gp5Session against the GP-50 profile of MockGp5 (skill valeton-gp50 simulator.md), plus the refusals on a GP-5.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MockGp5 } from "../lib/mock-device.mjs";
import { GP50_FIRST_USER_SLOT, nativeGp50Bank } from "../lib/mock-bank.mjs";
import { packetize } from "../lib/protocol.mjs";
import { blankGp50Prst, bodyOf, isCrcValid, parsePrst, readName } from "../lib/prst.mjs";
import { Gp5Error, Gp5Session } from "../lib/session.mjs";

const load = (n) => new Uint8Array(readFileSync(new URL(`../fixtures/${n}`, import.meta.url)));
const seeds = [load("gp50-US-Lead.prst"), load("gp50-76-VoxUltNAM.prst")];
const fast = { settleMs: 5, editSettleMs: 1, postSelectMs: 5, readTimeoutMs: 500, interMessageMs: 20 };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function setup(opts = {}) {
  const dev = new MockGp5({ presets: nativeGp50Bank(seeds), ...opts });
  const s = new Gp5Session(dev.transport(), { timing: fast });
  const seen = [];
  s.addEventListener("message", (e) => seen.push(e.message));
  return { dev, s, seen };
}
const live = async (s) => parsePrst((await s.syncState()).prst);
const fnsSent = (dev) => dev.log.map((p) => p[1]);

test("native GP-50 bank: seeds, generated factory presets, empty user slots", () => {
  const bank = nativeGp50Bank(seeds);
  assert.equal(bank.length, 100);
  assert.deepEqual(bank[0], seeds[0]);
  assert.ok(bank.every((p) => p.length === 552 && isCrcValid(p)));
  assert.ok(bank.slice(2, GP50_FIRST_USER_SLOT).every((p) => readName(p) !== "GP-50"));
  assert.ok(bank.slice(GP50_FIRST_USER_SLOT).every((p) => readName(p) === "GP-50" && bodyOf(p).every((v, i) => v === bodyOf(blankGp50Prst())[i])));
  assert.deepEqual(parsePrst(bank[10]).footswitches, { fs1: [2, 6], fs2: [7] });
  assert.throws(() => nativeGp50Bank([load("65-Puppy.prst")]), /GP-50/);
});

test("connect: GP-50 globals map, firmware, is-modified flag in syncState", async () => {
  const { dev, s } = setup();
  const snap = await s.syncState();
  assert.equal(snap.device, "gp50");
  assert.equal(snap.modified, false);
  assert.equal(snap.globals.firmware, "1.1.0");
  assert.deepEqual([snap.globals.masterVolume, snap.globals.monitorLevel, snap.globals.recModeRight, snap.globals.dcUnplug], [50, 0, 1, 1]);
  assert.equal(snap.globals.btLevel, undefined);
  await s.setParam("AMP", 0, 61);
  assert.equal(await s.readModified(), true);
  assert.deepEqual(dev.violations, []);
  await s.close();
  const old = setup({ firmware: "1.0.5" });
  const g = await old.s.readGlobals();
  assert.deepEqual([g.firmware, g.dcUnplug, g.midiChannelBt], ["1.0.5", undefined, undefined]);
  await old.s.close();
});

test("globals: int32 writes on the GP-50 record ids, negative values survive, the pedal pushes the record", async () => {
  const { dev, s, seen } = setup();
  await s.setGlobal("monitorLevel", -20);
  await s.setGlobal("btRecordLevel", 7);
  await s.setGlobal("footswitchMode", 1);
  const g = await s.readGlobals();
  assert.deepEqual([g.monitorLevel, g.btRecordLevel, g.footswitchMode], [-20, 7, 1]);
  assert.deepEqual(dev.globalRecords.find(([a, b]) => a === 3 && b === 4), [3, 4, 4, -20]);
  await assert.rejects(s.setGlobal("btLevel", 3), /unknown gp50 global btLevel/);
  assert.deepEqual(seen.filter((m) => m.type === "global").map((m) => [m.a, m.b, m.value]), [[3, 4, -20], [2, 4, 7], [1, 6, 1]]);
  await s.close();
});

test("BPM and EXP records update the active preset and are echoed", async () => {
  const { s, seen } = setup();
  await s.setBpm(140);
  await s.setExp({ on: true, paramMin: 13, paramMax: 87, volPosition: 1, volMin: 10, volMax: 90, targetModule: 9, targetParam: 1 });
  const p = await live(s);
  assert.equal(p.settings.bpm, 140);
  assert.deepEqual(p.settings.exp, { on: true, paramMin: 13, paramMax: 87, volPosition: 1, volMin: 10, volMax: 90, targetModule: 9, targetParam: 1 });
  const echoes = seen.filter((m) => m.type === "patchSetting").flatMap((m) => m.settings);
  assert.deepEqual(echoes[0], { record: 0x2002, value: 140 });
  assert.equal(echoes.length, 9);
  await assert.rejects(s.setBpm(30), /bpm must be an integer 40..260/);
  await assert.rejects(s.setExp({ targetModule: 12 }), /targetModule/);
  await assert.rejects(s.setExp({ wah: 1 }), /unknown EXP setting/);
  await s.close();
});

test("Sync toggle: the pedal resets the bound Time (1/4 on, default off); setSync returns the re-read body", async () => {
  const { s, seen } = setup();
  await s.identify(); // slot 0 = US Lead: DLY Pure Eko, Time 500 ms
  const on = await s.setSync("DLY", 3, true);
  const after = parsePrst((await s.syncState()).prst).blocks[7];
  assert.deepEqual([after.params[3], after.params[1]], [1, 4]);
  assert.equal(on.length, 511);
  await s.setSync("DLY", 3, false);
  assert.equal((await live(s)).blocks[7].params[1], 500);
  assert.deepEqual(seen.filter((m) => m.type === "param").map((m) => [m.block, m.index, m.value]), [[7, 1, 4], [7, 1, 500]]);
  await s.close();
});

test("footswitch masks and chain order: validated client-side, applied by the pedal, state bytes recomputed", async () => {
  const { dev, s } = setup();
  await s.setFootswitchMasks([2, 6], [7]);
  let p = await live(s);
  assert.deepEqual(p.footswitches, { fs1: [2, 6], fs2: [7] });
  const prst = (await s.syncState()).prst;
  assert.deepEqual(Array.from(prst.subarray(-2)), [p.blocks[2].enabled && p.blocks[6].enabled ? 6 : 5, p.blocks[7].enabled ? 6 : 5]);
  await assert.rejects(s.setFootswitchMasks([0, 1, 2, 6], []), /at most 3/);
  await assert.rejects(s.setFootswitchMasks([2], [2]), /one footswitch only/);
  await s.setOrder([0, 1, 2, 9, 3, 4, 5, 6, 8, 7]);
  p = await live(s);
  assert.deepEqual(p.order, [0, 1, 2, 9, 3, 4, 5, 6, 8, 7]);
  await assert.rejects(s.setOrder([0, 1, 2, 3, 9, 4, 5, 6, 7, 8]), /contiguous/);
  // a host that skips validation: the pedal ignores the illegal masks (FS1 = 4 blocks)
  await s.command([0x11, 0x4d, 0x0f, 0, 0, 0, 0, 0, 0, 0]);
  assert.match(dev.rejected.at(-1).reason, /at most 3/);
  await s.close();
});

test("preset management: delete, paste, move need confirm; names change as on the pedal", async () => {
  const { dev, s, seen } = setup({ notifyListChanges: true });
  await assert.rejects(s.deletePreset(1), (e) => e instanceof Gp5Error && e.code === "unsafe");
  await assert.rejects(s.pastePreset(60, 0), /confirm/);
  await assert.rejects(s.movePreset(0, 1), /confirm/);
  await s.pastePreset(60, 0, { confirm: true });
  assert.equal((await s.readPresetNames())[60].name, "US Lead");
  await s.deletePreset(1, { confirm: true });
  let names = await s.readPresetNames();
  assert.equal(names[1].name, "GP-50");
  assert.deepEqual(dev.slots[1].body, bodyOf(blankGp50Prst()));
  await s.movePreset(60, 2, { confirm: true });
  names = await s.readPresetNames();
  assert.deepEqual([names[2].name, names[3].name, names[61].name], ["US Lead", readName(nativeGp50Bank(seeds)[2]), "GP-50"]);
  await tick();
  assert.deepEqual(seen.filter((m) => m.type === "listChanged").map((m) => m.list), ["presets", "presets", "presets"]);
  await s.close();
});

test("export read returns a valid 552-byte .prst without changing the active slot", async () => {
  const { dev, s } = setup();
  const bank = nativeGp50Bank(seeds);
  for (const slot of [0, 1, 20, 70]) assert.deepEqual(await s.exportPreset(slot), bank[slot], `slot ${slot}`);
  assert.equal(dev.current, 0);
  assert.equal(fnsSent(dev).filter((fn) => fn === 0x43).length, 0, "no select");
  await s.close();
});

test("GP-50 select: SysEx 11 43 first (verified by 0x43), Program Change works too; GP-5 keeps CC#0 first", async () => {
  const { dev, s, seen } = setup({ notifySelect: true });
  assert.equal(await s.selectPreset(5), 5);
  assert.deepEqual(Array.from(dev.log.find((p) => p[1] === 0x43 && p[0] === 0x11).subarray(0, 3)), [0x11, 0x43, 5]);
  assert.equal(await s.selectPreset(7, { method: "pc" }), 7);
  await tick();
  assert.ok(seen.some((m) => m.type === "slot" && m.slot === 5), "12 43 s16 notification");
  await s.close();
  const gp5 = new MockGp5({ presets: [load("65-Puppy.prst")] });
  const s5 = new Gp5Session(gp5.transport(), { timing: fast });
  await assert.rejects(s5.selectPreset(3, { method: "pc" }), /pedal reports slot 0/, "the GP-5 ignores Program Change");
  assert.equal(await s5.selectPreset(3), 3);
  await s5.close();
});

test("live edits are coalesced per (fn, target), never per fn alone", async () => {
  const { dev, s } = setup();
  await s.identify();
  const busy = s.exclusive(() => tick(50)); // keep the pedal busy so the edits queue up
  const edits = [s.setParam("AMP", 0, 10), s.setParam("AMP", 0, 20), s.setParam("AMP", 1, 5), s.setParam("AMP", 0, 30), s.setBpm(100), s.setBpm(101)];
  await busy;
  await Promise.all(edits);
  const sent = dev.log.filter((p) => p[1] === 0x48 || p[1] === 0x42);
  // 0x48: [fn, algId]; 0x42: [fn, value] — one message per target, carrying the latest value
  assert.deepEqual(sent.map((p) => [p[1], p[6]]), [[0x48, 0], [0x48, 1], [0x42, 101]]);
  const p = await live(s);
  assert.deepEqual([p.blocks[3].params[0], p.blocks[3].params[1], p.settings.bpm], [30, 5, 101]);
  await s.close();
});

test("safety: factory reset and firmware frames are never answered, only recorded", async () => {
  const { dev, s } = setup();
  const r = await s.command([0x11, 0x3f]);
  assert.deepEqual(r, { frames: 1, acked: 0 });
  await s.command([0x11, 0x60, 1, 2, 3]);
  assert.deepEqual(dev.refused.map((p) => p[1]), [0x3f, 0x60]);
  assert.equal(await s.readCurrentSlot(), 0, "the pedal still answers afterwards");
  await s.close();
});

test("faults: wedge on overrun until power-cycle; a read right after a select races", async () => {
  const dev = new MockGp5({ presets: nativeGp50Bank(seeds), wedgeOnOverrun: true });
  dev.setOutput(() => {});
  for (const m of packetize([0x12, 0x40])) dev.receive(m);
  for (const m of packetize([0x12, 0x43])) dev.receive(m);
  assert.ok(dev.wedged);
  dev.powerCycle();
  assert.ok(!dev.wedged);
  const racy = new MockGp5({ presets: nativeGp50Bank(seeds), selectRaceMs: 10_000 });
  const s = new Gp5Session(racy.transport(), { timing: fast });
  await s.selectPreset(1, { method: "sysex" }).catch(() => {}); // identify() reads slot 0 first, then selects 1
  const body = await s.readCurrentBody();
  assert.notDeepEqual(body, racy.slots[1].body, "merged body inside the race window");
  await s.close();
});

test("pedal helpers: Stomp-mode footswitch toggles its blocks; EXP pedal drives the target param; tap tempo", async () => {
  const { dev, s, seen } = setup();
  await s.setGlobal("footswitchMode", 1);
  await s.setFootswitchMasks([7], []);
  await s.setBlockEnabled("DLY", false);
  dev.pressFootswitch("A");
  await tick();
  assert.ok((await live(s)).blocks[7].enabled);
  assert.deepEqual(seen.filter((m) => m.type === "block").map((m) => [m.block, m.enabled]), [[7, true]]);
  await s.setExp({ on: true, targetModule: 9, targetParam: 0, paramMin: 0, paramMax: 100 }); // DLY Mix 0..100
  dev.setExp(40);
  assert.equal((await live(s)).blocks[7].params[0], 40);
  dev.tap(1000);
  dev.tap(1500);
  assert.equal((await live(s)).settings.bpm, 120);
  await s.close();
});

test("GP-50-only commands are refused on a GP-5", async () => {
  const gp5 = new MockGp5({ presets: [load("65-Puppy.prst")] });
  const s = new Gp5Session(gp5.transport(), { timing: fast });
  const unsafe = (e) => e instanceof Gp5Error && e.code === "unsafe";
  await assert.rejects(s.setExp({ on: true }), unsafe);
  await assert.rejects(s.setPatchSetting(0x2003, 1), unsafe);
  await assert.rejects(s.setFootswitchMasks([1], []), unsafe);
  await assert.rejects(s.setOrder([0, 1, 2, 9, 3, 4, 5, 6, 7, 8]), unsafe);
  await assert.rejects(s.setSync("DLY", 3, true), unsafe);
  await assert.rejects(s.deletePreset(1, { confirm: true }), unsafe);
  await assert.rejects(s.pastePreset(2, 1, { confirm: true }), unsafe);
  await assert.rejects(s.movePreset(2, 1, { confirm: true }), unsafe);
  await assert.rejects(s.exportPreset(1), unsafe);
  await assert.rejects(s.readModified(), unsafe);
  assert.equal((await s.syncState()).modified, null);
  assert.ok(gp5.log.every((p) => ![0x44, 0x45, 0x46, 0x4b, 0x4d, 0x4f, 0x5a].includes(p[1])), "nothing GP-50-only reached the pedal");
  await s.setGlobal("monitorLevel", -3); // the GP-5 map: (2,4)
  assert.deepEqual(gp5.globalRecords.find(([a, b]) => a === 2 && b === 4), [2, 4, 1, -3]);
  await s.close();
});
