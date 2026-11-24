// GP-150 and GP-180 cues recall a preset by number, but the player thinks in preset names. These helpers label the recall actions with the
// pedal's own names and write the name into the cue's label, so a later preflight can tell when the slot holds a different sound. The cue's
// bytes never change, which keeps old charts valid.
import { midiCommand, type Cue } from "./chart";
import { actionCommands, DEFAULT_PEDAL_CHANNELS, PEDAL_PROFILES, type MidiAction, type PedalProfile } from "./pedal-profiles";
import type { PedalSettingsFile, PresetEntry } from "@shared/pedal-settings";

export type PresetModel = "gp150" | "gp180";

/** The pedal's preset names, index = slot (the program number the cue sends), and where they came from. */
export interface PresetNames {
  names: string[];
  source: "live" | "cached";
  /** The model the names belong to. Cues recalling another model are not checked against them. */
  model?: PresetModel;
}

const MODEL_NAME: Record<PresetModel, string> = { gp150: "GP-150", gp180: "GP-180" };
const PROFILE_MODEL: Record<string, PresetModel> = { "valeton-gp150": "gp150", "valeton-gp180": "gp180" };
const CUE_LABEL = /^GP-1([58])0: (\d{3}) (.+)$/;

/** The pedal model whose presets a pedal profile recalls, or null for a profile whose memories have no names to read. */
export function presetModelOf(profileId: string): PresetModel | null {
  return Object.hasOwn(PROFILE_MODEL, profileId) ? PROFILE_MODEL[profileId] : null;
}

/** "069" for the memory the pedal shows as number 69 (slot 68). */
export function presetNumber(slot: number): string {
  return String(slot + 1).padStart(3, "0");
}

/** The picker's label for a memory: "069 Crunch Lead", or "Recall memory 069" while no name is known. */
export function presetLabel(slot: number, names: readonly string[]): string {
  const name = names[slot]?.trim();
  return name ? `${presetNumber(slot)} ${name}` : `Recall memory ${presetNumber(slot)}`;
}

/** The label a cue carries: "GP-180: 069 Crunch Lead". The braces that would end the `{label:…}` token are removed. */
export function presetCueLabel(model: PresetModel, slot: number, name: string): string {
  return `${MODEL_NAME[model]}: ${presetNumber(slot)} ${name.replace(/[{}\r\n]/g, " ").trim()}`;
}

/** Names that are in use: live ones win, then the last connection's. Empty when the pedal has never been read. */
export function usablePresetNames(model: PresetModel, live: PresetNames | null, cached: readonly string[]): PresetNames | null {
  if (live?.names.some((n) => n.trim())) return { ...live, model };
  return cached.some((n) => n.trim()) ? { names: [...cached], source: "cached", model } : null;
}

/** The line under the preset list that says where its names came from. */
export function nameSource(names: PresetNames | null, lastConnectedAt: number | null): string {
  if (!names) return "Connect the pedal in the editor to see preset names";
  if (names.source === "live") return "Names read from the pedal just now";
  return lastConnectedAt ? `Names from the last connection on ${new Date(lastConnectedAt).toLocaleDateString()}` : "Names from the last connection";
}

export interface PresetCueTarget {
  slot: number;
  /** The name written into the cue's label, or null when the cue was made without one (or its label no longer matches its bytes). */
  name: string | null;
  model: PresetModel | null;
}

/**
 * The preset a cue recalls: its messages are the banked recall the profile builds, CC0 (bank) then a program change, both on `pedalChannel`
 * (1–16). Null for any other cue.
 */
export function presetCueTarget(cue: Pick<Cue, "messages" | "label">, pedalChannel: number): PresetCueTarget | null {
  const [bank, program] = cue.messages;
  const status = pedalChannel - 1;
  if (cue.messages.length !== 2 || bank[0] !== (0xb0 | status) || bank[1] !== 0 || program[0] !== (0xc0 | status)) return null;
  const slot = bank[2] * 128 + program[1];
  const found = CUE_LABEL.exec(cue.label ?? "");
  // A label whose number disagrees with the bytes was edited by hand; the bytes win and the stale name is ignored.
  if (!found || Number(found[2]) !== slot + 1) return { slot, name: null, model: null };
  return { slot, name: found[3].trim(), model: found[1] === "5" ? "gp150" : "gp180" };
}

/** Side A or B of each TimeLine bank. Other manual presets use one-based memory numbers. */
export function manualPresetNumber(profileId: string, slot: number): string {
  if (profileId !== "strymon-timeline") return presetNumber(slot);
  return String(Math.floor(slot / 2)).padStart(2, "0") + (slot % 2 ? "B" : "A");
}

function recallSlot(messages: readonly number[][]): number | null {
  const program = messages.at(-1);
  if (!program || program.length !== 2 || (program[0] & 0xf0) !== 0xc0) return null;
  const control = 0xb0 | (program[0] & 15);
  const [bank, low] = messages;
  if (messages.length === 1) return program[1];
  if (messages.length > 3 || bank[0] !== control || bank[1] !== 0) return null;
  if (messages.length === 3 && (low[0] !== control || low[1] !== 32 || low[2] !== 0)) return null;
  return bank[2] * 128 + program[1];
}

/** Static memory recalls can be named even when an imported profile uses its own action IDs. */
export function manualMemorySlot(action: MidiAction): number | null {
  if (action.value || action.assignment || action.momentary || action.commands.length > 3 || !action.commands.at(-1)?.startsWith("pc ")) return null;
  try {
    return recallSlot(actionCommands(action, 1).map(midiCommand));
  } catch {
    return null;
  }
}

export function manualMemorySlots(profile: PedalProfile): Set<number> {
  if (presetModelOf(profile.id)) return new Set();
  return new Set(profile.actions.map(manualMemorySlot).filter((slot): slot is number => slot !== null));
}

export function parsePresetList(profile: PedalProfile, text: string): { entries: PresetEntry[]; errors: string[] } {
  const slots = manualMemorySlots(profile);
  const entries = new Map<number, PresetEntry>();
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const match = /^(\d+[AaBb]?)\s+(.+)$/.exec(line.trim());
    const number = match?.[1] ?? "";
    const bank = profile.id === "strymon-timeline" ? /^(\d{1,2})([ab])$/i.exec(number) : null;
    const slot = bank ? Number(bank[1]) * 2 + Number(bank[2].toUpperCase() === "B") : Number(number) - 1;
    const name = match?.[2].trim() ?? "";
    if (!slots.has(slot) || !name || name.length > 32 || entries.has(slot)) {
      errors.push(`Line ${i + 1}: ${line}`);
      return;
    }
    entries.set(slot, { slot, name });
  });
  return { entries: [...entries.values()], errors };
}

export interface ManualPresetProfile {
  id: string;
  name: string;
  channel: number;
  slots: ReadonlySet<number>;
  entries: ReadonlyMap<number, PresetEntry>;
}

export function manualPresetProfiles(library: Pick<PedalSettingsFile, "presets" | "profiles" | "channels">): ManualPresetProfile[] {
  return [...PEDAL_PROFILES, ...library.profiles].flatMap((profile) => {
    const slots = manualMemorySlots(profile);
    if (!slots.size) return [];
    return [
      {
        id: profile.id,
        name: profile.name,
        channel: library.channels[profile.id] ?? DEFAULT_PEDAL_CHANNELS[profile.id] ?? 1,
        slots,
        entries: new Map((library.presets[profile.id] ?? []).map((entry) => [entry.slot, entry])),
      },
    ];
  });
}

const cueText = (value: string) => value.replace(/[{}\r\n]/g, " ").trim();

export function manualPresetCueLabel(profile: Pick<PedalProfile, "id" | "name">, slot: number, name: string): string {
  return `${cueText(profile.name)}: ${manualPresetNumber(profile.id, slot)} ${cueText(name)}`;
}

/** An explicit profile label wins. Without a label, the bytes must identify exactly one named profile on the cue's channel. */
export function manualPresetCueTarget(cue: Pick<Cue, "label" | "messages">, profiles: readonly ManualPresetProfile[]) {
  const slot = recallSlot(cue.messages);
  if (slot === null) return null;
  const channel = (cue.messages[0][0] & 15) + 1;
  const label = cue.label ?? "";
  if (/^(?:Valeton )?GP-1[58]0:/.test(label)) return null;
  const byLabel = profiles.filter((profile) => label.startsWith(`${cueText(profile.name)}: `));
  const candidates = byLabel.length ? byLabel : profiles.filter((profile) => profile.channel === channel);
  const matches = candidates.filter((profile) => profile.slots.has(slot) && (profile.id !== "strymon-timeline" || cue.messages.length > 1));
  if (matches.length !== 1) return null;
  const profile = matches[0];
  const prefix = manualPresetCueLabel(profile, slot, "");
  const name = label.startsWith(prefix) ? label.slice(prefix.length).trim() : "";
  return { profile, slot, saved: name || null, current: profile.entries.get(slot) };
}

/** Read the current name without rewriting the chart's recorded name or MIDI bytes. */
export function displayPresetCue(cue: Pick<Cue, "label" | "messages">, profiles: readonly ManualPresetProfile[]): string | undefined {
  const target = manualPresetCueTarget(cue, profiles);
  return target?.current ? manualPresetCueLabel(target.profile, target.slot, target.current.name) : cue.label;
}
