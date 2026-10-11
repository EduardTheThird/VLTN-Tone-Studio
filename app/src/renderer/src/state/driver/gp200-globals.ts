// Pedal settings of the GP-200 family: what a settings UI needs (labels, ranges, enum names) on top of the protocol's
// id table (gp200/lib/protocol.mjs GLOBALS). Facts: static RE of the GP-200 editor 1.8.0. The destructive 0x1008 ids
// (delete User IR, delete SnapTone, reset footswitches) and the full 0x1007 write are no settings: nothing here
// reaches them, and the session refuses them on the wire as well.
import { DESTRUCTIVE_GLOBAL_IDS, GLOBALS, SELECT_ID, type GlobalName as Gp200GlobalName, type Gp200FamilyKey } from "@/gp200/lib/protocol.mjs";
import type { GlobalRecord, GlobalSpec } from "../device-types";

export type { Gp200GlobalName };
export type Gp200Globals = Partial<Record<Gp200GlobalName, number>>;

/** One GP-200 setting, shaped like the GP-5 family's GlobalSpec (protocol id instead of a record address). */
export interface Gp200GlobalSpec extends Omit<GlobalSpec, "name" | "addr" | "since"> {
  name: Gp200GlobalName;
  /** 0x1008 id */
  id: number;
  /** Models that have the setting; absent = every model of the family */
  only?: readonly Gp200FamilyKey[];
}

const OFF_ON = ["Off", "On"] as const;
const JACK_MODES = ["Expression pedal", "Single footswitch", "Double footswitch"] as const;
const MIDI_IN_CHANNELS = ["Omni", ...Array.from({ length: 16 }, (_, i) => String(i + 1))];
const MIDI_OUT_CHANNELS = ["Off", ...MIDI_IN_CHANNELS];
/** External footswitch functions (0x1A/0x1C/0x1F/0x21 values). */
const FS_FUNCTIONS = [
  "None",
  "CTRL 1",
  "CTRL 2",
  "CTRL 3",
  "CTRL 4",
  "Looper",
  "Drum",
  "Tuner",
  "Tap tempo",
  "Bank up",
  "Bank down",
  "Patch up",
  "Patch down",
  "Patch A",
  "Patch B",
  "Patch C",
  "Patch D",
  "Bank",
  "Drum pattern up",
  "Drum pattern down",
  "EXP 1 A/B",
  "MIDI",
  "Bypass",
  "CTRL 5",
  "CTRL 6",
  "CTRL 7",
  "CTRL 8",
] as const;

type SpecInput = Omit<Gp200GlobalSpec, "name" | "id" | "kind" | "min" | "max"> & ({ min: number; max: number } | { labels: readonly string[]; min?: number });

function spec(name: Gp200GlobalName, s: SpecInput): Gp200GlobalSpec {
  const id = GLOBALS[name].id;
  if ("labels" in s && s.labels) {
    const min = s.min ?? 0;
    return { ...s, name, id, kind: "enum", min, max: min + s.labels.length - 1 };
  }
  return { ...(s as Omit<Gp200GlobalSpec, "name" | "id" | "kind">), name, id, kind: "number" };
}

const level = (label: string, group: GlobalSpec["group"]): SpecInput => ({ label, group, min: -20, max: 20, unit: "dB" });

/** Every setting the GP-200 family reports, in menu order. */
export const GP200_GLOBAL_SPECS: readonly Gp200GlobalSpec[] = Object.freeze([
  spec("inputLevel", level("Input level", "audio")),
  spec("inputMode", { label: "Input mode", group: "audio", labels: ["A.GT (acoustic)", "E.GT (electric)", "Line"] }),
  spec("noCabL", { label: "No cab, left output", group: "audio", labels: OFF_ON }),
  spec("noCabR", { label: "No cab, right output", group: "audio", labels: OFF_ON }),
  spec("globalEq", { label: "Global EQ", group: "audio", labels: OFF_ON }),
  spec("autoCabMatch", { label: "Auto cab match", group: "audio", labels: OFF_ON }),
  spec("usbRecLevel", level("USB record level", "recording")),
  spec("usbMonitorLevel", level("USB monitor level", "recording")),
  spec("recModeL", { label: "Record mode, left", group: "recording", labels: ["Dry", "Effect"] }),
  spec("recModeR", { label: "Record mode, right", group: "recording", labels: ["Dry", "Effect"] }),
  spec("auxToUsb", { label: "AUX in to USB", group: "recording", labels: OFF_ON }),
  spec("fsMode", { label: "Footswitch mode", group: "controls", labels: ["Preset", "Stomp", "User"] }),
  spec("bankSelectMode", { label: "Bank select", group: "controls", labels: ["Wait for a patch", "Direct"] }),
  spec("exp1AB", { label: "EXP 1 A/B", group: "controls", labels: ["A", "B"] }),
  spec("exp1Mode", { label: "EXP/FS 1 jack", group: "controls", labels: JACK_MODES, only: ["gp200lt"] }),
  spec("exp2Mode", { label: "EXP/FS 2 jack", group: "controls", labels: JACK_MODES }),
  spec("extFs1", { label: "External footswitch 1", group: "controls", labels: FS_FUNCTIONS }),
  spec("extFs2", { label: "External footswitch 2", group: "controls", labels: FS_FUNCTIONS }),
  spec("extFs1Tap", { label: "External footswitch 1, second function", group: "controls", labels: FS_FUNCTIONS }),
  spec("extFs2Tap", { label: "External footswitch 2, second function", group: "controls", labels: FS_FUNCTIONS }),
  spec("midiInSource", { label: "MIDI in", group: "midi", labels: ["DIN/TRS only", "USB only", "Both"] }),
  spec("midiInChannelDin", { label: "MIDI in channel (DIN/TRS)", group: "midi", labels: MIDI_IN_CHANNELS }),
  spec("midiInChannelUsb", { label: "MIDI in channel (USB)", group: "midi", labels: MIDI_IN_CHANNELS }),
  spec("midiOutChannelDin", { label: "MIDI out channel (DIN/TRS)", group: "midi", labels: MIDI_OUT_CHANNELS, min: -1 }),
  spec("midiOutChannelUsb", { label: "MIDI out channel (USB)", group: "midi", labels: MIDI_OUT_CHANNELS, min: -1 }),
  spec("clockSource", { label: "Tempo clock source", group: "midi", labels: ["Internal", "DIN/TRS only", "USB only", "External", "Mixed"] }),
  spec("clockOutDin", { label: "Send clock (DIN/TRS)", group: "midi", labels: OFF_ON }),
  spec("clockOutUsb", { label: "Send clock (USB)", group: "midi", labels: OFF_ON }),
  spec("displayMode", { label: "Display", group: "display", labels: ["Footswitches", "Patch", "Signal chain"] }),
]);

const BY_NAME: Readonly<Record<string, Gp200GlobalSpec>> = Object.fromEntries(GP200_GLOBAL_SPECS.map((s) => [s.name, s]));

/** The settings of `device` (the LT has a second EXP/FS jack). */
export function gp200GlobalsFor(device: Gp200FamilyKey): Gp200GlobalSpec[] {
  return GP200_GLOBAL_SPECS.filter((s) => !s.only || s.only.includes(device));
}

/**
 * The spec of a setting the app may change, or a RangeError: unknown names (e.g. a GP-5 setting) and anything that
 * would map to the patch select or a destructive id.
 */
export function gp200GlobalSpec(name: string): Gp200GlobalSpec {
  const s = Object.hasOwn(BY_NAME, name) ? BY_NAME[name] : undefined;
  if (!s || s.id === SELECT_ID || DESTRUCTIVE_GLOBAL_IDS.includes(s.id)) throw new RangeError(`The GP-200 has no setting ${name}`);
  return s;
}

export function isGp200GlobalName(name: string): name is Gp200GlobalName {
  return Object.hasOwn(BY_NAME, name);
}

/** The value the pedal stores for `value`: whole numbers within the setting's range. */
export function clampGp200Global(name: string, value: number): number {
  const s = gp200GlobalSpec(name);
  if (!Number.isFinite(value)) throw new RangeError(`${s.label}: ${value} is not a number`);
  return Math.max(s.min, Math.min(s.max, Math.round(value)));
}

const WIDTH = { u8: 1, u16: 2, i16: 2 } as const;

/** Diagnostics records of a 0x1007/0x1006 reply: a = 0x1008 id, b = byte offset in 0x1007 (-1: kept in the patch). */
export function gp200GlobalRecords(values: Gp200Globals): GlobalRecord[] {
  return (Object.keys(GLOBALS) as Gp200GlobalName[])
    .filter((name) => values[name] !== undefined)
    .map((name) => {
      const g = GLOBALS[name];
      return { a: g.id, b: g.off ?? -1, len: WIDTH[g.type], value: values[name] as number };
    });
}
