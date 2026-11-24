import { midiCommand } from "./midi-command";

export interface MidiAction {
  id: string;
  label: string;
  commands: string[];
  description?: string;
  value?: { label: string; min: number; max: number; default: number };
  assignment?: string;
  /** A trigger (looper, tap tempo, footswitch press, patch step) rather than a lasting state. Never replayed when starting mid-song. */
  momentary?: boolean;
}
export interface PedalProfile {
  version: 1;
  id: string;
  name: string;
  source: string;
  notes: string;
  actions: MidiAction[];
  license?: { name: string; url: string; text: string };
}
export function actionCommands(action: MidiAction, channel: number, value = action.value?.default ?? 0, assignedCC?: number): string[] {
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) throw new Error("Choose a MIDI channel from 1 to 16.");
  if (action.value && (!Number.isInteger(value) || value < action.value.min || value > action.value.max))
    throw new Error(`Choose ${action.value.label} from ${action.value.min} to ${action.value.max}.`);
  if (action.assignment && (!Number.isInteger(assignedCC) || !((assignedCC! >= 1 && assignedCC! <= 31) || (assignedCC! >= 64 && assignedCC! <= 95))))
    throw new Error("Set the assigned CC number to 1–31 or 64–95, matching the pedal.");
  return action.commands.map((command) => {
    const text = command.replace(/\$(channel|value|cc|msb|lsb)\b/g, (_, key: string) =>
      String(({ channel, value, cc: assignedCC, msb: Math.floor(value / 128), lsb: value % 128 } as Record<string, number | undefined>)[key]),
    );
    midiCommand(text);
    return text;
  });
}

/** Profiles are inert data, bounded and fully validated before storage or use. */
export function parsePedalProfile(text: string): PedalProfile {
  if (text.length > 500_000) throw new Error("Pedal definition is too large (maximum 500 KB).");
  const p = JSON.parse(text) as PedalProfile;
  const string = (s: unknown, max: number) => typeof s === "string" && s.trim().length > 0 && s.length <= max;
  if (
    !p ||
    p.version !== 1 ||
    !string(p.id, 80) ||
    !/^[a-z0-9-]+$/.test(p.id) ||
    ["constructor", "prototype", "__proto__"].includes(p.id) ||
    !string(p.name, 100) ||
    !string(p.source, 500) ||
    typeof p.notes !== "string" ||
    p.notes.length > 4000 ||
    !Array.isArray(p.actions) ||
    !p.actions.length ||
    p.actions.length > 1000
  )
    throw new Error("Invalid pedal definition. Use the version 1 template.");
  const ids = new Set<string>();
  if (p.license && (!string(p.license.name, 100) || !string(p.license.url, 500) || !string(p.license.text, 20000)))
    throw new Error("Invalid profile license metadata.");
  for (const a of p.actions) {
    if (
      !a ||
      !string(a.id, 100) ||
      ids.has(a.id) ||
      !string(a.label, 160) ||
      !Array.isArray(a.commands) ||
      !a.commands.length ||
      a.commands.length > 16 ||
      a.commands.some((c) => typeof c !== "string" || c.length > 300) ||
      (a.assignment !== undefined && !string(a.assignment, 300)) ||
      (a.momentary !== undefined && typeof a.momentary !== "boolean") ||
      (a.description !== undefined && !string(a.description, 1000))
    )
      throw new Error("Invalid or duplicate action in pedal definition.");
    ids.add(a.id);
    if (
      a.value &&
      (!string(a.value.label, 80) ||
        ![a.value.min, a.value.max, a.value.default].every(Number.isInteger) ||
        a.value.min < 0 ||
        a.value.max > 16383 ||
        a.value.min > a.value.max ||
        a.value.default < a.value.min ||
        a.value.default > a.value.max)
    )
      throw new Error("Invalid action value range.");
    for (const c of a.commands) {
      if (c.includes("$cc") && !a.assignment) throw new Error("An assigned CC requires a named pedal setting.");
      if (/\$(value|msb|lsb)\b/.test(c) && !a.value) throw new Error("A variable command requires a value range.");
    }
    for (const value of a.value ? [a.value.min, a.value.max, a.value.default] : [0]) actionCommands(a, 16, value, a.assignment ? 95 : undefined);
  }
  return p;
}
