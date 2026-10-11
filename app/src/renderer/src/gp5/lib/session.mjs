// Gp5Session: transport-agnostic, paced, serialized request/response layer for the Valeton GP-5 and GP-50.
// The pedal model is detected from the length of the first 0x41 body (466 B GP-5, 511 B GP-50); see `device`.
// Works with any transport implementing:
//   { name: string, send(bytes: Uint8Array): void, onMessage(cb: (bytes: Uint8Array) => void): void, close(): void|Promise<void> }
// Transports: ./transport-webmidi.mjs (browser/Electron), ./transport-node.mjs (Node), ./mock-device.mjs (tests).
//
// Pacing rules (the pedal has a shallow MIDI input queue and can wedge until power-cycled if flooded):
//  - one request in flight at a time (promise chain), >= 20 ms between outgoing messages,
//  - settle gap after every exchange, never sweep unknown selectors, keep ONE port open for the session,
//  - live edits still waiting in the queue are coalesced per (fn, target): a newer value of the same param, patch
//    setting or global replaces the queued one (never per fn alone, which would drop edits of other params).
//
// GP-50-only commands (EXP/BPM records, 8-byte footswitch masks, chain reorder, delete/paste/move, export read,
// is-modified) come from static RE of Valeton Suite 2.1.0; on a GP-5 they are refused with
// Gp5Error("unsafe").

import {
  BLOCKS,
  EXP_FIELDS,
  KIND,
  PATCH_SETTINGS,
  READ,
  Reassembler,
  decodeCurrentPatch,
  decodeCurrentSlot,
  decodeExportedPreset,
  decodeGlobals,
  decodeMessage,
  decodeModified,
  decodePresetNames,
  decodeSlotTable,
  encode,
  globalsFor,
  midi,
  packetize,
  parseSysex,
  toHex,
} from "./protocol.mjs";
import { DEVICES, bodyOf, detectDevice, deviceByBodyLength, rebuildPrst, validateFootswitches, validateOrder } from "./prst.mjs";
import { encodeImportSnapTone, isUserSnapToneSlot, sanitizeSnapToneName, sanitizeUserIrName } from "./snaptone.mjs";
import { USER_IR, encodeImportUserIr, isUserIrSlot } from "./userir.mjs";

export const DEFAULT_TIMING = Object.freeze({
  interMessageMs: 20, // TonexOneController: VALETON_GP5_INTER_MESSAGE_DELAY
  settleMs: 200, // gap after every read exchange (drewmerc302/valeton-gp50 SETTLE_MS)
  editSettleMs: 25, // gap after live-edit commands (gp5-editor EDIT_SETTLE_MS)
  readTimeoutMs: 2500, // whole multi-frame reply must arrive within this
  ackTimeoutMs: 150, // per-frame ACK wait during writes/commands
  postSelectMs: 300, // after a preset change before reading 0x41 ("0.15 races; 0.25 clean")
  snapToneAckTimeoutMs: 3000, // per-frame ACK wait of a SnapTone / User IR upload before resending (Suite: 3000 x 1 ms ticks)
  snapToneResends: 9, // resends allowed per SnapTone / User IR upload (Suite fails the message after the 9th)
  readRetries: 1,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Gp5Error extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // "timeout" | "length" | "verify" | "unsafe" | "closed"
  }
}

/**
 * Preset selection per model when method = "auto": the GP-5 takes CC#0 (hardware) and ignores Program Change;
 * Valeton Suite selects a GP-50 with SysEx 11 43 only, and Program Change is hardware-proven there.
 */
const AUTO_SELECT = Object.freeze({ gp5: ["cc", "sysex"], gp50: ["sysex", "pc"] });

export class Gp5Session extends EventTarget {
  #t;
  #timing;
  #chain = Promise.resolve();
  #lastSend = 0;
  #reasm = new Reassembler();
  #device = null; // "gp5" | "gp50" once the first 0x41 body has been read
  #waiters = new Set();
  #queued = new Map(); // coalescing key -> live edit not yet sent { payload, promise }
  #closed = false;
  #log;

  /**
   * @param transport see header
   * @param opts { timing?: Partial<DEFAULT_TIMING>, log?: (dir, bytes, decoded?) => void }
   */
  constructor(transport, opts = {}) {
    super();
    this.#t = transport;
    this.#timing = { ...DEFAULT_TIMING, ...opts.timing };
    this.#log = opts.log;
    transport.onMessage((bytes) => this.#onBytes(bytes));
  }

  get transportName() {
    return this.#t.name;
  }

  /** Connected pedal model ("gp5" | "gp50"), or null before the first body read (see identify()). */
  get device() {
    return this.#device;
  }

  /** Detect the pedal model (reads the active body once if not known yet). */
  async identify() {
    if (!this.#device) await this.readCurrentBody();
    return this.#device;
  }

  // ------------------------------------------------------------------------------------------- low level

  #onBytes(bytes) {
    if (bytes[0] !== 0xf0) {
      this.#log?.("rx", bytes);
      this.dispatchEvent(Object.assign(new Event("midi"), { data: bytes }));
      return;
    }
    const frame = parseSysex(bytes);
    if (!frame || !frame.crcOk || !frame.lenOk) {
      this.#log?.("rx-bad", bytes);
      this.dispatchEvent(Object.assign(new Event("badframe"), { data: bytes }));
      return;
    }
    const payload = this.#reasm.push(frame);
    if (!payload) return;
    const msg = decodeMessage(payload);
    this.#log?.("rx", bytes, msg);
    let consumed = false;
    for (const w of this.#waiters) if (w.match(payload, msg)) (consumed = true), w.resolve(payload);
    // "message" = unsolicited traffic only (pedal knobs/footswitches, echoes nobody waited for)
    if (!consumed) this.dispatchEvent(Object.assign(new Event("message"), { message: msg }));
  }

  async #send(bytes) {
    if (this.#closed) throw new Gp5Error("closed", "session closed");
    const wait = this.#lastSend + this.#timing.interMessageMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.#log?.("tx", bytes);
    this.#t.send(bytes);
    this.#lastSend = Date.now();
  }

  #waitFor(match, timeoutMs) {
    let w;
    const p = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(w);
        reject(new Gp5Error("timeout", `no reply within ${timeoutMs} ms`));
      }, timeoutMs);
      w = {
        match,
        resolve: (v) => {
          clearTimeout(timer);
          this.#waiters.delete(w);
          resolve(v);
        },
      };
      this.#waiters.add(w);
    });
    return p;
  }

  /** Serialize fn behind every previous exchange, then settle for `settleMs`. */
  exclusive(fn, settleMs = this.#timing.settleMs) {
    const run = this.#chain.then(fn, fn);
    this.#chain = run.then(
      () => sleep(settleMs),
      () => sleep(settleMs)
    );
    return run;
  }

  /** Read selector `sel` (READ.*); resolves with the reassembled payload incl. the [0x12, sel] echo. */
  read(sel, opts) {
    return this.#request([KIND.GET, sel], opts);
  }

  /** Send a read request payload [0x12, sel, ...args] and wait for the reply starting with [0x12, sel]. */
  #request(payload, { timeoutMs = this.#timing.readTimeoutMs, retries = this.#timing.readRetries } = {}) {
    return this.exclusive(() => this.#requestNow(payload, timeoutMs, retries));
  }

  async #requestNow(payload, timeoutMs, retries) {
    const sel = payload[1];
    for (let attempt = 0; ; attempt++) {
      this.#reasm.reset();
      const reply = this.#waitFor((p) => p[0] === KIND.GET && p[1] === sel && p.length > 2, timeoutMs);
      for (const m of packetize(payload)) await this.#send(m);
      try {
        return await reply;
      } catch (e) {
        if (attempt >= retries) throw new Gp5Error("timeout", `read 0x${sel.toString(16)}: ${e.message}`);
        await sleep(400);
      }
    }
  }

  /** Send a logical command payload (framed + paced); waits up to ackTimeoutMs per frame for an ACK. */
  command(payload, opts = {}) {
    return this.exclusive(() => this.#commandNow(payload, opts), this.#timing.editSettleMs);
  }

  async #commandNow(payload, { ackTimeoutMs = this.#timing.ackTimeoutMs, requireAck = false } = {}) {
    const frames = packetize(payload);
    let acked = 0;
    for (const f of frames) {
      const ack = this.#waitFor((p) => p[0] === KIND.ACK, ackTimeoutMs).then(
        () => true,
        () => false
      );
      await this.#send(f);
      if (await ack) acked++;
    }
    if (requireAck && acked < frames.length) throw new Gp5Error("verify", `only ${acked}/${frames.length} frames acknowledged`);
    return { frames: frames.length, acked };
  }

  /**
   * Live edit that may be coalesced: while an edit with the same `key` waits in the queue, a newer one replaces its
   * payload and shares its promise, so a knob drag sends only the latest value once the pedal is free.
   */
  #coalesced(key, payload) {
    const queued = this.#queued.get(key);
    if (queued) {
      queued.payload = payload;
      return queued.promise;
    }
    const entry = { payload, promise: null };
    entry.promise = this.exclusive(() => {
      this.#queued.delete(key);
      return this.#commandNow(entry.payload);
    }, this.#timing.editSettleMs);
    this.#queued.set(key, entry);
    return entry.promise;
  }

  /** Raw short MIDI message (CC/PC), paced like everything else. */
  sendShort(bytes) {
    return this.exclusive(() => this.#send(Uint8Array.from(bytes)), this.#timing.editSettleMs);
  }

  async close() {
    this.#closed = true;
    await this.#chain.catch(() => {});
    await this.#t.close();
  }

  /** Commands Valeton Suite sends only to a GP-50: refuse them on a GP-5. */
  async #requireGp50(what) {
    const device = await this.identify();
    if (device !== "gp50") throw new Gp5Error("unsafe", `${what} is a GP-50 command; the ${DEVICES[device].name} does not support it`);
  }

  // ------------------------------------------------------------------------------------------- reads

  async readPresetNames() {
    return decodePresetNames(await this.read(READ.PRESET_NAMES));
  }
  async readCurrentSlot() {
    return decodeCurrentSlot(await this.read(READ.CURRENT_SLOT));
  }
  /**
   * Body of the ACTIVE preset buffer (incl. unsaved live edits): 466 bytes on GP-5, 511 on GP-50.
   * The first body fixes the session's device; later bodies must have the same length.
   */
  async readCurrentBody() {
    let got = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const body = decodeCurrentPatch(await this.read(READ.CURRENT_PATCH));
      const dev = deviceByBodyLength(body.length);
      if (dev && (!this.#device || this.#device === dev.key)) {
        this.#device ??= dev.key;
        return body;
      }
      got = body.length;
      this.#log?.("warn", new Uint8Array(), { type: "length", got });
      await sleep(400);
    }
    const want = this.#device
      ? `${DEVICES[this.#device].bodyLength} for the ${DEVICES[this.#device].name}`
      : `${DEVICES.gp5.bodyLength} (GP-5) or ${DEVICES.gp50.bodyLength} (GP-50)`;
    throw new Gp5Error("length", `0x41 body is ${got} bytes, expected ${want}`);
  }
  async readSnapTones() {
    return decodeSlotTable(await this.read(READ.SNAPTONES));
  }
  async readUserIRs() {
    return decodeSlotTable(await this.read(READ.USER_IRS));
  }
  /** Global settings named after the connected model's table (protocol.mjs globalsFor). */
  async readGlobals() {
    const device = await this.identify();
    return decodeGlobals(await this.read(READ.GLOBALS), device);
  }
  /** GP-50: true when the active preset has unsaved edits (0x45, read by Suite at every GP-50 connect). */
  async readModified() {
    await this.#requireGp50("readModified");
    return decodeModified(await this.read(READ.MODIFIED));
  }
  /** GP-50: read slot `slot` as a 552-byte .prst without selecting it (export read 12 4F). */
  async exportPreset(slot) {
    await this.#requireGp50("exportPreset");
    const { name, body } = decodeExportedPreset(await this.#request(encode.exportPreset(slot)));
    if (body.length !== DEVICES.gp50.bodyLength) throw new Gp5Error("length", `export of slot ${slot} returned a ${body.length}-byte body, expected ${DEVICES.gp50.bodyLength}`);
    return rebuildPrst(name, body, "gp50");
  }

  // ------------------------------------------------------------------------------------------- preset selection

  /**
   * Select preset `slot`, verified by reading 0x43; returns the slot reported by the pedal.
   * method: "cc" (CC#0), "sysex" (11 43), "pc" (Program Change, GP-50) or "auto" — per model: GP-5 CC#0 then SysEx,
   * GP-50 SysEx then Program Change (AUTO_SELECT).
   */
  async selectPreset(slot, { method = "auto" } = {}) {
    const methods = method === "auto" ? AUTO_SELECT[await this.identify()] : [method];
    let now = null;
    for (const m of methods) {
      await this.#sendSelect(slot, m);
      await sleep(this.#timing.postSelectMs);
      now = await this.readCurrentSlot();
      if (now === slot) return now;
    }
    throw new Gp5Error("verify", `pedal reports slot ${now} after selecting ${slot}`);
  }

  #sendSelect(slot, method) {
    if (method === "cc") return this.sendShort(midi.selectPreset(slot));
    if (method === "pc") return this.sendShort(midi.programSelect(slot));
    if (method === "sysex") return this.command(encode.selectPreset(slot));
    throw new RangeError(`unknown select method ${method}; use auto, cc, sysex or pc`);
  }

  /** Read slot `slot` as a complete .prst of the connected device (selects it!). Pass names to avoid re-reading 0x40. */
  async readPreset(slot, { names } = {}) {
    await this.selectPreset(slot);
    const body = await this.readCurrentBody();
    const list = names ?? (await this.readPresetNames());
    return rebuildPrst(list[slot].name, body, this.#device);
  }

  /** Back up every slot. Restores the originally active slot afterwards. onProgress(done, total, entry). */
  async backupAll({ onProgress, slots } = {}) {
    const names = await this.readPresetNames();
    const original = await this.readCurrentSlot();
    const wanted = slots ?? names.map((n) => n.slot);
    const out = [];
    try {
      for (const slot of wanted) {
        const prst = await this.readPreset(slot, { names });
        const entry = { slot, name: names[slot].name, prst };
        out.push(entry);
        onProgress?.(out.length, wanted.length, entry);
      }
    } finally {
      await this.selectPreset(original).catch(() => {});
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------- live edits (active buffer)

  setBlockEnabled(block, on) {
    return this.command(encode.setBlockEnabled(block, on));
  }
  /** Changes model; the pedal loads that model's default params — re-read 0x41 before showing values. */
  setModel(block, fxid) {
    return this.command(encode.setModel(block, fxid));
  }
  setParam(block, paramIndex, value) {
    const payload = encode.setParam(block, paramIndex, value);
    return this.#coalesced(`48:${payload[2]}:${paramIndex}`, payload);
  }
  /**
   * GP-50: turn the Sync toggle `syncAlgId` of `block` on or off, then re-read the active body: the pedal resets the
   * bound Time/Rate (division 1/4 on, the param default off), so the caller must show the returned values.
   */
  async setSync(block, syncAlgId, on) {
    await this.#requireGp50("setSync");
    await this.setParam(block, syncAlgId, on ? 1 : 0);
    return this.readCurrentBody();
  }
  setPatchVolume(vol) {
    return this.#coalesced(`42:${PATCH_SETTINGS.volume.record}`, encode.setPatchVolume(vol));
  }
  /** Patch setting record (protocol.mjs PATCH_SETTINGS); EXP records are GP-50 only. */
  async setPatchSetting(record, value) {
    const payload = encode.setPatchSetting(record, value);
    const field = Object.keys(PATCH_SETTINGS).find((f) => PATCH_SETTINGS[f].record === record);
    if (PATCH_SETTINGS[field].gp50Only) await this.#requireGp50(`patch setting ${field}`);
    return this.#coalesced(`42:${record}`, payload);
  }
  /** Tempo of the active preset, 40..260 BPM (record 0x2002). */
  setBpm(bpm) {
    return this.setPatchSetting(PATCH_SETTINGS.bpm.record, bpm);
  }
  /**
   * GP-50: EXP settings of the active preset; send only the fields given, in record order (0x2003..0x200A).
   * exp = Partial<{ on: boolean, paramMin, paramMax (0..100 %), volPosition (0 Pre / 1 Post), volMin, volMax (0..100),
   * targetModule (0..10, EXP_TARGETS), targetParam (0..7, index in the target model's params) }>.
   * Every value is checked before the first record is sent.
   */
  async setExp(exp) {
    await this.#requireGp50("setExp");
    const fields = exp ?? {};
    const unknown = Object.keys(fields).filter((f) => !EXP_FIELDS.includes(f));
    if (unknown.length) throw new RangeError(`unknown EXP setting ${unknown.join(", ")}`);
    const payloads = EXP_FIELDS.filter((f) => fields[f] !== undefined).map((f) => encode.setPatchSetting(PATCH_SETTINGS[f].record, fields[f]));
    const results = [];
    for (const p of payloads) results.push(await this.#coalesced(`42:${p[2] | (p[3] << 8)}`, p));
    return results;
  }
  /**
   * Global setting `name` of the connected model's table (GP-5: GLOBALS, GP-50: GLOBALS_GP50), clamped and sent as
   * int32. A name the model does not have throws RangeError.
   */
  async setGlobal(name, value) {
    const device = await this.identify();
    const g = globalsFor(device)[name];
    return this.#coalesced(`11:${g?.addr.join(":")}`, encode.setGlobal(name, value, device));
  }
  setTuner(on) {
    return this.sendShort(midi.tuner(on));
  }
  /**
   * GP-50: footswitch assignment of the active preset (11 4D, two u32 masks). At most 3 blocks per switch, a block on
   * one switch only. The GP-5 takes footswitch changes through a full preset write (writePreset).
   */
  async setFootswitchMasks(fs1, fs2) {
    await this.#requireGp50("setFootswitchMasks");
    const err = validateFootswitches(fs1, fs2);
    if (err) throw new RangeError(err);
    return this.command(encode.setFootswitchMasks(fs1, fs2));
  }
  /** GP-50: chain order of the active preset (11 44, 10 block indices; DST, NS, AMP, CAB, EQ stay together). */
  async setOrder(order) {
    await this.#requireGp50("setOrder");
    const err = validateOrder(order);
    if (err) throw new RangeError(err);
    return this.command(encode.setOrder(order));
  }

  // ------------------------------------------------------------------------------------------- persistent writes (destructive)

  #guard(confirm, what) {
    if (confirm !== true) throw new Gp5Error("unsafe", `${what} overwrites pedal memory; pass { confirm: true } after backing up`);
  }

  /** Store the active buffer (with live edits) into `slot` named `name` (<= 10 chars). */
  async savePreset(slot, name, { confirm } = {}) {
    this.#guard(confirm, "savePreset");
    return this.command(encode.savePreset(slot, name));
  }

  /** Rename a slot (<= 10 chars). Valeton Suite capture; verified on hardware. */
  async renamePreset(slot, name, { confirm } = {}) {
    this.#guard(confirm, "renamePreset");
    return this.command(encode.renamePreset(slot, name));
  }

  /** GP-50: reset `slot` to the empty preset (11 46). Re-read the names (0x40) afterwards. */
  async deletePreset(slot, { confirm } = {}) {
    this.#guard(confirm, "deletePreset");
    await this.#requireGp50("deletePreset");
    return this.command(encode.deletePreset(slot));
  }

  /** GP-50: copy preset `fromSlot` onto `slot` (11 4B). Suite selects `slot` afterwards to show it. */
  async pastePreset(slot, fromSlot, { confirm } = {}) {
    this.#guard(confirm, "pastePreset");
    await this.#requireGp50("pastePreset");
    return this.command(encode.pastePreset(slot, fromSlot));
  }

  /** GP-50: move the preset at list position `from` to `to` (11 5A); the presets in between shift by one. */
  async movePreset(from, to, { confirm } = {}) {
    this.#guard(confirm, "movePreset");
    await this.#requireGp50("movePreset");
    return this.command(encode.movePreset(from, to));
  }

  /**
   * Write a .prst of the connected device into `slot` (GP-5 507 B = 26 frames, GP-50 552 B = 29 frames, one ACK per
   * frame), then verify by reading it back.
   * If a frame is not acknowledged the pedal discards the whole transfer (observed on hardware right after a
   * save/select burst), so the stream is aborted and restarted from frame 0 after a pause (up to `attempts`).
   * Verification selects another slot and then `slot` (re-selecting the active slot does not reload flash).
   */
  async writePreset(slot, prst, { confirm, verify = true, onProgress, attempts = 3 } = {}) {
    this.#guard(confirm, "writePreset");
    const device = await this.identify();
    const file = detectDevice(prst);
    if (file.key !== device) throw new Gp5Error("unsafe", `this is a ${file.name} preset but the pedal is a ${DEVICES[device].name}; convert it first`);
    const frames = packetize(encode.writePreset(slot, prst));
    const want = bodyOf(prst);
    for (let attempt = 1; ; attempt++) {
      await sleep(attempt === 1 ? 300 : 1000); // let the pedal finish flash work from earlier commands
      const acked = await this.exclusive(async () => {
        for (let i = 0; i < frames.length; i++) {
          const ack = this.#waitFor((p) => p[0] === KIND.ACK, this.#timing.ackTimeoutMs * 2).then(
            () => true,
            () => false
          );
          await this.#send(frames[i]);
          if (!(await ack)) return i;
          onProgress?.(i + 1, frames.length);
        }
        return frames.length;
      });
      if (acked < frames.length) {
        if (attempt < attempts) continue;
        throw new Gp5Error("verify", `frame ${acked + 1}/${frames.length} not acknowledged after ${attempts} attempts; slot ${slot} unchanged`);
      }
      if (!verify) return { frames: frames.length, acked, attempts: attempt, verified: false };
      await this.selectPreset((slot + 1) % 100);
      await this.selectPreset(slot);
      const body = await this.readCurrentBody();
      if (body.length === want.length && body.every((v, i) => v === want[i])) return { frames: frames.length, acked, attempts: attempt, verified: true };
      if (attempt >= attempts) throw new Gp5Error("verify", `read-back of slot ${slot} differs from the written preset`);
    }
  }

  /**
   * Upload a 2696-byte SnapTone file (lib/snaptone.mjs) into user SnapTone slot `slot` (50..79) as `name`.
   * The name follows Suite's SnapTone rule (letters and digits only, see sanitizeSnapToneName). Sent with the Suite
   * file transport (#sendFileFrames), then verified by re-reading the SnapTone table (0x24): it must hold user
   * content under that name.
   */
  async uploadSnapTone(slot, name, file, { confirm, onProgress } = {}) {
    this.#guard(confirm, "uploadSnapTone");
    if (!isUserSnapToneSlot(slot)) throw new Gp5Error("unsafe", `SnapTone uploads go to user slots 50..79, got ${slot}`);
    const label = sanitizeSnapToneName(name);
    const frames = packetize(encodeImportSnapTone(slot, label, file));
    await this.#sendFileFrames(frames, "SnapTone", onProgress);
    await this.#verifyTableEntry(() => this.readSnapTones(), slot, label, `SnapTone slot ${slot}`);
    return { frames: frames.length, name: label, slot };
  }

  /**
   * Upload a 2048-byte User IR data block (lib/userir.mjs) into User IR slot `slot` (0..19) as `name`.
   * Same transport as SnapTone; the pedal sends no final reply, so the slot is verified through the User IR
   * table (0x20). The IR content itself cannot be read back.
   */
  async uploadUserIr(slot, name, data, { confirm, onProgress } = {}) {
    this.#guard(confirm, "uploadUserIr");
    if (!isUserIrSlot(slot)) throw new Gp5Error("unsafe", `User IR uploads go to slots 0..${USER_IR.SLOTS - 1}, got ${slot}`);
    const label = sanitizeUserIrName(name);
    const frames = packetize(encodeImportUserIr(slot, label, data));
    await this.#sendFileFrames(frames, "User IR", onProgress);
    await this.#verifyTableEntry(() => this.readUserIRs(), slot, label, `User IR ${slot + 1}`);
    return { frames: frames.length, name: label, slot };
  }

  /**
   * Suite's file-upload flow control (SnapTone, User IR): one frame per ACK; an ACK whose first data byte is
   * not 0, or no ACK within snapToneAckTimeoutMs, resends the same frame; more than snapToneResends resends abort.
   */
  async #sendFileFrames(frames, what, onProgress) {
    await sleep(300); // let the pedal finish flash work from earlier commands, as before preset writes
    await this.exclusive(async () => {
      let resends = 0;
      for (let i = 0; i < frames.length; ) {
        // Suite's HTDevice::reciveACKData accepts kind 0x14 and 0x13; the first data byte 0 means "accepted".
        const ack = this.#waitFor((p) => p[0] === KIND.ACK || p[0] === 0x13, this.#timing.snapToneAckTimeoutMs).then(
          (p) => p[2] === 0,
          () => false
        );
        await this.#send(frames[i]);
        if (await ack) {
          i++;
          onProgress?.(i, frames.length);
        } else if (++resends > this.#timing.snapToneResends) {
          throw new Gp5Error("verify", `${what} upload stopped at frame ${i + 1}/${frames.length}: the pedal did not accept it`);
        }
      }
    });
  }

  /** A slot table entry must show user content (flag 0) under `label`; the pedal may need a moment to commit. */
  async #verifyTableEntry(readTable, slot, label, what) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await sleep(500);
      const entry = (await readTable())[slot];
      if (entry?.flag === 0 && entry.name === label) return;
    }
    throw new Gp5Error("verify", `${what} does not show "${label}" after the upload`);
  }

  // ------------------------------------------------------------------------------------------- state sync

  /**
   * Full snapshot used at connect time: names, active slot, active body (detects the device), globals and, on a
   * GP-50, the is-modified flag (null on a GP-5 or when the read fails).
   */
  async syncState() {
    const names = await this.readPresetNames();
    const slot = await this.readCurrentSlot();
    const body = await this.readCurrentBody();
    const globals = await this.readGlobals().catch(() => null);
    const modified = this.#device === "gp50" ? await this.readModified().catch(() => null) : null;
    return { device: this.#device, names, slot, prst: rebuildPrst(names[slot]?.name ?? "", body, this.#device), globals, modified };
  }
}

export { BLOCKS, toHex };
