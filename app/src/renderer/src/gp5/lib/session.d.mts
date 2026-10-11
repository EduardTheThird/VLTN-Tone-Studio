// Type declarations for session.mjs (the JS stays the tested source of truth; keep these in sync).
/** Pedal model of this protocol family: Valeton GP-5 or GP-50 (same protocol, different preset size and catalog). */
export type Gp5FamilyKey = "gp5" | "gp50";

export interface Gp5Transport {
  name: string;
  send(bytes: Uint8Array | number[]): void;
  onMessage(cb: (bytes: Uint8Array) => void): void;
  close(): void | Promise<void>;
}

export interface Gp5Timing {
  interMessageMs: number;
  settleMs: number;
  editSettleMs: number;
  readTimeoutMs: number;
  ackTimeoutMs: number;
  postSelectMs: number;
  snapToneAckTimeoutMs: number;
  snapToneResends: number;
  readRetries: number;
}
export const DEFAULT_TIMING: Readonly<Gp5Timing>;

export type Gp5ErrorCode = "timeout" | "length" | "verify" | "unsafe" | "closed";
export class Gp5Error extends Error {
  constructor(code: Gp5ErrorCode, message: string);
  code: Gp5ErrorCode;
}

export interface PresetNameRecord {
  slot: number;
  id: number;
  name: string;
}
export interface SlotTableRecord {
  index: number;
  name: string;
  kind: "user" | "factory" | "empty";
  flag: number;
}

/** Global settings of the GP-5 (protocol.mjs GLOBALS). */
export type Gp5GlobalName = "inputTrim" | "masterVolume" | "cabSimBypass" | "recordLevel" | "monitorLevel" | "btLevel";
/** Global settings of the GP-50 (protocol.mjs GLOBALS_GP50; record ids differ from the GP-5). */
export type Gp50GlobalName =
  | "masterVolume"
  | "inputTrim"
  | "monitorLevel"
  | "cabSimBypass"
  | "autoCabMatch"
  | "bypassMode"
  | "recordLevel"
  | "btRecordLevel"
  | "recModeLeft"
  | "recModeRight"
  | "footswitchMode"
  | "expJack"
  | "fs3Function"
  | "fs4Function"
  | "midiInSource"
  | "midiChannelTrs"
  | "midiChannelUsb"
  | "midiChannelBt"
  | "displayTime"
  | "displayBrightness"
  | "dcUnplug";
export type GlobalName = Gp5GlobalName | Gp50GlobalName;
/** One entry of protocol.mjs globalsFor(device): everything a generic settings UI needs. */
export interface GlobalSpec {
  name: GlobalName;
  label: string;
  /** Record id [a, b] of 0x10 / 0x11 */
  addr: readonly [number, number];
  kind: "number" | "enum";
  min: number;
  max: number;
  unit?: "dB";
  /** enum: label of each value, labels[value - min] (min is 0 for every enum) */
  labels?: readonly string[];
  group: "audio" | "recording" | "controls" | "midi" | "display" | "power";
  /** Firmware that added the setting; show it only when the pedal reports the record */
  since?: string;
}
export type GlobalsRecord = {
  records: { a: number; b: number; len: number; value: number }[];
  /** Firmware version from record (1,1), e.g. "1.1.0" */
  firmware?: string;
} & Partial<Record<GlobalName, number>>;

/** EXP settings of a GP-50 preset (patch-setting records 0x2003..0x200A). */
export interface ExpSettings {
  on: boolean;
  /** Target-param sweep, 0..100 % of the param range */
  paramMin: number;
  paramMax: number;
  /** EXP volume position: 0 Pre, 1 Post */
  volPosition: 0 | 1;
  volMin: number;
  volMax: number;
  /** 0 VOL, 1 NR, 2 PRE, 3 DST, 4 NS, 5 AMP, 6 CAB, 7 EQ, 8 MOD, 9 DLY, 10 RVB (protocol.mjs EXP_TARGETS) */
  targetModule: number;
  /** Index into the target model's param list, 0..7 */
  targetParam: number;
}
export type ExpEdit = Partial<Omit<ExpSettings, "on" | "volPosition">> & { on?: boolean | 0 | 1; volPosition?: 0 | 1 };

export type DecodedMessageType =
  | "ack"
  | "slot"
  | "param"
  | "block"
  | "model"
  | "presetChanged"
  | "listChanged"
  | "patchSetting"
  | "footswitch"
  | "order"
  | "global"
  | "reply"
  | "unknown";
/**
 * A payload from the pedal. Fields by type: slot {slot}; param {block, index, value}; block {block, enabled};
 * model {block, fxid} (GP-5 3 x u32 and GP-50 s16 s16 s32 layouts); listChanged {list} (re-read 0x40 / 0x24 / 0x20);
 * patchSetting {settings: [{record, value}]}; footswitch {fs1, fs2} (block indices); order {order}; global {a, b, value};
 * reply {sel}; ack/presetChanged/unknown {kind, fn}.
 */
export interface DecodedMessage {
  type: DecodedMessageType;
  slot?: number;
  block?: number;
  index?: number;
  value?: number;
  enabled?: boolean;
  fxid?: number;
  list?: "presets" | "snaptones" | "irs";
  settings?: { record: number; value: number }[];
  fs1?: number[];
  fs2?: number[];
  order?: number[];
  a?: number;
  b?: number;
  sel?: number;
  kind?: number;
  fn?: number;
  raw: Uint8Array;
}
export interface BackupRecord {
  slot: number;
  name: string;
  prst: Uint8Array;
}
export interface CommandResult {
  frames: number;
  acked: number;
}
export interface WriteResult {
  frames: number;
  acked: number;
  attempts: number;
  verified: boolean;
}
export interface SnapToneUploadResult {
  frames: number;
  /** The name as stored on the pedal (Suite's SnapTone rule: letters and digits, <= 10) */
  name: string;
  slot: number;
}
export interface UserIrUploadResult {
  frames: number;
  /** The name as stored on the pedal (Suite's per-character rule applied) */
  name: string;
  slot: number;
}
export interface SyncSnapshot {
  device: Gp5FamilyKey;
  names: PresetNameRecord[];
  slot: number;
  prst: Uint8Array;
  globals: GlobalsRecord | null;
  /** GP-50: unsaved edits in the active preset (0x45); null on a GP-5 or when the read failed */
  modified: boolean | null;
}
export type SelectMethod = "auto" | "cc" | "sysex" | "pc";

/**
 * Events: "message" (unsolicited, `.message: DecodedMessage`), "midi" (short messages, `.data`), "badframe" (`.data`).
 * GP-50-only methods reject with Gp5Error("unsafe") on a GP-5; destructive ones need { confirm: true }.
 */
export class Gp5Session extends EventTarget {
  constructor(transport: Gp5Transport, opts?: { timing?: Partial<Gp5Timing>; log?: (dir: string, bytes: Uint8Array, decoded?: unknown) => void });
  get transportName(): string;
  /** Connected model, null until the first 0x41 body has been read. */
  get device(): Gp5FamilyKey | null;
  /** Detect the model (reads the active body if it is not known yet). */
  identify(): Promise<Gp5FamilyKey>;
  exclusive<T>(fn: () => Promise<T>, settleMs?: number): Promise<T>;
  read(sel: number): Promise<Uint8Array>;
  command(payload: number[]): Promise<CommandResult>;
  sendShort(bytes: number[]): Promise<void>;
  close(): Promise<void>;

  readPresetNames(): Promise<PresetNameRecord[]>;
  readCurrentSlot(): Promise<number>;
  readCurrentBody(): Promise<Uint8Array>;
  readSnapTones(): Promise<SlotTableRecord[]>;
  readUserIRs(): Promise<SlotTableRecord[]>;
  /** Globals named after the connected model's table. */
  readGlobals(): Promise<GlobalsRecord>;
  /** GP-50: unsaved edits in the active preset (12 45). */
  readModified(): Promise<boolean>;
  /** GP-50: slot as a 552-byte .prst via the export read (12 4F), without selecting it. */
  exportPreset(slot: number): Promise<Uint8Array>;

  /** auto: GP-5 CC#0 then SysEx; GP-50 SysEx 11 43 then Program Change. Verified by reading 0x43. */
  selectPreset(slot: number, opts?: { method?: SelectMethod }): Promise<number>;
  readPreset(slot: number, opts?: { names?: { name: string }[] }): Promise<Uint8Array>;
  backupAll(opts?: { onProgress?: (done: number, total: number, entry: BackupRecord) => void }): Promise<BackupRecord[]>;

  setBlockEnabled(block: number | string, on: boolean): Promise<CommandResult>;
  setModel(block: number | string, fxid: number): Promise<CommandResult>;
  /** Coalesced per (block, param) while queued. */
  setParam(block: number | string, paramIndex: number, value: number): Promise<CommandResult>;
  /** GP-50: Sync toggle on/off, then re-read the body (the pedal resets the bound Time/Rate); resolves with that body. */
  setSync(block: number | string, syncAlgId: number, on: boolean): Promise<Uint8Array>;
  setPatchVolume(vol: number): Promise<CommandResult>;
  /** Patch-setting record 0x2001..0x200A (protocol.mjs PATCH_SETTINGS); EXP records GP-50 only. */
  setPatchSetting(record: number, value: number | boolean): Promise<CommandResult>;
  /** 40..260 BPM (record 0x2002). */
  setBpm(bpm: number): Promise<CommandResult>;
  /** GP-50: send the given EXP fields (records 0x2003..0x200A, in record order); all values are checked first. */
  setExp(exp: ExpEdit): Promise<CommandResult[]>;
  /** A global of the connected model's table, clamped, sent as int32; unknown names reject with RangeError. */
  setGlobal(name: GlobalName, value: number): Promise<CommandResult>;
  setTuner(on: boolean): Promise<void>;
  /** GP-50: footswitch blocks (storage indices), <= 3 per switch, disjoint (11 4D). */
  setFootswitchMasks(fs1: number[], fs2: number[]): Promise<CommandResult>;
  /** GP-50: chain order (11 44), checked with prst.validateOrder. */
  setOrder(order: number[]): Promise<CommandResult>;

  savePreset(slot: number, name: string, opts: { confirm: true }): Promise<CommandResult>;
  renamePreset(slot: number, name: string, opts: { confirm: true }): Promise<CommandResult>;
  /** GP-50: reset a slot to the empty preset (11 46). */
  deletePreset(slot: number, opts: { confirm: true }): Promise<CommandResult>;
  /** GP-50: copy `fromSlot` onto `slot` (11 4B). */
  pastePreset(slot: number, fromSlot: number, opts: { confirm: true }): Promise<CommandResult>;
  /** GP-50: move the preset at list position `from` to `to` (11 5A); the presets in between shift. */
  movePreset(from: number, to: number, opts: { confirm: true }): Promise<CommandResult>;
  writePreset(
    slot: number,
    prst: Uint8Array,
    opts: { confirm: true; verify?: boolean; onProgress?: (done: number, total: number) => void; attempts?: number },
  ): Promise<WriteResult>;
  /** Upload a 2696-byte SnapTone file into user SnapTone slot 50..79; verified via the 0x24 table. */
  uploadSnapTone(
    slot: number,
    name: string,
    file: Uint8Array,
    opts: { confirm: true; onProgress?: (done: number, total: number) => void },
  ): Promise<SnapToneUploadResult>;
  /** Upload a 2048-byte User IR data block into User IR slot 0..19; verified via the 0x20 table. */
  uploadUserIr(
    slot: number,
    name: string,
    data: Uint8Array,
    opts: { confirm: true; onProgress?: (done: number, total: number) => void },
  ): Promise<UserIrUploadResult>;
  syncState(): Promise<SyncSnapshot>;
}
