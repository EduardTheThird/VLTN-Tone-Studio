// Valeton GP-5 / GP-50 USB-MIDI SysEx protocol codec. Pure, isomorphic ESM (browser + Node >= 18), zero dependencies.
// Both pedals speak the same protocol (valeton-gp50 read/wrote a GP-50 with it); they differ in the preset size
// (0x41 body 466 vs 511 bytes, write 26 vs 29 frames), USB PID and the effect catalog (see prst.mjs, catalog.mjs).
//
// Wire format (identical host->device and device->host):
//   BUF  = [crc, total, index, len, ...payload]        payload <= 19 bytes per frame on USB
//   crc  = CRC-8 (poly 0x07, init 0x00, no reflection, no xorout) over BUF[1..]
//   wire = F0, (b >> 4, b & 0x0F) for every b in BUF, F7  -- every byte split into two nibbles, high first.
//   total = number of frames in the transfer (ceil(len(payload)/19)), index = 0..total-1.
// Payload: [kind, fn, ...args]. kind 0x12 = read/query (and read replies), 0x11 = set/command, 0x14 = device ACK.
// All integers little-endian u32, parameter values float32 LE.
//
// Sources (see skill gp5-sysex-protocol for per-fact evidence): drewmerc302/valeton-gp50 (MIT),
// fsanchezlme97-ui/gp5-editor (MIT), helvecioneto/gp5-wc (Apache-2.0), Builty/TonexOneController (Apache-2.0).

export const USB_IDS = Object.freeze({ vendorId: 0x84ef, gp5: 0x0184, gp50: 0x018a, midiInterface: 3 });

/** Storage/block order used everywhere: bypass bit k, model record k, params k*8.., live-edit block index k. */
export const BLOCKS = Object.freeze(["NR", "PRE", "DST", "AMP", "CAB", "EQ", "MOD", "DLY", "RVB", "NS"]);
export const BLOCK = Object.freeze(Object.fromEntries(BLOCKS.map((b, i) => [b, i])));

export const PRESET_COUNT = 100;
export const FRAME_PAYLOAD_MAX = 19;
export const KIND = Object.freeze({ SET: 0x11, GET: 0x12, ACK: 0x14 });

/** Read selectors: request payload [0x12, sel, ...args]; reply payload starts with the same two bytes. */
export const READ = Object.freeze({
  GLOBALS: 0x10,
  USER_IRS: 0x20,
  SNAPTONES: 0x24,
  PRESET_NAMES: 0x40,
  CURRENT_PATCH: 0x41,
  CURRENT_SLOT: 0x43,
  MODIFIED: 0x45, // GP-50: 1-byte "active preset edited" flag; Suite reads it at every GP-50 connect
  EXPORT_PRESET: 0x4f, // GP-50: [0x12, 0x4f, u32 slot] -> FF FF FF FF | name16 | body (531 B)
});

/** Command function codes (payload [0x11, fn, ...]). GP-50 only: SET_ORDER, DELETE/PASTE/MOVE_PRESET, the 8-byte SET_FOOTSWITCH. */
export const CMD = Object.freeze({
  SET_GLOBAL: 0x11,
  IMPORT_USER_IR: 0x21, // User IR (cab WAV) upload (lib/userir.mjs)
  IMPORT_SNAPTONE: 0x25, // SnapTone file upload (lib/snaptone.mjs)
  SET_PATCH_SETTING: 0x42,
  SELECT_PRESET: 0x43,
  SET_ORDER: 0x44,
  DELETE_PRESET: 0x46,
  SET_MODEL: 0x47,
  SET_PARAM: 0x48,
  SET_BLOCK: 0x49,
  SAVE_PRESET: 0x4a,
  PASTE_PRESET: 0x4b,
  RENAME_PRESET: 0x4c,
  SET_FOOTSWITCH: 0x4d,
  WRITE_PRESET: 0x4f,
  MOVE_PRESET: 0x5a,
});

/** Device -> host only: "a list changed" (data[0]: 1 preset, 2 preset names, 3 SnapTone names, 4 User IR names). */
export const NOTIFY_LIST_CHANGED = 0x1b;
const LIST_CHANGED = Object.freeze({ 2: "presets", 3: "snaptones", 4: "irs" });

/**
 * Functions this toolkit never sends and the simulator never answers: 0x1C (unknown, wedges pedals), 0x31 BLE rename,
 * 0x33 language activation, 0x3F factory reset, 0x53 song list, 0x60..0x6E firmware update.
 */
export const isForbiddenFn = (fn) => [0x1c, 0x31, 0x33, 0x3f, 0x53].includes(fn) || (fn >= 0x60 && fn <= 0x6e);

// ---------------------------------------------------------------------------------------------------------------
// per-device tables: global settings, patch settings, MIDI CCs

const OFF_ON = ["Off", "On"];
const FS_FUNCTIONS = ["None", "Patch +", "Patch -", "Tap tempo", "Tuner", "Looper", "Drum machine", "Drum +", "Drum -"];
/** 0 = Omni (INF from the GP-50 menu; Suite's label list was not recovered), 1..16 = channel. */
const MIDI_CHANNELS = ["Omni", ...Array.from({ length: 16 }, (_, i) => String(i + 1))];
const level = (label, addr, group) => ({ label, addr, kind: "number", min: -20, max: 20, unit: "dB", group });
const percent = (label, addr, group) => ({ label, addr, kind: "number", min: 0, max: 100, group });
const choice = (label, addr, labels, group, extra = {}) => ({ label, addr, kind: "enum", min: 0, max: labels.length - 1, labels, group, ...extra });
const globalsTable = (entries) =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(entries).map(([name, g]) => [name, Object.freeze({ name, ...g, addr: Object.freeze(g.addr), ...(g.labels ? { labels: Object.freeze(g.labels) } : {}) })])
    )
  );

/**
 * GP-5 global settings, addressed by record id [a, b] (CMD.SET_GLOBAL and the 0x10 reply records).
 * Addresses/ranges from TonexOneController; record layout of the 0x10 reply verified on a real GP-5.
 * Entry: { name, label, addr: [a, b], kind: "number" | "enum", min, max, unit?, labels? (enum: labels[value]),
 * group: "audio" | "recording" | "controls" | "midi" | "display" | "power", since? (firmware that added it) }.
 */
export const GLOBALS = globalsTable({
  inputTrim: level("Input level", [1, 3], "audio"),
  masterVolume: percent("Master volume", [2, 2], "audio"),
  cabSimBypass: choice("Cab sim bypass", [3, 3], OFF_ON, "audio"),
  recordLevel: level("Recording level", [1, 4], "recording"),
  monitorLevel: level("Monitor level", [2, 4], "audio"),
  btLevel: level("Bluetooth level", [5, 4], "audio"),
});

/**
 * GP-50 global settings (Valeton Suite 2.1.0 RE, skill valeton-gp50 reference.md §5). The record ids differ from the
 * GP-5: (2,4) is BT REC, (3,4) the monitor, (4,4)/(5,4) REC mode L/R. Entries with `since` exist from that firmware on;
 * a UI should show only the entries the pedal reports in its 0x10 reply.
 */
export const GLOBALS_GP50 = globalsTable({
  masterVolume: percent("Master volume", [2, 2], "audio"),
  inputTrim: level("Input level", [1, 3], "audio"),
  monitorLevel: level("Monitor level", [3, 4], "audio"),
  cabSimBypass: choice("No-CAB mode", [3, 3], OFF_ON, "audio"),
  autoCabMatch: choice("Auto CAB match", [1, 11], OFF_ON, "audio"),
  bypassMode: choice("Bypass mode", [2, 6], ["Analog", "DSP"], "audio"),
  recordLevel: level("USB recording level", [1, 4], "recording"),
  btRecordLevel: level("Bluetooth recording level", [2, 4], "recording"),
  recModeLeft: choice("Recording mode, left", [4, 4], ["Dry", "Wet"], "recording"),
  recModeRight: choice("Recording mode, right", [5, 4], ["Dry", "Wet"], "recording"),
  footswitchMode: choice("Footswitch mode", [1, 6], ["Patch", "Stomp"], "controls"),
  expJack: choice("EXP/FS jack", [1, 5], ["Expression pedal", "Single footswitch", "Dual footswitch"], "controls"),
  fs3Function: choice("FS3 function", [5, 5], FS_FUNCTIONS, "controls"),
  fs4Function: choice("FS4 function", [6, 5], FS_FUNCTIONS, "controls"),
  midiInSource: choice("MIDI input", [1, 10], ["TRS", "USB", "Bluetooth", "All"], "midi"),
  midiChannelTrs: choice("MIDI channel (TRS)", [2, 10], MIDI_CHANNELS, "midi"),
  midiChannelUsb: choice("MIDI channel (USB)", [3, 10], MIDI_CHANNELS, "midi"),
  midiChannelBt: choice("MIDI channel (Bluetooth)", [4, 10], MIDI_CHANNELS, "midi", { since: "1.1.0" }),
  displayTime: choice("Display timeout", [1, 9], ["Always on", "5 min", "30 min"], "display"),
  displayBrightness: choice("Display brightness", [2, 9], ["I", "II", "III"], "display"),
  dcUnplug: choice("When 9 V DC is unplugged", [1, 13], ["Stay on", "Power off"], "power", { since: "1.1.0" }),
});

const GLOBAL_TABLES = Object.freeze({ gp5: GLOBALS, gp50: GLOBALS_GP50 });

/** Global settings table of `device` ("gp5" | "gp50"). */
export function globalsFor(device) {
  const t = GLOBAL_TABLES[device];
  if (!t) throw new RangeError(`unknown device ${JSON.stringify(device)}; expected "gp5" or "gp50"`);
  return t;
}

/**
 * Patch settings of the active preset, sent with CMD.SET_PATCH_SETTING [u32 record][u32 value]. record = the header
 * of the .prst settings TLV entry (id | 0x20 << 8), so `id` is also the TLV id inside record 0x0001.
 * VOL and BPM exist on both pedals; the EXP fields only on the GP-50 (`gp50Only`).
 * EXP target modules use the CC48..57 order (EXP_TARGETS), not the storage order of BLOCKS.
 */
export const PATCH_SETTINGS = Object.freeze({
  volume: Object.freeze({ id: 1, record: 0x2001, min: 0, max: 100 }),
  bpm: Object.freeze({ id: 2, record: 0x2002, min: 40, max: 260 }),
  on: Object.freeze({ id: 3, record: 0x2003, min: 0, max: 1, gp50Only: true }),
  paramMin: Object.freeze({ id: 4, record: 0x2004, min: 0, max: 100, gp50Only: true }),
  paramMax: Object.freeze({ id: 5, record: 0x2005, min: 0, max: 100, gp50Only: true }),
  volPosition: Object.freeze({ id: 6, record: 0x2006, min: 0, max: 1, gp50Only: true }),
  volMin: Object.freeze({ id: 7, record: 0x2007, min: 0, max: 100, gp50Only: true }),
  volMax: Object.freeze({ id: 8, record: 0x2008, min: 0, max: 100, gp50Only: true }),
  targetModule: Object.freeze({ id: 9, record: 0x2009, min: 0, max: 10, gp50Only: true }),
  targetParam: Object.freeze({ id: 10, record: 0x200a, min: 0, max: 7, gp50Only: true }),
});
/** EXP field names in record order (the `exp` object of parsePrst / applyEdits / Gp5Session.setExp). */
export const EXP_FIELDS = Object.freeze(["on", "paramMin", "paramMax", "volPosition", "volMin", "volMax", "targetModule", "targetParam"]);
/** EXP target module index -> name (0 = the EXP volume, which uses volPosition/volMin/volMax; 1..10 a block). */
export const EXP_TARGETS = Object.freeze(["VOL", "NR", "PRE", "DST", "NS", "AMP", "CAB", "EQ", "MOD", "DLY", "RVB"]);

/** Storage block index (BLOCKS) of an EXP target module, or null for 0 (EXP volume). */
export function expTargetBlock(module) {
  if (!Number.isInteger(module) || module < 0 || module >= EXP_TARGETS.length) throw new RangeError(`EXP target module must be 0..10, got ${module}`);
  return module === 0 ? null : BLOCK[EXP_TARGETS[module]];
}

/** [field, entry] of PATCH_SETTINGS for a 0x42 record id, or undefined. */
export const patchSettingByRecord = (record) => Object.entries(PATCH_SETTINGS).find(([, s]) => s.record === record);

/** Check one PATCH_SETTINGS value (a boolean counts as 0/1); returns the integer to send / store. */
export function patchSettingValue(field, value) {
  const s = PATCH_SETTINGS[field];
  if (!s) throw new RangeError(`unknown patch setting ${field}`);
  const v = typeof value === "boolean" ? Number(value) : value;
  if (!Number.isInteger(v) || v < s.min || v > s.max) throw new RangeError(`${field} must be an integer ${s.min}..${s.max}, got ${value}`);
  return v;
}

/**
 * GP-5 standard MIDI CC map (channel 1). Block switches: 0-63 off, 64-127 on. Bank -/+ (22/23) and song patch -/+
 * (29/30) exist only on the GP-5.
 */
export const CC = Object.freeze({
  PRESET_SELECT: 0,
  PATCH_VOLUME: 7,
  BANK_DOWN: 22,
  BANK_UP: 23,
  PATCH_DOWN: 24,
  PATCH_UP: 25,
  SONG_PATCH_DOWN: 29,
  SONG_PATCH_UP: 30,
  TUNER: 58,
  CTL: 69,
  BLOCK_SWITCH: Object.freeze({ NR: 48, PRE: 49, DST: 50, NS: 51, AMP: 52, CAB: 53, EQ: 54, MOD: 55, DLY: 56, RVB: 57 }),
});

/**
 * GP-50 MIDI CC chart (manual FW 1.0.5 p.52-53; the firmware's CC handler names agree). Steps (17, 19, 21):
 * 0-63 = -1, 64-127 = +1. Tempo = 128 * CC73 + CC74. UNIT_MODE: 0-63 Patch, 64-127 Stomp.
 */
export const CC_GP50 = Object.freeze({
  PRESET_SELECT: 0,
  MASTER_VOLUME: 1,
  PATCH_VOLUME: 7,
  EXP_VALUE: 11,
  EXP_SWITCH: 13,
  MASTER_VOLUME_STEP: 17,
  BPM_STEP: 19,
  PATCH_VOLUME_STEP: 21,
  PATCH_DOWN: 24,
  PATCH_UP: 25,
  UNIT_MODE: 28,
  TUNER: 58,
  LOOPER: 59,
  LOOPER_RECORD: 60,
  LOOPER_PLAY: 62,
  LOOPER_DELETE: 65,
  LOOPER_RECORD_VOLUME: 66,
  LOOPER_PLAY_VOLUME: 67,
  CTL: 69,
  CTL2: 70,
  TEMPO_MSB: 73,
  TEMPO_LSB: 74,
  TAP: 75,
  DRUM_MENU: 92,
  DRUM_PLAY: 93,
  DRUM_TYPE: 94,
  DRUM_VOLUME: 95,
  DRUM_SYNC: 96,
  BLOCK_SWITCH: CC.BLOCK_SWITCH,
});

const CC_TABLES = Object.freeze({ gp5: CC, gp50: CC_GP50 });

/** MIDI CC table of `device` ("gp5" | "gp50"). */
export function ccFor(device) {
  const t = CC_TABLES[device];
  if (!t) throw new RangeError(`unknown device ${JSON.stringify(device)}; expected "gp5" or "gp50"`);
  return t;
}

// ---------------------------------------------------------------------------------------------------------------
// byte helpers

const toBytes = (b) => (b instanceof Uint8Array ? b : Uint8Array.from(b));
export const u32le = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const u16le = (v) => [v & 0xff, (v >>> 8) & 0xff];
export const f32le = (v) => {
  const d = new DataView(new ArrayBuffer(4));
  d.setFloat32(0, v, true);
  return [d.getUint8(0), d.getUint8(1), d.getUint8(2), d.getUint8(3)];
};
const readU32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const readF32 = (b, o) => new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, true);
const readI8 = (v) => (v & 0x80 ? v - 0x100 : v);
const readS16 = (b, o) => ((b[o] | (b[o + 1] << 8)) << 16) >> 16;
const readI32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
/** Block index list (0..9, no repeats) -> bit mask; and back. */
export function blockMask(blocks) {
  if (!Array.isArray(blocks) || new Set(blocks).size !== blocks.length || blocks.some((k) => !Number.isInteger(k) || k < 0 || k > 9))
    throw new RangeError(`block list must hold distinct block indices 0..9, got ${JSON.stringify(blocks)}`);
  return blocks.reduce((m, k) => m | (1 << k), 0) >>> 0;
}
export const blocksOfMask = (mask) => BLOCKS.flatMap((_, k) => (mask & (1 << k) ? [k] : []));
const latin1 = (b) => {
  let s = "";
  for (const c of b) {
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
};
function asciiField(name, len) {
  const out = new Array(len).fill(0);
  const s = String(name);
  for (let i = 0; i < Math.min(len, s.length); i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) throw new RangeError(`preset name must be printable ASCII, got ${JSON.stringify(s)}`);
    out[i] = c;
  }
  return out;
}
export const toHex = (b, sep = " ") => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(sep);
export const fromHex = (s) => Uint8Array.from(s.replace(/[^0-9a-f]/gi, "").match(/../g) ?? [], (h) => parseInt(h, 16));

function assertSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PRESET_COUNT) throw new RangeError(`preset slot must be 0..99, got ${slot}`);
}
function blockIndex(block) {
  const k = typeof block === "string" ? BLOCK[block.toUpperCase()] : block;
  if (!Number.isInteger(k) || k < 0 || k > 9) throw new RangeError(`unknown block ${block}`);
  return k;
}

// ---------------------------------------------------------------------------------------------------------------
// framing

/** CRC-8/SMBUS (poly 0x07, init 0). crc8("123456789") === 0xF4. */
export function crc8(bytes) {
  let c = 0;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
}

/** Build one frame (BUF with CRC filled in). */
export function buildFrame(total, index, payload) {
  if (payload.length > 0xff) throw new RangeError("frame payload too long");
  const buf = [0, total & 0xff, index & 0xff, payload.length, ...payload];
  buf[0] = crc8(buf.slice(1));
  return Uint8Array.from(buf);
}

/** BUF -> SysEx wire bytes (F0, nibbles, F7). */
export function frameToSysex(buf) {
  const out = new Uint8Array(buf.length * 2 + 2);
  out[0] = 0xf0;
  for (let i = 0; i < buf.length; i++) {
    out[1 + i * 2] = buf[i] >> 4;
    out[2 + i * 2] = buf[i] & 0x0f;
  }
  out[out.length - 1] = 0xf7;
  return out;
}

/** Split a logical payload into SysEx messages ready to send (19-byte frames, total = frame count). */
export function packetize(payload, chunk = FRAME_PAYLOAD_MAX) {
  const p = toBytes(payload);
  const total = Math.max(1, Math.ceil(p.length / chunk));
  if (total > 0xff) throw new RangeError("payload needs more than 255 frames");
  const out = [];
  for (let i = 0; i < total; i++) out.push(frameToSysex(buildFrame(total, i, p.subarray(i * chunk, (i + 1) * chunk))));
  return out;
}

/**
 * Decode one SysEx message (with or without F0/F7) into a frame.
 * Returns null when it is not a Valeton nibble frame (odd nibble count, nibble > 0x0F, too short).
 */
export function parseSysex(msg) {
  const m = toBytes(msg);
  let a = 0;
  let z = m.length;
  if (m[0] === 0xf0) a = 1;
  if (m[z - 1] === 0xf7) z -= 1;
  const n = z - a;
  if (n < 8 || n % 2) return null;
  const buf = new Uint8Array(n / 2);
  for (let i = 0; i < buf.length; i++) {
    const hi = m[a + 2 * i];
    const lo = m[a + 2 * i + 1];
    if (hi > 0x0f || lo > 0x0f) return null;
    buf[i] = (hi << 4) | lo;
  }
  const [crc, total, index, len] = buf;
  const payload = buf.subarray(4);
  return { crc, crcOk: crc === crc8(buf.subarray(1)), total, index, len, lenOk: len === payload.length, payload };
}

/**
 * Reassembles multi-frame transfers. Frames are grouped by `total`, ordered by `index`.
 * push() returns the complete payload (Uint8Array) when the last missing frame arrives, else null.
 */
export class Reassembler {
  #pending = new Map();
  push(frame) {
    if (frame.total <= 1) return frame.payload.slice();
    let t = this.#pending.get(frame.total);
    if (!t || (frame.index === 0 && t.parts[0])) {
      t = { parts: new Array(frame.total), have: 0 };
      this.#pending.set(frame.total, t);
    }
    if (frame.index >= frame.total) return null;
    if (!t.parts[frame.index]) t.have++;
    t.parts[frame.index] = frame.payload.slice();
    if (t.have < frame.total) return null;
    this.#pending.delete(frame.total);
    const len = t.parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of t.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
  reset() {
    this.#pending.clear();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// request / command payloads (logical, unframed). Send with packetize(payload).

export const encode = Object.freeze({
  /** Read request. sel = READ.* */
  read: (sel) => [KIND.GET, sel],
  /** Select preset via SysEx (gp5-editor: works on GP-5; TonexOneController saw occasional lockups -> prefer CC#0). */
  selectPreset: (slot) => (assertSlot(slot), [KIND.SET, CMD.SELECT_PRESET, ...u32le(slot)]),
  /** Swap the model in a block. fxid = u32 from the effects catalog (category << 24 | model). */
  setModel: (block, fxid) => {
    const k = blockIndex(block);
    return [KIND.SET, CMD.SET_MODEL, ...u32le(k), ...u32le(k), ...u32le(fxid >>> 0)];
  },
  /** Set one parameter. paramIndex = catalog algId (0..7; NS uses 0..4). value in display units. */
  setParam: (block, paramIndex, value) => {
    if (!Number.isInteger(paramIndex) || paramIndex < 0 || paramIndex > 15) throw new RangeError(`bad param index ${paramIndex}`);
    return [KIND.SET, CMD.SET_PARAM, ...u32le(blockIndex(block)), ...u32le(paramIndex), ...f32le(Number(value))];
  },
  /** Block on/off. */
  setBlockEnabled: (block, on) => [KIND.SET, CMD.SET_BLOCK, ...u32le(blockIndex(block)), ...u32le(on ? 1 : 0)],
  /**
   * Patch setting of the active preset (PATCH_SETTINGS): [u32 record][u32 value]. Throws on an unknown record or a
   * value outside its range; the caller decides whether the connected pedal has the record (`gp50Only`).
   */
  setPatchSetting: (record, value) => {
    const hit = patchSettingByRecord(record);
    if (!hit) throw new RangeError(`unknown patch setting record 0x${Number(record).toString(16)}`);
    return [KIND.SET, CMD.SET_PATCH_SETTING, ...u32le(record), ...u32le(patchSettingValue(hit[0], value))];
  },
  /** Current patch volume 0..100 (record 0x2001), clamped. */
  setPatchVolume: (vol) => encode.setPatchSetting(PATCH_SETTINGS.volume.record, Math.max(0, Math.min(100, Math.round(vol)))),
  /**
   * Global setting `name` of `device`'s table (GLOBALS / GLOBALS_GP50), clamped to its range and sent as int32 LE like
   * Valeton Suite (`11 11 a b 00 00 <int32>`; -20 = EC FF FF FF).
   */
  setGlobal: (name, value, device = "gp5") => {
    const table = globalsFor(device);
    const g = table[name];
    if (!g) throw new RangeError(`unknown ${device} global ${name}; known: ${Object.keys(table).join(", ")}`);
    const v = Math.max(g.min, Math.min(g.max, Math.round(value)));
    return [KIND.SET, CMD.SET_GLOBAL, g.addr[0], g.addr[1], 0x00, 0x00, ...u32le(v)];
  },
  /**
   * GP-50 footswitch assignment: [u32 FS1 mask][u32 FS2 mask], bit = storage block index. Check the lists with
   * prst.validateFootswitches first (<= 3 blocks per switch, disjoint). The GP-5's 0x4D has another layout.
   */
  setFootswitchMasks: (fs1, fs2) => [KIND.SET, CMD.SET_FOOTSWITCH, ...u32le(blockMask(fs1)), ...u32le(blockMask(fs2))],
  /** GP-50 chain order: 10 storage block indices. Check with prst.validateOrder first (fixed core). */
  setOrder: (order) => {
    if (!Array.isArray(order) || order.length !== 10 || new Set(order).size !== 10 || order.some((k) => !Number.isInteger(k) || k < 0 || k > 9))
      throw new RangeError("order must be a permutation of the block indices 0..9");
    return [KIND.SET, CMD.SET_ORDER, ...order];
  },
  /** GP-50: reset `slot` to the empty preset. */
  deletePreset: (slot) => (assertSlot(slot), [KIND.SET, CMD.DELETE_PRESET, ...u32le(slot)]),
  /** GP-50: copy preset `fromSlot` onto `slot` ([u16 paste index][u16 copy index]). */
  pastePreset: (slot, fromSlot) => (assertSlot(slot), assertSlot(fromSlot), [KIND.SET, CMD.PASTE_PRESET, ...u16le(slot), ...u16le(fromSlot)]),
  /** GP-50: move the preset with list id `fromId` to `toId` (ids of the 0x40 name list). */
  movePreset: (fromId, toId) => (assertSlot(fromId), assertSlot(toId), [KIND.SET, CMD.MOVE_PRESET, ...u32le(fromId), ...u32le(toId)]),
  /** GP-50 export read of `slot` without selecting it; reply = FF FF FF FF | name16 | body. */
  exportPreset: (slot) => (assertSlot(slot), [KIND.GET, READ.EXPORT_PRESET, ...u32le(slot)]),
  /** Store the current (edited) buffer into `slot` under `name` (max 10 chars). Overwrites the slot. */
  savePreset: (slot, name) => (assertSlot(slot), [KIND.SET, CMD.SAVE_PRESET, ...u32le(slot), ...asciiField(name, 10)]),
  /** Rename a slot (10-char field). Seen in a Valeton Suite capture only. */
  renamePreset: (slot, name) => (assertSlot(slot), [KIND.SET, CMD.RENAME_PRESET, ...u32le(slot), ...asciiField(name, 10)]),
  /**
   * Full preset write: payload for a GP-5 (507 B) or GP-50 (552 B) .prst; bytes 0x19.. = name + body.
   * GP-5: 488 bytes -> 26 frames; GP-50: 533 bytes -> 29 frames (valeton-gp50 Suite capture).
   */
  writePreset: (slot, prst) => {
    assertSlot(slot);
    const p = toBytes(prst);
    if (p.length !== 507 && p.length !== 552) throw new RangeError(`.prst must be 507 (GP-5) or 552 (GP-50) bytes, got ${p.length}`);
    return [KIND.SET, CMD.WRITE_PRESET, slot, 0x00, 0x00, 0x00, ...p.subarray(0x19)];
  },
});

/** Standard MIDI short messages (channel 0 = MIDI channel 1). */
export const midi = Object.freeze({
  cc: (num, value, channel = 0) => [0xb0 | (channel & 0x0f), num & 0x7f, Math.max(0, Math.min(127, Math.round(value)))],
  selectPreset: (slot, channel = 0) => (assertSlot(slot), midi.cc(CC.PRESET_SELECT, slot, channel)),
  /** Select a preset with Program Change (GP-50, hardware-proven; the GP-5 ignores it). */
  programSelect: (slot, channel = 0) => (assertSlot(slot), midi.programChange(slot, channel)),
  patchVolume: (vol, channel = 0) => midi.cc(CC.PATCH_VOLUME, Math.max(0, Math.min(100, vol)), channel),
  blockSwitch: (block, on, channel = 0) => {
    const name = BLOCKS[blockIndex(block)];
    return midi.cc(CC.BLOCK_SWITCH[name], on ? 127 : 0, channel);
  },
  tuner: (on, channel = 0) => midi.cc(CC.TUNER, on ? 127 : 0, channel),
  ctl: (value, channel = 0) => midi.cc(CC.CTL, value, channel),
  programChange: (program, channel = 0) => [0xc0 | (channel & 0x0f), program & 0x7f],
});

// ---------------------------------------------------------------------------------------------------------------
// reply decoders. `data` = reassembled payload INCLUDING the 2-byte [0x12, sel] echo.

function expectReply(data, sel) {
  if (data[0] !== KIND.GET || data[1] !== sel) throw new Error(`expected reply 12 ${sel.toString(16)}, got ${toHex(data.subarray(0, 2))}`);
}

/** 0x40 -> 100 x { slot, id, name }. slot = record position (ids drift after on-pedal reordering). */
export function decodePresetNames(data) {
  expectReply(data, READ.PRESET_NAMES);
  const out = [];
  for (let off = 2, slot = 0; off + 20 <= data.length; off += 20, slot++) {
    out.push({ slot, id: readU32(data, off), name: latin1(data.subarray(off + 4, off + 20)).trim() });
  }
  return out;
}

/** 0x43 -> current preset slot (0..99). Same layout for the unsolicited "slot changed" notification. */
export function decodeCurrentSlot(data) {
  expectReply(data, READ.CURRENT_SLOT);
  return data[2] | ((data[3] ?? 0) << 8);
}

/** 0x41 -> body bytes (== .prst[0x29:]; 466 bytes on GP-5, 511 on GP-50). */
export function decodeCurrentPatch(data) {
  expectReply(data, READ.CURRENT_PATCH);
  return data.slice(2);
}

/**
 * 0x24 (80 SnapTone/amp-capture slots: 0..49 factory, 50..79 user) / 0x20 (20 user IR slots)
 * -> [{ index, name, kind: "user" | "factory" | "empty", flag }].
 * flag byte (verified on hardware): 0 = user-loaded content, 1 = factory or empty ("Empty" / "User IR n").
 */
export function decodeSlotTable(data) {
  const sel = data[1];
  const count = sel === READ.SNAPTONES ? 80 : sel === READ.USER_IRS ? 20 : 0;
  if (data[0] !== KIND.GET || !count) throw new Error(`not a 0x24/0x20 reply: ${toHex(data.subarray(0, 2))}`);
  const names = 2 + count;
  const out = [];
  for (let i = 0; i < count && names + i * 16 + 16 <= data.length; i++) {
    const flag = data[2 + i];
    const name = latin1(data.subarray(names + i * 16, names + i * 16 + 16)).trim();
    const kind = flag === 0 ? "user" : name === "Empty" || /^User IR \d+$/.test(name) ? "empty" : "factory";
    out.push({ index: i, name, kind, flag });
  }
  return out;
}

/** 0x45 (GP-50) -> true when the active preset has unsaved edits. */
export function decodeModified(data) {
  expectReply(data, READ.MODIFIED);
  return data[2] !== 0;
}

/** 0x4F export read (GP-50) -> { name, body }: reply 12 4F | FF FF FF FF | name16 | body. */
export function decodeExportedPreset(data) {
  expectReply(data, READ.EXPORT_PRESET);
  return { name: latin1(data.subarray(6, 22)).trim(), body: data.slice(22) };
}

/** Walk [a][b][u16 len][value LE, sign-extended over len]... starting at `o`. */
function readRecords(data, o) {
  const records = [];
  while (o + 4 <= data.length) {
    const len = data[o + 2] | (data[o + 3] << 8);
    if (o + 4 + len > data.length) break;
    let value = 0;
    for (let i = len - 1; i >= 0; i--) value = value * 256 + data[o + 4 + i];
    if (len === 1) value = readI8(value);
    else if (len === 2) value = (value << 16) >> 16;
    else if (len === 4) value |= 0;
    records.push({ a: data[o], b: data[o + 1], len, value });
    o += 4 + len;
  }
  return records;
}

/**
 * 0x10 -> globals of `device` ("gp5" | "gp50"). The reply is a record list [a][b][u16 len][value LE, len bytes].
 * Returns { records: [{ a, b, len, value }], firmware?: "1.1.0" (record (1,1)), <name>: value for every entry of
 * globalsFor(device) the pedal reported }.
 */
export function decodeGlobals(data, device = "gp5") {
  expectReply(data, READ.GLOBALS);
  const records = readRecords(data, 2);
  const out = { records };
  const fw = records.find((r) => r.a === 1 && r.b === 1 && r.len === 4);
  if (fw) out.firmware = [16, 8, 0].map((shift) => (fw.value >>> shift) & 0xff).join(".");
  for (const [name, g] of Object.entries(globalsFor(device))) {
    const r = records.find((x) => x.a === g.addr[0] && x.b === g.addr[1]);
    if (r) out[name] = r.value;
  }
  return out;
}

/** 0x42 from the device: [u16 record][u16 size][value]... (the host form [u32 record][u32 value] is read as one entry). */
function decodePatchSettings(p) {
  const tlv = [];
  let o = 2;
  while (o + 4 <= p.length) {
    const size = p[o + 2] | (p[o + 3] << 8);
    if (size < 1 || size > 4 || o + 4 + size > p.length) break;
    let value = 0;
    for (let i = size - 1; i >= 0; i--) value = value * 256 + p[o + 4 + i];
    tlv.push({ record: p[o] | (p[o + 1] << 8), value });
    o += 4 + size;
  }
  if (o === p.length && tlv.length) return tlv;
  return p.length === 10 ? [{ record: readU32(p, 2), value: readI32(p, 6) }] : null;
}

/** Device -> host decoders by fn for kind 0x11/0x12 (the pedal's handlers dispatch by fn only). */
const DEVICE_MESSAGES = {
  [CMD.SET_PARAM]: (p) => p.length >= 14 && { type: "param", block: readU32(p, 2), index: readU32(p, 6), value: readF32(p, 10) },
  [CMD.SET_BLOCK]: (p) => p.length >= 10 && { type: "block", block: readU32(p, 2), enabled: readU32(p, 6) !== 0 },
  // GP-5: u32 block, u32 block, u32 fxid; GP-50 echo: s16 block, s16 block, s32 fxid (8 bytes)
  [CMD.SET_MODEL]: (p) =>
    p.length >= 14 ? { type: "model", block: readU32(p, 2), fxid: readU32(p, 10) } : p.length === 10 && { type: "model", block: readS16(p, 2), fxid: readU32(p, 6) },
  [CMD.SET_PATCH_SETTING]: (p) => {
    const settings = decodePatchSettings(p);
    return settings && { type: "patchSetting", settings };
  },
  // 8 bytes = FS1 mask, FS2 mask; 10 bytes = 2 leading bytes + masks (Suite's handler skips them)
  [CMD.SET_FOOTSWITCH]: (p) => {
    const at = p.length === 10 ? 2 : p.length === 12 ? 4 : -1;
    return at > 0 && { type: "footswitch", fs1: blocksOfMask(readU32(p, at)), fs2: blocksOfMask(readU32(p, at + 4)) };
  },
  [CMD.SET_ORDER]: (p) => p.length >= 12 && { type: "order", order: Array.from(p.subarray(2, 12)) },
  // a single global record pushed by the pedal: [a][b][u16 len][value]
  [CMD.SET_GLOBAL]: (p) => {
    const [r] = readRecords(p, 2);
    return r?.len > 0 && { type: "global", a: r.a, b: r.b, value: r.value };
  },
  [NOTIFY_LIST_CHANGED]: (p) => (LIST_CHANGED[p[2]] ? { type: "listChanged", list: LIST_CHANGED[p[2]] } : { type: "presetChanged", kind: p[0], fn: p[1] }),
  0x73: (p) => ({ type: "presetChanged", kind: p[0], fn: p[1] }),
};

/**
 * Classify any complete payload received from the device. Used for unsolicited traffic
 * (knob turns, footswitches, preset changes on the pedal) and for ACKs.
 * 12 1B 02/03/04 -> { type: "listChanged", list: "presets" | "snaptones" | "irs" } (re-read 0x40 / 0x24 / 0x20);
 * 12 1B 01 and 0x73 -> "presetChanged" (GP-5 style).
 */
export function decodeMessage(p) {
  const kind = p[0];
  const fn = p[1];
  if (kind === KIND.ACK) return { type: "ack", kind, fn, raw: p };
  if (kind === KIND.GET && fn === READ.CURRENT_SLOT && p.length >= 3) return { type: "slot", slot: p[2] | ((p[3] ?? 0) << 8), raw: p };
  const decoded = (kind === KIND.SET || kind === KIND.GET) && DEVICE_MESSAGES[fn]?.(p);
  if (decoded) return { ...decoded, raw: p };
  if (kind === KIND.GET) return { type: "reply", sel: fn, raw: p };
  return { type: "unknown", kind, fn, raw: p };
}
