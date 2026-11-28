// The RC-10R's global settings (ROLAND/DATA/SYSTEM1.RC0 and SYSTEM2.RC0). The pedal saves the two copies alternately: each is XML
// followed by a four-byte little-endian save counter, and the copy with the higher counter is the current one. Read-only (spec 174).

const decoder = new TextDecoder("utf-8", { fatal: true });
const damaged = () => new Error("The RC-10R settings files have an unsupported layout.");

/** The MIDI fields the app compares, by their XML tag. */
export const RC10R_SYSTEM_CC_FIELDS = {
  rhythmStart: "RhyStrCc",
  rhythmDivision: "RhyDivCc",
  rhythmFill: "RhyFilCc",
  rhythmStop: "RhyStpCc",
  rhythmBreak: "RhybrkCc",
  rhythmLevel: "RhyLvlCc",
  loopStart: "LoopStrCc",
  loopStop: "LoopStpCc",
  loopUndoRedo: "LoopUnRdCc",
} as const;
export type Rc10rSystemCcField = keyof typeof RC10R_SYSTEM_CC_FIELDS;

export interface Rc10rSystemSettings {
  /** Receive channel for rhythm and looper control, 1–16, or null when OFF. */
  controlChannel: number | null;
  /** Receive channel for drum notes (spec 159), 1–16, or null when OFF. */
  noteChannel: number | null;
  /** Transmit channel, 1–16, or null when OFF. */
  transmitChannel: number | null;
  programChangeOut: boolean;
  clockOut: boolean;
  /** Raw SYNC CLOCK value; its menu order is not confirmed yet. */
  syncClock: number;
  /** Decoded CC numbers (1–31 or 64–95), or null when OFF. */
  cc: Record<Rc10rSystemCcField, number | null>;
  /** The save counter of the copy that was read. */
  counter: number;
}

/** The pedal's CC menu lists OFF, CC#1–31, then CC#64–95; the file stores the menu index. */
export function rc10rCcFromIndex(index: number): number | null {
  if (!Number.isInteger(index) || index < 0 || index > 63) throw damaged();
  if (index === 0) return null;
  return index <= 31 ? index : index + 32;
}

function channel(raw: number): number | null {
  if (!Number.isInteger(raw) || raw < 0 || raw > 16) throw damaged();
  return raw === 0 ? null : raw;
}

function parseCopy(bytes: Uint8Array): { midi: Map<string, number>; counter: number } {
  if (bytes.length < 50 || bytes.length > 64 * 1024) throw damaged();
  const xml = decoder.decode(bytes.subarray(0, -4));
  if (!xml.endsWith("</database>\n") || /<!|<\?(?!xml\s)/.test(xml) || !/<database name="RC-10R" revision="0">/.test(xml)) throw damaged();
  const block = /<MIDI>([\s\S]*?)<\/MIDI>/.exec(xml)?.[1];
  if (block === undefined) throw damaged();
  const midi = new Map<string, number>();
  for (const [, tag, value, close] of block.matchAll(/<(\w+)>(\d{1,3})<\/(\w+)>/g)) {
    if (tag !== close || midi.has(tag)) throw damaged();
    midi.set(tag, Number(value));
  }
  const counter = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4).getUint32(0, true);
  return { midi, counter };
}

/** Reads the current copy of the pair. Both copies must parse and agree on every MIDI field. */
export function readRc10rSystemPair(first: Uint8Array, second: Uint8Array): Rc10rSystemSettings {
  const one = parseCopy(first),
    two = parseCopy(second);
  if (one.midi.size !== two.midi.size || [...one.midi].some(([tag, value]) => two.midi.get(tag) !== value))
    throw new Error("The RC-10R's two settings files disagree about MIDI. Save the settings on the pedal, then read again.");
  const current = one.counter >= two.counter ? one : two;
  const get = (tag: string) => {
    const value = current.midi.get(tag);
    if (value === undefined) throw damaged();
    return value;
  };
  const cc = Object.fromEntries(
    Object.entries(RC10R_SYSTEM_CC_FIELDS).map(([key, tag]) => [key, rc10rCcFromIndex(get(tag))]),
  ) as Record<Rc10rSystemCcField, number | null>;
  return {
    controlChannel: channel(get("RxCtrlCh")),
    noteChannel: channel(get("RxNoteCh")),
    transmitChannel: channel(get("TxCtrlCh")),
    programChangeOut: get("PcOut") === 1,
    clockOut: get("ClkOut") === 1,
    syncClock: get("SyncClk"),
    cc,
    counter: current.counter,
  };
}

/** What a song's cues expect from the pedal. Undefined entries are not used by the song and are not checked. */
export interface Rc10rExpectations {
  channel: number;
  rhythmStart: number;
  rhythmDivision: number;
  rhythmFill: number;
  rhythmStop: number;
  rhythmBreak?: number;
  rhythmLevel?: number;
  /** Set when the song asks the pedal to play the app's drum notes. */
  noteChannel?: number;
}

export interface Rc10rSettingCheck {
  id: string;
  label: string;
  ok: boolean;
  pedal: string;
  app: string;
}

const ccText = (value: number | null) => (value === null ? "OFF" : `CC#${value}`);
const channelText = (value: number | null) => (value === null ? "OFF" : `channel ${value}`);

/** One line per setting the song uses: what the pedal has and what the app sends. */
export function checkRc10rSettings(settings: Rc10rSystemSettings, expected: Rc10rExpectations): Rc10rSettingCheck[] {
  const checks: Rc10rSettingCheck[] = [
    {
      id: "channel",
      label: "Control channel (RX CTRL CH)",
      ok: settings.controlChannel === expected.channel,
      pedal: channelText(settings.controlChannel),
      app: channelText(expected.channel),
    },
  ];
  const cc = (id: Rc10rSystemCcField, label: string, value: number | undefined) => {
    if (value === undefined) return;
    checks.push({ id, label, ok: settings.cc[id] === value, pedal: ccText(settings.cc[id]), app: ccText(value) });
  };
  cc("rhythmStart", "Rhythm start", expected.rhythmStart);
  cc("rhythmDivision", "Rhythm division (pattern change)", expected.rhythmDivision);
  cc("rhythmFill", "Rhythm fill", expected.rhythmFill);
  cc("rhythmStop", "Rhythm stop", expected.rhythmStop);
  cc("rhythmBreak", "Rhythm break", expected.rhythmBreak);
  cc("rhythmLevel", "Rhythm level", expected.rhythmLevel);
  if (expected.noteChannel !== undefined)
    checks.push({
      id: "noteChannel",
      label: "Drum notes (RX NOTE CH)",
      ok: settings.noteChannel === expected.noteChannel,
      pedal: channelText(settings.noteChannel),
      app: channelText(expected.noteChannel),
    });
  return checks;
}
