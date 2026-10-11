// In-memory GP-5 / GP-50 simulator speaking the documented USB protocol. Use it for unit tests, UI development and
// (via scripts/virtual-gp5.mjs) as a virtual MIDI device. It models what open-source captures, hardware and static RE
// of Valeton Suite show; behaviour the pedal has not been observed to do (e.g. param defaults after a model change) is
// NOT invented. The presets decide the model: 507-byte files make a GP-5, 552-byte files a GP-50.
//
// GP-50 profile (Valeton Suite 2.1.0 RE): GP-50 globals with int32 values, 0x42 patch-setting records with
// echoes, 0x4D masks, 0x44 order, 0x46/0x4B/0x5A preset management, 0x45 is-modified, 12 4F export, select via
// 11 43 / CC#0 / Program Change, the full GP-50 CC chart, Sync resets, and faults (wedge on overrun, select race).
// Forbidden functions (factory reset 0x3F, 0x1C, 0x33, firmware 0x60..0x6E, ...) are never answered, only recorded.
// The GP-5 profile behaves exactly as before.

import { modelByFxid, SYNC_ON_DIVISION } from "./catalog.mjs";
import {
  BLOCKS,
  CC,
  CC_GP50,
  CMD,
  FRAME_PAYLOAD_MAX,
  KIND,
  NOTIFY_LIST_CHANGED,
  PATCH_SETTINGS,
  PRESET_COUNT,
  READ,
  Reassembler,
  blocksOfMask,
  expTargetBlock,
  f32le,
  isForbiddenFn,
  packetize,
  parseSysex,
  patchSettingByRecord,
  u32le,
} from "./protocol.mjs";
import { BODY_OFF, DEVICES, SETTING_SIZES, applyEdits, blankGp50Prst, bodyOf, detectDevice, parsePrst, readName, rebuildPrst, validateFootswitches, validateOrder } from "./prst.mjs";
import { checkSnapToneFile, decodeImportSnapTone, isUserSnapToneSlot } from "./snaptone.mjs";
import { decodeImportUserIr } from "./userir.mjs";

const ACK = [KIND.ACK, 0x08, 0x00]; // device ACK frame BUF b2 01 00 03 14 08 00
const readU32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const readI32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
const nameBytes = (s, n) => Array.from({ length: n }, (_, i) => (i < s.length ? s.charCodeAt(i) & 0xff : 0));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isOn = (v) => v >= 64;

// GP-5 0x10 record layout copied from a real GP-5 reply: [a, b, len, value]
const GP5_GLOBALS = [[1, 1, 4, 0x01010006], [2, 1, 4, 1], [2, 2, 4, 80], [1, 2, 1, 0], [3, 2, 1, 100], [1, 3, 1, 0], [1, 4, 1, 0], [2, 4, 1, 0], [3, 4, 1, 1], [4, 4, 1, 1], [5, 4, 1, 0], [3, 3, 1, 0], [7, 4, 2, 3]];
// GP-50 records (Suite 2.1.0 RE, all int32) with plausible menu defaults; (4,10) and (1,13) only on firmware 1.1.0.
const GP50_GLOBALS = [
  [2, 1, 1], [1, 2, 0], [2, 2, 50], [1, 3, 0], [3, 3, 0], [4, 3, 0], [1, 4, 0], [2, 4, 0], [3, 4, 0], [4, 4, 1], [5, 4, 1],
  [1, 5, 0], [5, 5, 3], [6, 5, 4], [1, 6, 0], [2, 6, 0], [1, 9, 0], [2, 9, 1], [1, 10, 3], [2, 10, 0], [3, 10, 0], [1, 11, 1],
];
const GP50_FIRMWARE = Object.freeze({ "1.0.5": 0x01010005, "1.1.0": 0x01010100 });
const GP50_110_GLOBALS = [[4, 10, 0], [1, 13, 1]];
/** Taps further apart than this restart the tap tempo (Suite's rule). */
const TAP_RESET_MS = 2000;

export class MockGp5 {
  /**
   * @param opts {
   *   presets: Array<Uint8Array> (.prst files of ONE model: 507-byte GP-5 or 552-byte GP-50; they decide the simulated
   *   pedal; a shorter list is cycled, extra slots get the model's empty name "GP-5" / "GP-50"; see mock-bank.mjs for a
   *   full native GP-50 bank),
   *   latencyMs = 1, minGapMs = 15 (gaps below this are recorded in .violations),
   *   snapTones?: string[80], userIRs?: string[20], acceptProgramChange (default: GP-50 only), acceptCcSelect = true,
   *   GP-50 only: firmware = "1.1.0" | "1.0.5", echoHostEdits = true (0x42 echo and 0x11 record push after host writes),
   *   notifySelect = false (12 43 after host selects too), notifyListChanges = false (12 1B 02/03/04),
   *   wedgeOnOverrun = false, selectRaceMs = 0 }
   */
  constructor({
    presets,
    latencyMs = 1,
    minGapMs = 15,
    snapTones = [],
    userIRs = [],
    acceptProgramChange,
    acceptCcSelect = true,
    firmware = "1.1.0",
    echoHostEdits = true,
    notifySelect = false,
    notifyListChanges = false,
    wedgeOnOverrun = false,
    selectRaceMs = 0,
  } = {}) {
    if (!presets?.length) throw new Error("MockGp5 needs at least one GP-5 or GP-50 .prst");
    const model = detectDevice(presets[0]);
    if (presets.some((p) => detectDevice(p).key !== model.key)) throw new Error("MockGp5 presets must all belong to one model");
    if (model.key === "gp50" && !GP50_FIRMWARE[firmware]) throw new RangeError(`unknown GP-50 firmware ${firmware}; use 1.0.5 or 1.1.0`);
    /** Simulated model ("gp5" | "gp50"). */
    this.device = model.key;
    this.gp50 = model.key === "gp50";
    this.slots = Array.from({ length: PRESET_COUNT }, (_, i) => {
      const src = presets[i % presets.length];
      return { name: i < presets.length ? readName(src) : model.emptyName, body: bodyOf(src) };
    });
    this.current = 0;
    this.buffer = this.slots[0].body.slice();
    this.globalRecords = this.gp50 ? gp50Globals(firmware) : GP5_GLOBALS.map((r) => [...r]);
    // flag 0 = user content, 1 = factory/empty (as on hardware)
    this.snapTones = Array.from({ length: 80 }, (_, i) => (snapTones[i] ? { name: snapTones[i], flag: i < 50 ? 1 : 0 } : { name: i < 50 ? `Factory ${i + 1}` : "Empty", flag: 1 }));
    this.userIRs = Array.from({ length: 20 }, (_, i) => (userIRs[i] ? { name: userIRs[i], flag: 0 } : { name: `User IR ${i + 1}`, flag: 1 }));
    this.snapToneFiles = new Map(); // slot -> uploaded 2696-byte SnapTone file
    this.userIrFiles = new Map(); // slot -> uploaded 2048-byte User IR data block
    this.latencyMs = latencyMs;
    this.minGapMs = minGapMs;
    this.acceptProgramChange = acceptProgramChange ?? this.gp50;
    this.acceptCcSelect = acceptCcSelect;
    this.echoHostEdits = echoHostEdits;
    this.notifySelect = notifySelect;
    this.notifyListChanges = notifyListChanges;
    this.wedgeOnOverrun = wedgeOnOverrun;
    this.selectRaceMs = selectRaceMs;
    this.dropFrames = 0; // > 0: lose frame #5 of the next multi-frame write(s), like a busy pedal
    this.log = []; // decoded host->device payloads, newest last
    this.violations = []; // { gapMs } for host messages sent faster than minGapMs
    this.refused = []; // GP-50: forbidden payloads (factory reset, firmware, ...) received and never answered
    this.rejected = []; // GP-50: { payload, reason } of commands the pedal would not apply (illegal masks/order)
    this.wedged = false; // GP-50 + wedgeOnOverrun: no replies until powerCycle()
    this.modified = false; // GP-50 0x45 flag: the active buffer differs from the stored slot
    this.tuner = false;
    this.looper = { on: false, recording: false, playing: false, recordVolume: 100, playVolume: 100 };
    this.drum = { menu: false, playing: false, type: 0, volume: 50, sync: false };
    this.expPosition = 0; // EXP pedal 0..100
    this.expVolume = 100; // effect of an EXP pedal on target VOL, 0..100
    this.#reasm = new Reassembler();
  }
  #reasm;
  #listener = null;
  #lastRx = 0;
  #pendingReplyFrames = 0;
  #swallowFrames = 0;
  #lastSelect = { at: 0, previous: null };
  #tempoMsb = 0;
  #taps = [];

  /** Transport for Gp5Session (host side). */
  transport() {
    this.#reopen();
    return {
      name: `${DEVICES[this.device].name} (mock)`,
      send: (bytes) => this.receive(Uint8Array.from(bytes)),
      onMessage: (cb) => {
        this.#listener = cb;
      },
      close: () => {
        this.#listener = null;
      },
    };
  }

  /** Attach any sink for device->host bytes (used by the virtual-port bridge). */
  setOutput(cb) {
    this.#reopen();
    this.#listener = cb;
  }

  /** Reopening the port of a GP-50 that wedges on overruns wedges it (drewmerc302/valeton-gp50 hardware anecdote). */
  #reopen() {
    if (this.#listener && this.gp50 && this.wedgeOnOverrun) this.wedged = true;
  }

  /** Power-cycle: clears a wedge and drops unsaved edits of the active slot. */
  powerCycle() {
    this.wedged = false;
    this.#reasm.reset();
    this.#swallowFrames = 0;
    this.#pendingReplyFrames = 0;
    this.buffer = this.slots[this.current].body.slice();
    this.modified = false;
  }

  #emit(bytes, isReply = false) {
    const b = Uint8Array.from(bytes);
    if (isReply) this.#pendingReplyFrames++;
    setTimeout(() => {
      if (isReply) this.#pendingReplyFrames--;
      this.#listener?.(b);
    }, this.latencyMs);
  }
  #reply(payload) {
    for (const m of packetize(payload, FRAME_PAYLOAD_MAX)) this.#emit(m, true);
  }

  /** Bytes from host. */
  receive(bytes) {
    const now = Date.now();
    if (this.#lastRx && now - this.#lastRx < this.minGapMs) this.violations.push({ gapMs: now - this.#lastRx });
    this.#lastRx = now;
    if (this.gp50 && this.wedgeOnOverrun && this.#pendingReplyFrames > 0) this.wedged = true;
    if (this.wedged) return;
    if (bytes[0] !== 0xf0) return this.#short(bytes);
    const frame = parseSysex(bytes);
    if (!frame || !frame.crcOk) return; // the real pedal ignores malformed frames
    if (this.gp50 && this.#refuse(frame)) return;
    const isRead = frame.total === 1 && frame.payload[0] === KIND.GET;
    if (!isRead && frame.total > 1 && this.dropFrames > 0 && frame.index === 5) {
      // simulate a busy pedal: frame lost, no ACK, partial transfer discarded (seen on hardware)
      this.dropFrames--;
      this.#reasm.reset();
      return;
    }
    if (!isRead) this.#emit(packetize(ACK)[0]);
    const payload = this.#reasm.push(frame);
    if (payload) this.#handle(payload);
  }

  /** GP-50 safety: forbidden functions and firmware data frames (total 0xFF) get no ACK and no reply. */
  #refuse(frame) {
    if (this.#swallowFrames > 0) {
      this.#swallowFrames--;
      return true;
    }
    const p = frame.payload;
    const forbidden = frame.total === 0xff || (frame.index === 0 && p[0] === KIND.SET && isForbiddenFn(p[1]));
    if (!forbidden) return false;
    this.refused.push(p.slice());
    if (frame.total !== 0xff) this.#swallowFrames = frame.total - 1;
    return true;
  }

  #short([status, d1, d2]) {
    const type = status & 0xf0;
    if (type === 0xc0) {
      if (this.acceptProgramChange && d1 < PRESET_COUNT) this.#select(d1);
    } else if (type === 0xb0 && d1 === CC.PRESET_SELECT) {
      if (this.acceptCcSelect && d2 < PRESET_COUNT) this.#select(d2);
    } else if (type === 0xb0) {
      const blk = Object.entries(CC.BLOCK_SWITCH).find(([, cc]) => cc === d1)?.[0];
      if (blk) this.#setMask(BLOCKS.indexOf(blk), isOn(d2));
      else if (this.gp50) this.#ccGp50(d1, d2);
    }
  }

  /** GP-50 CC chart (GP-50 manual); the GP-5-only CCs 22/23/29/30 fall through and are ignored. */
  #ccGp50(cc, v) {
    const step = isOn(v) ? 1 : -1;
    const bpm = () => parsePrst(this.#prst()).settings.bpm;
    const actions = {
      [CC_GP50.MASTER_VOLUME]: () => this.#setGlobalValue(2, 2, clamp(v, 0, 100)),
      [CC_GP50.PATCH_VOLUME]: () => this.#edit({ volume: clamp(v, 0, 100) }),
      [CC_GP50.EXP_VALUE]: () => this.setExp(clamp(v, 0, 100)),
      [CC_GP50.EXP_SWITCH]: () => this.#edit({ exp: { on: isOn(v) } }),
      [CC_GP50.MASTER_VOLUME_STEP]: () => this.#setGlobalValue(2, 2, clamp(this.#globalValue(2, 2) + step, 0, 100)),
      [CC_GP50.BPM_STEP]: () => this.#edit({ bpm: bpm() + step }),
      [CC_GP50.PATCH_VOLUME_STEP]: () => this.#edit({ volume: clamp(parsePrst(this.#prst()).settings.volume + step, 0, 100) }),
      [CC_GP50.PATCH_DOWN]: () => this.#select((this.current + PRESET_COUNT - 1) % PRESET_COUNT),
      [CC_GP50.PATCH_UP]: () => this.#select((this.current + 1) % PRESET_COUNT),
      [CC_GP50.UNIT_MODE]: () => this.#setGlobalValue(1, 6, isOn(v) ? 1 : 0),
      [CC_GP50.TUNER]: () => (this.tuner = isOn(v)),
      [CC_GP50.LOOPER]: () => (this.looper = { ...this.looper, on: isOn(v) }),
      [CC_GP50.LOOPER_RECORD]: () => (this.looper = { ...this.looper, recording: isOn(v) }),
      [CC_GP50.LOOPER_PLAY]: () => (this.looper = { ...this.looper, playing: isOn(v), recording: false }),
      [CC_GP50.LOOPER_DELETE]: () => (this.looper = { ...this.looper, recording: false, playing: false }),
      [CC_GP50.LOOPER_RECORD_VOLUME]: () => (this.looper = { ...this.looper, recordVolume: clamp(v, 0, 100) }),
      [CC_GP50.LOOPER_PLAY_VOLUME]: () => (this.looper = { ...this.looper, playVolume: clamp(v, 0, 100) }),
      [CC_GP50.CTL]: () => this.#toggleFootswitchBlocks(0),
      [CC_GP50.CTL2]: () => this.#toggleFootswitchBlocks(1),
      [CC_GP50.TEMPO_MSB]: () => (this.#tempoMsb = v),
      [CC_GP50.TEMPO_LSB]: () => this.#edit({ bpm: this.#tempoMsb * 128 + v }),
      [CC_GP50.TAP]: () => this.tap(),
      [CC_GP50.DRUM_MENU]: () => (this.drum = { ...this.drum, menu: isOn(v) }),
      [CC_GP50.DRUM_PLAY]: () => (this.drum = { ...this.drum, playing: isOn(v) }),
      [CC_GP50.DRUM_TYPE]: () => (this.drum = { ...this.drum, type: clamp(v, 0, 9) }),
      [CC_GP50.DRUM_VOLUME]: () => (this.drum = { ...this.drum, volume: clamp(v, 0, 100) }),
      [CC_GP50.DRUM_SYNC]: () => (this.drum = { ...this.drum, sync: isOn(v) }),
    };
    actions[cc]?.();
  }

  #select(slot) {
    this.#lastSelect = { at: Date.now(), previous: this.buffer };
    this.current = slot;
    this.buffer = this.slots[slot].body.slice();
    this.modified = false;
  }
  #prst() {
    return rebuildPrst(this.slots[this.current].name, this.buffer, this.device);
  }
  #setBuffer(prst) {
    this.buffer = bodyOf(prst);
  }
  /** Live edit of the active buffer (applyEdits syntax); marks it modified. */
  #edit(edits) {
    this.#setBuffer(applyEdits(this.#prst(), edits));
    this.modified = true;
  }
  #setMask(k, on) {
    this.#edit({ blocks: { [k]: { enabled: on } } });
  }
  #notifySlot() {
    this.#reply(this.gp50 ? [KIND.GET, READ.CURRENT_SLOT, this.current & 0xff, this.current >> 8] : [KIND.GET, READ.CURRENT_SLOT, this.current, 0, 0, 0]);
  }
  /** GP-50 "list changed" notification (12 1B 02 presets / 03 SnapTones / 04 User IRs), behind notifyListChanges. */
  #notifyList(code) {
    if (this.gp50 && this.notifyListChanges) this.#reply([KIND.GET, NOTIFY_LIST_CHANGED, code, 0, 0, 0]);
  }
  #paramEcho(block, index, value) {
    this.#reply([KIND.SET, CMD.SET_PARAM, ...u32le(block), ...u32le(index), ...f32le(value)]);
  }

  #handle(p) {
    this.log.push(p);
    const [kind, fn] = p;
    if (kind === KIND.GET) return this.#read(p);
    if (kind !== KIND.SET) return;
    const handler = this.gp50 ? (this.#gp50Commands[fn] ?? this.#commands[fn]) : this.#commands[fn];
    handler?.(p);
  }

  // Commands both models answer the same way (the GP-5 behaviour, hardware-verified there).
  #commands = {
    [CMD.SELECT_PRESET]: (p) => {
      this.#select(readU32(p, 2));
      if (this.gp50 && this.notifySelect) this.#notifySlot();
    },
    [CMD.SET_MODEL]: (p) => this.#edit({ blocks: { [readU32(p, 2)]: { fxid: readU32(p, 10) } } }),
    [CMD.SET_PARAM]: (p) => this.#setParam(readU32(p, 2), readU32(p, 6), new DataView(p.buffer, p.byteOffset + 10, 4).getFloat32(0, true)),
    [CMD.SET_BLOCK]: (p) => this.#setMask(readU32(p, 2), readU32(p, 6) !== 0),
    [CMD.SET_PATCH_SETTING]: (p) => {
      if (p[2] === 1) this.#edit({ volume: p[6] });
    },
    [CMD.SET_GLOBAL]: (p) => {
      const r = this.globalRecords.find(([a, b]) => a === p[2] && b === p[3]);
      if (r) r[3] = p[6] & 0x80 ? p[6] - 256 : p[6];
    },
    [CMD.SAVE_PRESET]: (p) => {
      const slot = readU32(p, 2);
      this.slots[slot] = { name: String.fromCharCode(...p.subarray(6, 16).filter((c) => c)), body: this.buffer.slice() };
      if (slot === this.current) this.modified = false;
      this.#notifyList(2);
    },
    [CMD.IMPORT_USER_IR]: (p) => {
      // The pedal's reaction to an occupied slot or a malformed block is unknown; only a clean import is modelled.
      const up = decodeImportUserIr(p);
      if (!up) return;
      this.userIRs[up.slot] = { name: up.name, flag: 0 };
      this.userIrFiles.set(up.slot, up.data);
      this.#notifyList(4);
    },
    [CMD.RENAME_PRESET]: (p) => {
      this.slots[readU32(p, 2)].name = String.fromCharCode(...p.subarray(6, 16).filter((c) => c));
      this.#notifyList(2);
    },
    [CMD.WRITE_PRESET]: (p) => {
      const slot = p[2];
      const rest = p.subarray(6); // name(16) + body
      this.slots[slot] = { name: String.fromCharCode(...rest.subarray(0, 16).filter((c) => c)), body: rest.slice(16) };
      if (slot === this.current) this.buffer = this.slots[slot].body.slice();
      this.#notifyList(2);
    },
    [CMD.IMPORT_SNAPTONE]: (p) => {
      // Stored only when well-formed; the pedal's reaction to a bad file is unknown, so nothing else is modelled.
      const up = decodeImportSnapTone(p);
      if (!up || !isUserSnapToneSlot(up.slot) || checkSnapToneFile(up.file)) return;
      this.snapTones[up.slot] = { name: up.name, flag: 0 };
      this.snapToneFiles.set(up.slot, up.file);
      this.#notifyList(3);
    },
  };

  // GP-50 commands (Valeton Suite 2.1.0 RE); they replace or extend #commands on the GP-50 profile.
  #gp50Commands = {
    [CMD.SET_PATCH_SETTING]: (p) => {
      const hit = patchSettingByRecord(readU32(p, 2));
      if (!hit) return this.rejected.push({ payload: p.slice(), reason: "unknown patch setting record" });
      const [field] = hit;
      const value = readI32(p, 6);
      try {
        this.#edit(field === "volume" || field === "bpm" ? { [field]: value } : { exp: { [field]: value } });
      } catch (e) {
        return this.rejected.push({ payload: p.slice(), reason: e.message });
      }
      if (this.echoHostEdits) this.#settingEcho(field);
    },
    [CMD.SET_GLOBAL]: (p) => {
      if (!this.#setGlobalValue(p[2], p[3], readI32(p, 6))) this.rejected.push({ payload: p.slice(), reason: "unknown global record" });
    },
    [CMD.SET_FOOTSWITCH]: (p) => {
      const fs1 = blocksOfMask(readU32(p, 2));
      const fs2 = blocksOfMask(readU32(p, 6));
      const err = p.length === 10 ? validateFootswitches(fs1, fs2) : "footswitch payload is not two u32 masks";
      if (err) return this.rejected.push({ payload: p.slice(), reason: err });
      this.#edit({ footswitches: { fs1, fs2 } });
    },
    [CMD.SET_ORDER]: (p) => {
      const order = Array.from(p.subarray(2, 12));
      const err = p.length === 12 ? validateOrder(order) : "order payload is not 10 bytes";
      if (err) return this.rejected.push({ payload: p.slice(), reason: err });
      this.#edit({ order });
    },
    [CMD.DELETE_PRESET]: (p) => {
      const slot = readU32(p, 2);
      this.slots[slot] = { name: DEVICES.gp50.emptyName, body: bodyOf(blankGp50Prst()) };
      if (slot === this.current) this.#select(slot);
      this.#notifyList(2);
    },
    [CMD.PASTE_PRESET]: (p) => {
      const slot = p[2] | (p[3] << 8);
      const from = p[4] | (p[5] << 8);
      this.slots[slot] = { name: this.slots[from].name, body: this.slots[from].body.slice() };
      this.#notifyList(2);
    },
    [CMD.MOVE_PRESET]: (p) => {
      const from = readU32(p, 2);
      const to = readU32(p, 6);
      if (from >= PRESET_COUNT || to >= PRESET_COUNT) return this.rejected.push({ payload: p.slice(), reason: "preset id out of range" });
      const slots = [...this.slots];
      const [moved] = slots.splice(from, 1);
      slots.splice(to, 0, moved);
      this.slots = slots;
      this.#notifyList(2);
    },
  };

  /** Param edit; on a GP-50 a Sync toggle also resets the bound Time/Rate (1/4 on, default off) and echoes it. */
  #setParam(block, index, value) {
    this.#edit({ blocks: { [block]: { params: { [index]: value } } } });
    if (!this.gp50) return;
    const model = modelByFxid(parsePrst(this.#prst()).blocks[block].fxid, "gp50");
    const toggle = model?.params.find((x) => x.index === index && x.syncs !== undefined);
    if (!toggle) return;
    const bound = model.params.find((x) => x.index === toggle.syncs);
    const reset = value >= 0.5 ? SYNC_ON_DIVISION : bound.default;
    this.#edit({ blocks: { [block]: { params: { [bound.index]: reset } } } });
    this.#paramEcho(block, bound.index, reset);
  }

  /** 0x42 echo [u16 record][u16 size][value] of the current value of `field`. */
  #settingEcho(field) {
    const { settings } = parsePrst(this.#prst());
    const s = PATCH_SETTINGS[field];
    const value = Number(field === "volume" || field === "bpm" ? settings[field] : settings.exp[field]);
    const size = SETTING_SIZES.gp50[s.id];
    this.#reply([KIND.SET, CMD.SET_PATCH_SETTING, s.record & 0xff, s.record >> 8, size, 0, ...u32le(value).slice(0, size)]);
  }

  #globalValue(a, b) {
    return this.globalRecords.find((r) => r[0] === a && r[1] === b)?.[3];
  }
  /** Set a GP-50 global record (int32) and push it like the pedal (11 11 a b 04 00 value). false when unknown. */
  #setGlobalValue(a, b, value) {
    const r = this.globalRecords.find((x) => x[0] === a && x[1] === b);
    if (!r) return false;
    r[3] = value;
    if (this.echoHostEdits) this.#reply([KIND.SET, CMD.SET_GLOBAL, a, b, 4, 0, ...u32le(value)]);
    return true;
  }

  #read(p) {
    const sel = p[1];
    switch (sel) {
      case READ.PRESET_NAMES:
        return this.#reply([KIND.GET, sel, ...this.slots.flatMap((s, i) => [...u32le(i), ...nameBytes(s.name, 16)])]);
      case READ.CURRENT_PATCH:
        return this.#reply([KIND.GET, sel, ...this.#currentBody()]);
      case READ.CURRENT_SLOT:
        return this.#reply([KIND.GET, sel, this.current & 0xff, this.current >> 8]);
      case READ.SNAPTONES:
      case READ.USER_IRS: {
        const t = sel === READ.SNAPTONES ? this.snapTones : this.userIRs;
        return this.#reply([KIND.GET, sel, ...t.map((x) => x.flag), ...t.flatMap((x) => nameBytes(x.name, 16))]);
      }
      case READ.GLOBALS:
        return this.#reply([KIND.GET, sel, ...this.globalRecords.flatMap(([a, b, len, v]) => [a, b, len, 0, ...u32le(v).slice(0, len)])]);
      case READ.MODIFIED:
        if (this.gp50) this.#reply([KIND.GET, sel, this.modified ? 1 : 0]);
        return;
      case READ.EXPORT_PRESET: {
        const s = this.gp50 && p.length >= 6 ? this.slots[readU32(p, 2)] : undefined;
        if (s) this.#reply([KIND.GET, sel, 0xff, 0xff, 0xff, 0xff, ...nameBytes(s.name, 16), ...s.body]);
        return;
      }
    }
  }

  /** The 0x41 body; on a GP-50 a read within selectRaceMs of a select returns old/new halves merged (hardware). */
  #currentBody() {
    const { at, previous } = this.#lastSelect;
    if (!this.gp50 || !this.selectRaceMs || !previous || Date.now() - at >= this.selectRaceMs) return this.buffer;
    const half = this.buffer.length >> 1;
    return Uint8Array.from([...previous.subarray(0, half), ...this.buffer.subarray(half)]);
  }

  // ---- helpers for tests / demos: simulate hardware interaction (device-originated messages)

  /** Footswitch/knob on the pedal: switch preset and notify like the real unit (GP-5 12 43 u32, GP-50 12 43 s16). */
  pressPreset(slot) {
    this.#select(slot);
    this.#notifySlot();
  }
  /** Knob turn on the pedal -> param notification. */
  turnKnob(block, index, value) {
    this.#setBuffer(applyEdits(this.#prst(), { blocks: { [block]: { params: { [index]: value } } } }));
    this.#paramEcho(block, index, value);
  }

  /**
   * GP-50 footswitch "A" | "B" | "AB": A+B toggles the tuner, a long A taps tempo; otherwise Patch mode steps the
   * preset (A down, B up) and Stomp mode toggles the switch's blocks (all on unless all are on), with 0x49 echoes.
   */
  pressFootswitch(which, { long = false } = {}) {
    if (!this.gp50) throw new Error("pressFootswitch simulates the GP-50 footswitches");
    if (which === "AB") return void (this.tuner = !this.tuner);
    if (which === "A" && long) return this.tap();
    if (which !== "A" && which !== "B") throw new RangeError(`footswitch must be "A", "B" or "AB", got ${which}`);
    if (this.#globalValue(1, 6) === 1) return this.#toggleFootswitchBlocks(which === "A" ? 0 : 1);
    this.pressPreset((this.current + (which === "A" ? PRESET_COUNT - 1 : 1)) % PRESET_COUNT);
  }

  /** Stomp-mode switch of FS1 (0) / FS2 (1): turn its blocks all on, or all off when all are on. */
  #toggleFootswitchBlocks(fs) {
    if (this.#globalValue(1, 6) !== 1) return;
    const p = parsePrst(this.#prst());
    const list = fs === 0 ? p.footswitches.fs1 : p.footswitches.fs2;
    if (!list.length) return;
    const on = !list.every((k) => p.blocks[k].enabled);
    this.#edit({ blocks: Object.fromEntries(list.map((k) => [k, { enabled: on }])) });
    for (const k of list) this.#reply([KIND.SET, CMD.SET_BLOCK, ...u32le(k), ...u32le(on ? 1 : 0)]);
  }

  /** Tap tempo on the pedal: 60000 / interval of the last two taps, 40..260 BPM, echoed as a 0x42 BPM record. */
  tap(now = Date.now()) {
    const last = this.#taps.at(-1);
    this.#taps = last !== undefined && now - last <= TAP_RESET_MS ? [last, now] : [now];
    if (this.#taps.length < 2) return;
    this.#edit({ bpm: Math.round(60000 / (now - last)) });
    this.#settingEcho("bpm");
  }

  /**
   * GP-50 EXP pedal at `position` 0..100. With EXP on: target VOL scales expVolume between volMin..volMax; any other
   * target sets its param between paramMin..paramMax % of the param range and echoes it as 0x48.
   */
  setExp(position) {
    if (!this.gp50) throw new Error("setExp simulates the GP-50 EXP pedal");
    this.expPosition = clamp(position, 0, 100);
    const p = parsePrst(this.#prst());
    const exp = p.settings.exp;
    if (!exp.on) return;
    const lerp = (lo, hi) => lo + ((hi - lo) * this.expPosition) / 100;
    const block = expTargetBlock(exp.targetModule);
    if (block === null) return void (this.expVolume = lerp(exp.volMin, exp.volMax));
    const param = modelByFxid(p.blocks[block].fxid, "gp50")?.params[exp.targetParam];
    if (!param) return;
    const value = param.min + ((param.max - param.min) * lerp(exp.paramMin, exp.paramMax)) / 100;
    this.#edit({ blocks: { [block]: { params: { [param.index]: value } } } });
    this.#paramEcho(block, param.index, value);
  }
}

/** GP-50 0x10 records [a, b, len 4, value] for `firmware`. */
function gp50Globals(firmware) {
  const rows = [[1, 1, GP50_FIRMWARE[firmware]], ...GP50_GLOBALS, ...(firmware === "1.1.0" ? GP50_110_GLOBALS : [])];
  return rows.map(([a, b, v]) => [a, b, 4, v]);
}

export { BODY_OFF };
