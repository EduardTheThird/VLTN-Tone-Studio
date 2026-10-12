// Type declarations for protocol.mjs (the JS stays the tested source of truth; keep these in sync).
export type Bytes = Uint8Array | readonly number[];

export const SYSEX_HEAD: readonly number[];
export const CHUNK: number;
export const MAX_MESSAGE: number;
export const P: Readonly<{ QUERY: 3; SET: 0; UPLOAD: 1; DONE: 9; EVENT: 0x20 }>;
export const CONTROL: Readonly<{ ACK: 0; HELLO: 1; HELLO_REPLY: 2; RESEND: 3 }>;
export const HELLO_VERSION: number;
export const CMD: Readonly<{
  PRESET_NAMES: number;
  IR_UPLOAD: number;
  IR_RENAME: number;
  IR_NAMES: number;
  SNAPTONE_UPLOAD: number;
  SNAPTONE_RENAME: number;
  SNAPTONE_NAMES: number;
  STATE: number;
  DEVICE_ID: number;
  NAM_UPLOAD: number;
  NAM_RENAME: number;
  NAM_NAMES: number;
  GLOBALS: number;
  GLOBAL_EQ: number;
  IO: number;
  USB: number;
  MIDI: number;
  SYSTEM: number;
  DRUM: number;
  TUNER: number;
  FACTORY_RESET: number;
  PATCH: number;
  PATCH_SETTINGS: number;
  BLOCK_ON: number;
  MODEL: number;
  PARAM: number;
  CHAIN: number;
  KNOBS: number;
  EXP: number;
  PATCH_STATE: number;
  CTRL: number;
  SAVED: number;
}>;
export const DANGEROUS: ReadonlySet<number>;
export type BlockName = "PRE" | "WAH" | "DST" | "NS" | "AMP" | "NR" | "CAB" | "EQ" | "MOD" | "DLY" | "RVB" | "VOL";
export const BLOCKS: readonly BlockName[];
export const BLOCK: Readonly<Record<BlockName, number>>;
export const PARAM_COUNT: number;
export const NONE_FXID: number;
export const KNOB_TARGET: Readonly<{ PATCH_VOL: number; PATCH_BPM: number; NONE: number }>;
export const SLOTS: Readonly<{ PRESETS: number; SNAPTONES: number; NAMS: number; USER_IRS: number }>;

export interface GlobalDef {
  cmd: number;
  off: number;
  type: "u8" | "u16" | "i16";
}
export type GlobalName =
  | "inputLevel"
  | "outputStereo"
  | "noCabL"
  | "noCabR"
  | "micLevel"
  | "micMonitor"
  | "micJack"
  | "usbRecLevel"
  | "btRecLevel"
  | "micRecLevel"
  | "recModeL"
  | "recModeR"
  | "usbMonitorLevel"
  | "midiInSource"
  | "midiInChannelTrs"
  | "midiInChannelUsb"
  | "midiInChannelBt"
  | "midiOutChannelTrs"
  | "midiOutChannelUsb"
  | "midiOutChannelBt"
  | "clockSource"
  | "clockOutTrs"
  | "cloudOutUsb"
  | "brightness"
  | "displayTimeout"
  | "fsMode"
  | "expJack"
  | "fsJack"
  | "extFs1"
  | "extFs2"
  | "tapPre"
  | "tapMod"
  | "tapDly"
  | "btAudioLevel"
  | "autoCabMatch"
  | "autoSave"
  | "globalEq";
export const GLOBALS: Readonly<Record<GlobalName, GlobalDef>>;
export const GLOBAL_RECORDS: readonly number[];
export const GLOBAL_EQ: Readonly<{ VALUES: number; ON: number; LEVEL: number; BANDS_AT: number }>;
export const NAME_FIELD: number;

export function toBytes(b: Bytes): Uint8Array;
export function u16le(v: number): number[];
export function u32le(v: number): number[];
export function u32be(v: number): number[];
export function readU16(b: ArrayLike<number>, o: number): number;
export function readU32(b: ArrayLike<number>, o: number): number;
export function readU32be(b: ArrayLike<number>, o: number): number;
export function f32le(v: number): number[];
export function readF32(b: Uint8Array, o: number): number;
export function concat(...parts: Bytes[]): Uint8Array;
export function nameField(name: string, len?: number): number[];
export function readName(b: ArrayLike<number>, o: number, len: number): string;
export function crc8(bytes: ArrayLike<number>): number;

export interface Packet {
  kind: "packet";
  total: number;
  offset: number;
  seq: number;
  index: number;
  data: Uint8Array;
}
export interface Control {
  kind: "control";
  type: number;
  arg: number;
  seq: number;
  index: number;
  extra: Uint8Array;
}
export function encodePacket(p: { total: number; offset: number; seq: number; index: number; data: ArrayLike<number> }): Uint8Array;
export function encodeControl(c: { type: number; arg?: number; seq?: number; index?: number; extra?: readonly number[] }): Uint8Array;
export function ack(seq: number): Uint8Array;
export function hello(): Uint8Array;
export function resendRequest(seq: number, index: number, offset: number, length: number): Uint8Array;
export function decodeFrame(bytes: Bytes): Packet | Control | null;
export function packetize(msg: Bytes, seq: number, fromHost?: boolean): Uint8Array[];
export function nextSeq(seq: number): number;
export class Reassembler {
  push(p: Packet): { seq: number; bytes: Uint8Array } | null;
  pending(seq: number): { offset: number; total: number } | null;
  reset(): void;
}

export interface Message {
  p: number;
  t: number;
  cmd: number;
  /** everything after the command */
  payload: Uint8Array;
  crcOk: boolean;
}
export function encodeMessage(m: { p: number; cmd: number; t?: number; payload?: ArrayLike<number> }): Uint8Array;
export function decodeMessage(bytes: Bytes): Message | null;
export function query(cmd: number, args?: readonly number[]): Uint8Array;
export const EDIT_BUFFER: number;
export function readPatch(slot: number, select: boolean): Uint8Array;
export function setParam(block: number, param: number, fxid: number, value: number): Uint8Array;
export function setBlockOn(block: number, on: boolean): Uint8Array;
export function setModel(block: number, fxid: number): Uint8Array;
export function setPatchSettings(record: Bytes): Uint8Array;
export function setKnobs(targets: readonly number[]): Uint8Array;
export function setExp(record: Bytes): Uint8Array;
export function setCtrl(record: Bytes): Uint8Array;
export function setGlobalRecord(cmd: number, record: Bytes): Uint8Array;
export function rename(cmd: number, slot: number, name: string): Uint8Array;
export function upload(cmd: number, slot: number, name: string, data: Bytes): Uint8Array;
export function importPatch(prst: Bytes): Uint8Array;

export function recordData(payload: Uint8Array): Uint8Array;
export function decodeNames(cmd: number, payload: Uint8Array): { slot: number; name: string; empty: boolean }[];
export function decodeParam(payload: Uint8Array): { fxid: number; value: number; block: number; param: number };
export function decodeBlockOn(payload: Uint8Array): { block: number; enabled: boolean };
export function decodeModel(payload: Uint8Array): { fxid: number; block: number };
export function decodeChain(payload: Uint8Array): number[];
export function decodeSaved(payload: Uint8Array): { slot: number; name: string };
export function decodeGlobals(payload: Uint8Array): { firmware: string; records: Map<number, Uint8Array> };
export function describe(msg: Message): Message & { name: string };

export function readGlobal(record: ArrayLike<number>, name: GlobalName): number;
export function writeGlobal(record: ArrayLike<number>, name: GlobalName, value: number): Uint8Array;
export function globalsOf(records: Map<number, Uint8Array>): Partial<Record<GlobalName, number>>;
export function eqValues(record: Uint8Array): number[];
export function eqRecord(values: readonly number[]): Uint8Array;
