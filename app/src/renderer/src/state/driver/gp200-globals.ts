// Pedal settings of the GP-200 family: what a settings UI needs (labels, ranges, enum names) on top of the protocol's
// id table (gp200/lib/protocol.mjs GLOBALS). Facts: static RE of the GP-200 editor 1.8.0 and the models' jacks (the
// GP-200 has 5-pin MIDI and one EXP 2/FS jack, the LT ⅛" TRS MIDI and two EXP/FS jacks, the JR no MIDI jacks). The
// destructive 0x1008 ids (delete User IR, delete SnapTone, reset footswitches) and the full 0x1007 write are no
// settings: nothing here reaches them, and the session refuses them on the wire as well.
import { DESTRUCTIVE_GLOBAL_IDS, GLOBALS, GLOBAL_EQ_INDEX, SELECT_ID, type GlobalName as Gp200GlobalName } from "@/gp200/lib/protocol.mjs";
import { profileFor, type DeviceKey } from "@shared/devices";
import type { GlobalRecord, GlobalSpec } from "../device-types";

export type { Gp200GlobalName };
export type Gp200Globals = Partial<Record<Gp200GlobalName, number>>;

/** One GP-200 setting, shaped like the GP-5 family's GlobalSpec (protocol id instead of a record address). */
export interface Gp200GlobalSpec extends Omit<GlobalSpec, "name" | "addr" | "since"> {
  name: Gp200GlobalName;
  /** 0x1008 id */
  id: number;
  /** The models that have the setting; absent = every model of the family */
  only?: readonly DeviceKey[];
  /** The setting's name on models that call it something else */
  labelOn?: Partial<Record<DeviceKey, string>>;
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
/** Models with MIDI jacks (DIN on the GP-200, TRS on the LT). */
const MIDI_JACKS: readonly DeviceKey[] = ["gp200", "gp200lt"];
const LT: readonly DeviceKey[] = ["gp200lt"];

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
  spec("exp1Mode", { label: "EXP/FS 1 jack", group: "controls", labels: JACK_MODES, only: LT }),
  spec("exp2Mode", { label: "EXP/FS 2 jack", group: "controls", labels: JACK_MODES }),
  // External footswitches: two on the GP-200's EXP 2/FS jack (ids 0x1F, 0x21), four on the LT's two jacks (1-4)
  spec("extFs1", { label: "External footswitch 1", group: "controls", labels: FS_FUNCTIONS, only: LT }),
  spec("extFs2", { label: "External footswitch 2", group: "controls", labels: FS_FUNCTIONS, only: LT }),
  spec("extFs1Tap", { label: "External footswitch 1", labelOn: { gp200lt: "External footswitch 3" }, group: "controls", labels: FS_FUNCTIONS }),
  spec("extFs2Tap", { label: "External footswitch 2", labelOn: { gp200lt: "External footswitch 4" }, group: "controls", labels: FS_FUNCTIONS }),
  spec("midiInSource", { label: "MIDI in", group: "midi", labels: ["DIN/TRS only", "USB only", "Both"], only: MIDI_JACKS }),
  spec("midiInChannelDin", { label: "MIDI in channel (DIN/TRS)", group: "midi", labels: MIDI_IN_CHANNELS, only: MIDI_JACKS }),
  spec("midiInChannelUsb", { label: "MIDI in channel (USB)", group: "midi", labels: MIDI_IN_CHANNELS }),
  spec("midiOutChannelDin", { label: "MIDI out channel (DIN/TRS)", group: "midi", labels: MIDI_OUT_CHANNELS, min: -1, only: MIDI_JACKS }),
  spec("midiOutChannelUsb", { label: "MIDI out channel (USB)", group: "midi", labels: MIDI_OUT_CHANNELS, min: -1 }),
  spec("clockSource", { label: "Tempo clock source", group: "midi", labels: ["Internal", "DIN/TRS only", "USB only", "External", "Mixed"] }),
  spec("clockOutDin", { label: "Send clock (DIN/TRS)", group: "midi", labels: OFF_ON, only: MIDI_JACKS }),
  spec("clockOutUsb", { label: "Send clock (USB)", group: "midi", labels: OFF_ON }),
  spec("displayMode", { label: "Display", group: "display", labels: ["Footswitches", "Patch", "Signal chain"] }),
]);

/** The settings `device` has, named as on that model, in menu order. */
export function gp200SpecsFor(device: DeviceKey): Gp200GlobalSpec[] {
  return GP200_GLOBAL_SPECS.filter((s) => !s.only || s.only.includes(device)).map((s) => (s.labelOn?.[device] ? { ...s, label: s.labelOn[device] } : s));
}

const BY_NAME: Readonly<Record<string, Gp200GlobalSpec>> = Object.fromEntries(GP200_GLOBAL_SPECS.map((s) => [s.name, s]));

/**
 * The spec of a setting the app may change, or a RangeError: unknown names (e.g. a GP-5 setting), settings `device`
 * doesn't have (when given), and anything that would map to the patch select or a destructive id.
 */
export function gp200GlobalSpec(name: string, device?: DeviceKey | null): Gp200GlobalSpec {
  const s = Object.hasOwn(BY_NAME, name) ? BY_NAME[name] : undefined;
  if (!s || s.id === SELECT_ID || DESTRUCTIVE_GLOBAL_IDS.includes(s.id) || (device && s.only && !s.only.includes(device)))
    throw new RangeError(`The ${device ? profileFor(device).name : "GP-200"} has no setting ${name}`);
  return s;
}

/** The value the pedal stores for `value`: whole numbers within the setting's range. */
export function clampGp200Global(name: string, value: number, device?: DeviceKey | null): number {
  const s = gp200GlobalSpec(name, device);
  if (!Number.isFinite(value)) throw new RangeError(`${s.label}: ${value} is not a number`);
  return Math.max(s.min, Math.min(s.max, Math.round(value)));
}

// ------------------------------------------------------------------------------------------- Global EQ

/**
 * The Global EQ the editor starts from until the pedal reports its own (editor 1.8.0 RE; the simulator starts here
 * too): every section on and flat, the low and high cut at their OFF ends, level 50. Order: protocol GLOBAL_EQ_INDEX.
 */
export const GP200_EQ_DEFAULTS: readonly number[] = Object.freeze([1, 19, 0.71, 1, 20, 0.71, 0, 1, 100, 0.71, 0, 1, 500, 0.71, 0, 1, 1600, 0.71, 0, 1, 5000, 0.71, 0, 1, 20000, 0.71, 0, 1, 20001, 0.71, 50]);

/** One Global EQ section with the indices of its values (no Q or gain on the cuts). */
export interface Gp200EqBand {
  label: string;
  en: number;
  freq: number;
  q?: number;
  gain?: number;
}

/** The sections in the editor's order, low to high. */
export const GP200_EQ_BANDS: readonly Gp200EqBand[] = Object.freeze([
  { label: "Low cut", ...GLOBAL_EQ_INDEX.lowCut },
  { label: "Low shelf", ...GLOBAL_EQ_INDEX.lowShelf },
  { label: "Band 1", ...GLOBAL_EQ_INDEX.band1 },
  { label: "Band 2", ...GLOBAL_EQ_INDEX.band2 },
  { label: "Band 3", ...GLOBAL_EQ_INDEX.band3 },
  { label: "Band 4", ...GLOBAL_EQ_INDEX.band4 },
  { label: "High shelf", ...GLOBAL_EQ_INDEX.highShelf },
  { label: "High cut", ...GLOBAL_EQ_INDEX.highCut },
]);

/** Range of one Global EQ value; `off`: the end that switches a cut off. */
export interface Gp200EqSpec {
  min: number;
  max: number;
  step: number;
  unit?: string;
  off?: number;
}

const FREQ = { min: 20, max: 20000, step: 1, unit: "Hz" };

/**
 * Range of Global EQ value `index` (ranges: the GP-200 manual's Global EQ table): 20 Hz to 20 kHz with the low cut OFF
 * below and the high cut OFF above, Q 0.1 to 10, gain ±20 dB, level 0 to 100, switches 0/1. RangeError for the two
 * indices the pedal doesn't use (the cuts have no Q).
 */
export function gp200EqSpec(index: number): Gp200EqSpec {
  if (index === GLOBAL_EQ_INDEX.level) return { min: 0, max: 100, step: 1 };
  if (index === GLOBAL_EQ_INDEX.lowCut.freq) return { ...FREQ, min: 19, off: 19 };
  if (index === GLOBAL_EQ_INDEX.highCut.freq) return { ...FREQ, max: 20001, off: 20001 };
  for (const b of GP200_EQ_BANDS) {
    if (index === b.en) return { min: 0, max: 1, step: 1 };
    if (index === b.freq) return FREQ;
    if (index === b.q) return { min: 0.1, max: 10, step: 0.01 };
    if (index === b.gain) return { min: -20, max: 20, step: 0.1, unit: "dB" };
  }
  throw new RangeError(`The GP-200 has no Global EQ value ${index}`);
}

/** The value the pedal stores for Global EQ value `index`: within its range, on its step. */
export function clampGp200Eq(index: number, value: number): number {
  const s = gp200EqSpec(index);
  if (!Number.isFinite(value)) throw new RangeError(`Global EQ value ${index}: ${value} is not a number`);
  return Number((Math.round(Math.max(s.min, Math.min(s.max, value)) / s.step) * s.step).toFixed(2));
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
