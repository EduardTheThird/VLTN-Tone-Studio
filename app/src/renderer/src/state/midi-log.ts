// MIDI monitor: a bounded ring buffer of tx/rx lines fed by the Gp5Session `log` option, and the decoder that
// turns raw frames into readable lines ("Select preset 63", "Acknowledged", "Pedal: DLY Mix 32").
import { BLOCKS, CC, CMD, EXP_TARGETS, KIND, READ, Reassembler, decodeMessage, globalsFor, parseSysex, patchSettingByRecord } from "@/gp5/lib/protocol.mjs";
import { modelByFxid } from "@/gp5/lib/catalog.mjs";
import type { DeviceKey, GlobalSpec, MidiLogEntry } from "./device-types";

export const MIDI_LOG_CAP = 2000;

/** Fixed-capacity FIFO: pushing past capacity drops the oldest item. */
export class RingBuffer<T> {
  #items: (T | undefined)[];
  #start = 0;
  #size = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    this.#items = new Array(capacity);
  }

  get size() {
    return this.#size;
  }

  push(item: T): void {
    const end = (this.#start + this.#size) % this.capacity;
    this.#items[end] = item;
    if (this.#size < this.capacity) this.#size++;
    else this.#start = (this.#start + 1) % this.capacity;
  }

  /** Oldest first. */
  toArray(): T[] {
    const out = new Array<T>(this.#size);
    for (let i = 0; i < this.#size; i++) out[i] = this.#items[(this.#start + i) % this.capacity] as T;
    return out;
  }

  /** The newest `n` items, oldest first. */
  last(n: number): T[] {
    const all = this.toArray();
    return all.slice(Math.max(0, all.length - n));
  }

  clear(): void {
    this.#items = new Array(this.capacity);
    this.#start = 0;
    this.#size = 0;
  }
}

const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0").toUpperCase()).join(" ");
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const i32 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);

const READ_NAMES: Record<number, string> = {
  [READ.GLOBALS]: "pedal settings",
  [READ.USER_IRS]: "user IR names",
  [READ.SNAPTONES]: "SnapTone names",
  [READ.PRESET_NAMES]: "preset names",
  [READ.CURRENT_PATCH]: "active preset",
  [READ.CURRENT_SLOT]: "active slot",
  [READ.MODIFIED]: "unsaved-edits flag",
  [READ.EXPORT_PRESET]: "stored preset",
};

const LIST_NAMES: Record<string, string> = { presets: "Preset names", snaptones: "SnapTone names", irs: "User IR names" };

/** Param name lookup (block storage index, algId) → "Gain"; the store passes the active preset's models. */
export type ParamNamer = (block: number, index: number) => string | undefined;
/** Model of the connected pedal (picks the effect catalog for model names); null = unknown. */
export type DeviceGetter = () => DeviceKey | null;

const blockName = (b: number) => BLOCKS[b] ?? `Block ${b}`;
const blockList = (blocks: number[]) => (blocks.length ? blocks.map(blockName).join(" ") : "none");

/** "Global Monitor level -20" / "Global FS3 function Tap tempo" from the model's settings table (unknown model: GP-5's). */
function describeGlobal(a: number, b: number, value: number, device: DeviceKey | null): string {
  const table = globalsFor(device === "gp50" ? "gp50" : "gp5") as Record<string, GlobalSpec>;
  const g = Object.values(table).find((x) => x.addr[0] === a && x.addr[1] === b);
  if (!g) return `Global ${a}.${b} ${value}`;
  return `Global ${g.label} ${g.labels?.[value - g.min] ?? value}`;
}

/** One 0x42 record: "Tempo 120 BPM", "EXP target DLY", "Patch volume 50". */
function describeSetting(record: number, value: number): string {
  const field: string | undefined = patchSettingByRecord(record)?.[0];
  switch (field) {
    case "volume":
      return `Patch volume ${value}`;
    case "bpm":
      return `Tempo ${value} BPM`;
    case "on":
      return `EXP ${value ? "on" : "off"}`;
    case "paramMin":
      return `EXP minimum ${value}%`;
    case "paramMax":
      return `EXP maximum ${value}%`;
    case "volPosition":
      return `EXP volume ${value ? "Post" : "Pre"}`;
    case "volMin":
      return `EXP volume minimum ${value}%`;
    case "volMax":
      return `EXP volume maximum ${value}%`;
    case "targetModule":
      return `EXP target ${EXP_TARGETS[value] ?? value}`;
    case "targetParam":
      return `EXP parameter ${value + 1}`;
    default:
      return `Patch setting 0x${record.toString(16)} = ${value}`;
  }
}

/** Host commands that carry their meaning in the payload (the rest decode like device messages). */
function describeCommand(p: Uint8Array, device: DeviceKey | null): string | null {
  switch (p[1]) {
    case CMD.SELECT_PRESET:
      return `Select preset ${u32(p, 2)}`;
    case CMD.SAVE_PRESET:
      return `Save to slot ${u32(p, 2)}`;
    case CMD.RENAME_PRESET:
      return `Rename slot ${u32(p, 2)}`;
    case CMD.WRITE_PRESET:
      return `Write slot ${p[2]}`;
    case CMD.SET_GLOBAL:
      return describeGlobal(p[2], p[3], i32(p, 6), device);
    case CMD.DELETE_PRESET:
      return `Clear slot ${u32(p, 2)}`;
    case CMD.PASTE_PRESET:
      return `Copy slot ${u16(p, 4)} to slot ${u16(p, 2)}`;
    case CMD.MOVE_PRESET:
      return `Move slot ${u32(p, 2)} to slot ${u32(p, 6)}`;
    default:
      return null;
  }
}

interface Decoded {
  type: string;
  block?: number;
  index?: number;
  value?: number;
  enabled?: boolean;
  fxid?: number;
  slot?: number;
  sel?: number;
  list?: string;
  settings?: { record: number; value: number }[];
  fs1?: number[];
  fs2?: number[];
  order?: number[];
  a?: number;
  b?: number;
}

/** Describe one complete logical payload (both directions). `device` picks the catalog; unknown → GP-50 (a superset). */
export function describePayload(p: Uint8Array, dir: "out" | "in", paramName?: ParamNamer, device: DeviceKey | null = null): { text: string; ack: boolean } {
  const kind = p[0];
  const fn = p[1];
  if (kind === KIND.ACK) return { text: "Acknowledged", ack: true };
  if (kind === KIND.GET && dir === "out") {
    const what = READ_NAMES[fn] ?? `selector 0x${fn?.toString(16)}`;
    return { text: fn === READ.EXPORT_PRESET ? `Read ${what} of slot ${u32(p, 2)}` : `Read ${what}`, ack: false };
  }
  const command = kind === KIND.SET && dir === "out" ? describeCommand(p, device) : null;
  if (command) return { text: command, ack: false };
  const msg: Decoded = decodeMessage(p);
  const who = dir === "in" ? "Pedal: " : "";
  const say = (text: string) => ({ text: who + text, ack: false });
  switch (msg.type) {
    case "param": {
      const name = paramName?.(msg.block!, msg.index!) ?? `param ${msg.index}`;
      const v = msg.value!;
      return say(`${blockName(msg.block!)} ${name} ${Number.isInteger(v) ? v : v.toFixed(1)}`);
    }
    case "block":
      return say(`${blockName(msg.block!)} ${msg.enabled ? "on" : "off"}`);
    case "model": {
      const m = modelByFxid(msg.fxid!, device ?? "gp50") as { name?: string } | undefined;
      return say(`${blockName(msg.block!)} model ${m?.name ?? `0x${msg.fxid!.toString(16)}`}`);
    }
    case "patchSetting":
      return say((msg.settings ?? []).map((s) => describeSetting(s.record, s.value)).join(", "));
    case "footswitch":
      return say(`Footswitches FS1 ${blockList(msg.fs1 ?? [])}, FS2 ${blockList(msg.fs2 ?? [])}`);
    case "order":
      return say(`Chain order ${blockList(msg.order ?? [])}`);
    case "global":
      return say(describeGlobal(msg.a!, msg.b!, msg.value!, device));
    case "listChanged":
      return say(`${LIST_NAMES[msg.list!] ?? "A list"} changed`);
    case "slot":
      return { text: `Active slot ${msg.slot}`, ack: false };
    case "presetChanged":
      return { text: "Preset changed on the pedal", ack: false };
    case "reply":
      return { text: `Reply: ${READ_NAMES[msg.sel!] ?? `selector 0x${msg.sel?.toString(16)}`} (${p.length} bytes)`, ack: false };
    default:
      return { text: `Unknown message ${hex(p.subarray(0, 2))}`, ack: false };
  }
}

/** Describe a standard MIDI short message (CC, program change). */
export function describeShort(b: Uint8Array, dir: "out" | "in"): string {
  const status = b[0] & 0xf0;
  if (status === 0xb0) {
    const [num, v] = [b[1], b[2]];
    if (num === CC.PRESET_SELECT) return `${dir === "in" ? "Pedal: " : ""}Select preset ${v}`;
    if (num === CC.PATCH_VOLUME) return `Patch volume ${v}`;
    const block = Object.entries(CC.BLOCK_SWITCH).find(([, n]) => n === num)?.[0];
    if (block) return `${block} ${v >= 64 ? "on" : "off"}`;
    if (num === CC.TUNER) return `Tuner ${v >= 64 ? "on" : "off"}`;
    return `Control change ${num} = ${v}`;
  }
  if (status === 0xc0) return `Program change ${b[1]}`;
  return "MIDI message";
}

export const shortRaw = (b: Uint8Array) => (((b[0] & 0xf0) === 0xb0 ? `CC#${b[1]} ${b[2]}, ` : "") + hex(b));

/**
 * Turns Gp5Session `log(dir, bytes, decoded)` calls into monitor lines. Outgoing multi-frame payloads are
 * reassembled here (the session logs each frame); incoming payloads arrive already reassembled.
 */
export class MidiLogDecoder {
  #tx = new Reassembler();
  #id = 0;
  constructor(
    private paramName?: ParamNamer,
    private device: DeviceGetter = () => null,
  ) {}

  line(dir: string, bytes: Uint8Array, decoded?: unknown, at = Date.now()): MidiLogEntry | null {
    const id = ++this.#id;
    if (dir === "warn") {
      const d = decoded as { type?: string; got?: number } | undefined;
      return { id, at, dir: "warn", text: `Unexpected reply${d?.got !== undefined ? ` length ${d.got}` : ""}`, raw: "", ack: false };
    }
    if (dir === "rx-bad") return { id, at, dir: "bad", text: "Unreadable frame (CRC or length)", raw: `SysEx ${bytes.length} B`, ack: false };
    const d: "out" | "in" = dir === "tx" ? "out" : "in";
    if (bytes[0] !== 0xf0) return { id, at, dir: d, text: describeShort(bytes, d), raw: shortRaw(bytes), ack: false };
    if (d === "in") {
      const msg = decoded as { raw?: Uint8Array } | undefined;
      const payload = msg?.raw ?? parseSysex(bytes)?.payload;
      if (!payload) return { id, at, dir: "bad", text: "Unreadable frame", raw: `SysEx ${bytes.length} B`, ack: false };
      const { text, ack } = describePayload(payload, "in", this.paramName, this.device());
      return { id, at, dir: d, text, raw: `SysEx ${bytes.length} B`, ack };
    }
    const frame = parseSysex(bytes);
    if (!frame) return { id, at, dir: d, text: "SysEx", raw: `SysEx ${bytes.length} B`, ack: false };
    const payload = this.#tx.push(frame);
    if (!payload) return { id, at, dir: d, text: `Frame ${frame.index + 1} of ${frame.total}`, raw: `SysEx ${bytes.length} B`, ack: false };
    const { text, ack } = describePayload(payload, "out", this.paramName, this.device());
    const frames = frame.total > 1 ? ` (${frame.total} frames)` : "";
    return { id, at, dir: d, text: text + frames, raw: `SysEx ${bytes.length} B`, ack };
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
/** 13:51:08.412 */
export function formatLogTime(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatLogLine(e: MidiLogEntry): string {
  const dir = e.dir === "out" ? "Out" : e.dir === "in" ? "In" : e.dir === "bad" ? "Bad" : "Warn";
  return `${formatLogTime(e.at)}  ${dir.padEnd(4)}  ${e.text}${e.raw ? `  [${e.raw}]` : ""}`;
}
