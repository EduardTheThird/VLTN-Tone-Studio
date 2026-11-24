import type { PedalSettingsFile } from "@shared/pedal-settings";
import type { LibrarySong } from "@shared/song-library";
import { midiCommand, type Cue } from "./chart";
import type { MidiMacro } from "./midi-macros";
import { actionCommands, DEFAULT_PEDAL_CHANNELS, PEDAL_PROFILES, type MidiAction, type PedalProfile } from "./pedal-profiles";
import { manualMemorySlot, manualPresetNumber, presetModelOf, type PresetNames } from "./pedal-preset-names";
import { rhythmControlOverrides, rhythmSongOptions } from "./rhythm-automation";
import type { RigFacts } from "./rig-check";
import { midiFileFromOptions } from "./smf";
import { songCues } from "./song-cues";

type OwnedLibrary = Pick<PedalSettingsFile, "owned" | "profiles" | "channels">;
type RigLibrary = OwnedLibrary & Pick<PedalSettingsFile, "assignments" | "presets">;
type RigSong = Pick<LibrarySong, "title" | "duration" | "settings">;

export interface RigLine {
  id: string;
  text: string;
}
export interface OwnedPedal {
  profile: PedalProfile;
  channel: number;
}
export interface RigCard extends OwnedPedal {
  lines: RigLine[];
  recall: { label: string; action: MidiAction }[];
}
export interface RigSetup {
  cards: RigCard[];
  chain: string[];
  skippedSongs: string[];
}

export function pedalGroups(library: OwnedLibrary) {
  const profiles = [...PEDAL_PROFILES, ...library.profiles];
  return {
    owned: library.owned.flatMap((id) => profiles.filter((profile) => profile.id === id)),
    other: profiles.filter((profile) => !library.owned.includes(profile.id)),
  };
}

export function ownedPedalChannels(library: OwnedLibrary): OwnedPedal[] {
  return pedalGroups(library).owned.map((profile) => ({
    profile,
    channel: library.channels[profile.id] ?? DEFAULT_PEDAL_CHANNELS[profile.id] ?? 1,
  }));
}

export function gpReceiveChannel(facts: RigFacts | null | undefined): number | undefined {
  if (facts?.device !== "gp180" || !facts.transport) return undefined;
  return facts.globals[facts.transport === "system" ? "midiInChannelUsb" : "midiInChannelBt"];
}

/** Checks configured destinations and the GP-180's physical receive channel when the editor has read it. */
export interface RigChannelIssue {
  code: string;
  text: string;
  channel?: number;
}

export function rigChannelIssues(pedals: readonly OwnedPedal[], gpChannel?: number): RigChannelIssue[] {
  const byChannel = new Map<number, string[]>();
  for (const { profile, channel } of pedals) {
    const names = byChannel.get(channel) ?? [];
    names.push(profile.name);
    byChannel.set(channel, names);
  }
  const issues: RigChannelIssue[] = [...byChannel].flatMap(([channel, names]) =>
    names.length < 2 ? [] : [{ code: "rig-channel-collision", channel, text: `MIDI channel ${channel} is shared by ${names.join(", ")}.` }],
  );
  const downstream = pedals.filter(({ profile }) => profile.id !== "valeton-gp180");
  if (gpChannel === 0)
    issues.push({ code: "rig-gp-omni", text: "The GP-180 is on Omni. Set a dedicated receive channel so downstream commands cannot change its preset." });
  if (gpChannel && downstream.some(({ channel }) => channel === gpChannel))
    issues.push({
      code: "rig-gp-shared",
      text: `The GP-180 receives on channel ${gpChannel}, shared with ${downstream
        .filter(({ channel }) => channel === gpChannel)
        .map(({ profile }) => profile.name)
        .join(", ")}.`,
    });
  return issues;
}

function cuePedal(cue: Cue, channel: number, pedals: readonly OwnedPedal[]): OwnedPedal | undefined {
  const label = cue.label ?? "";
  const named = pedals.find(({ profile }) => label.startsWith(profile.name + ":") || label.startsWith(profile.name.replace(/^Valeton /, "") + ":"));
  if (named && (named.channel === channel || cue.messages.every((bytes) => bytes[0] >= 0xf0 || (bytes[0] & 15) + 1 === channel))) return named;
  const matches = pedals.filter((pedal) => pedal.channel === channel);
  return matches.length === 1 ? matches[0] : undefined;
}

function recallActions(profile: PedalProfile): Map<number, MidiAction> {
  return new Map(
    profile.actions.flatMap((action): [number, MidiAction][] => {
      const slot = manualMemorySlot(action);
      return slot === null ? [] : [[slot, action]];
    }),
  );
}

function linesFor(profile: PedalProfile, channel: number, clock: boolean): RigLine[] {
  const { id } = profile;
  const lines = [{ id: "channel", text: `MIDI receive channel ${channel}.` }];
  if (id === "strymon-timeline") {
    lines.push({ id: "pc", text: "Enable MIDI Patch Change." }, { id: "cc", text: "Enable MIDI CC." });
    if (clock) lines.push({ id: "clock", text: "Enable MIDI Clock reception." });
  }
  if (id === "boss-sy200" || id === "boss-ir200") {
    lines.push(
      { id: "pc", text: "Enable PC IN. Set the MIDI PC map to send PC#1 to memory 1, PC#2 to memory 2, and so on." },
      { id: "cc", text: "Enable CC IN." },
      { id: "cable", text: "Use a Type A TRS MIDI cable." },
    );
    if (id === "boss-sy200" && clock) lines.push({ id: "clock", text: "Set SYNC to AUTO." });
  }
  if (id === "valeton-gp180" || id === "valeton-gp150") lines.push({ id: "route", text: "Check the input source and receive channel in Pedal settings." });
  if (id === "boss-rc10r") lines.push({ id: "route", text: "Check rhythm controls and routing on the RC-10R drums card." });
  return lines;
}

export function myRig(library: RigLibrary, songs: readonly RigSong[], macros: readonly MidiMacro[], liveNames?: PresetNames): RigSetup {
  const pedals = ownedPedalChannels(library);
  const requirements = new Map(
    pedals.map(({ profile }) => [
      profile.id,
      {
        presets: new Set<number>(),
        assignments: new Map<string, RigLine>(),
        clock: false,
      },
    ]),
  );
  const skippedSongs: string[] = [];
  const rhythmControls = rhythmControlOverrides(library);
  let clock = false;
  for (const song of songs) {
    const { settings, duration } = song;
    const options = rhythmSongOptions({ key: "", ...song });
    const follows = options.clock === true;
    clock ||= follows;
    if (follows) {
      for (const id of ["strymon-timeline", "boss-sy200"]) {
        const pedal = requirements.get(id);
        if (pedal) pedal.clock = true;
      }
    }
    const { cues, error } = songCues(settings[""] ?? "", macros, midiFileFromOptions(options), { settings, duration, rhythmControls });
    if (error) {
      skippedSongs.push(song.title);
      continue;
    }
    const banks = new Map<number, number>();
    for (const cue of cues) {
      for (const bytes of cue.messages) {
        const channel = (bytes[0] & 15) + 1;
        const status = bytes[0] & 0xf0;
        if (status !== 0xb0 && status !== 0xc0) continue;
        if (status === 0xb0 && bytes[1] === 0) banks.set(channel, bytes[2]);
        const target = cuePedal(cue, channel, pedals);
        if (!target) continue;
        const { profile } = target;
        const needed = requirements.get(profile.id)!;
        if (status === 0xc0) {
          needed.presets.add((banks.get(channel) ?? 0) * 128 + bytes[1]);
          continue;
        }
        for (const action of profile.actions) {
          if (!action.assignment) continue;
          const assigned = library.assignments[`${profile.id}:${action.id}`];
          const fromLabel = cue.label?.includes(`: ${action.label}`) ?? false;
          if (assigned !== bytes[1] && !fromLabel) continue;
          const id = `assign:${action.id}:${bytes[1]}`;
          needed.assignments.set(id, { id, text: `${action.assignment} → ${bytes[1]}.` });
        }
      }
    }
  }
  const cards = pedals.map(({ profile, channel }) => {
    const needed = requirements.get(profile.id)!;
    const actions = recallActions(profile);
    const used = [...needed.presets].filter((slot) => actions.has(slot));
    const names = new Map((library.presets[profile.id] ?? []).map((entry) => [entry.slot, entry.name]));
    const hardwareNames = liveNames?.model === presetModelOf(profile.id) ? liveNames?.names : undefined;
    const label = (slot: number) => {
      const number = manualPresetNumber(profile.id, slot);
      const name = hardwareNames?.[slot] || names.get(slot);
      return name ? `${number} ${name}` : number;
    };
    const lines = linesFor(profile, channel, needed.clock);
    lines.push(...needed.assignments.values());
    if (used.length) lines.push({ id: "presets", text: `Presets in the library: ${used.map(label).join(", ")}.` });
    const testSlots = [...new Set([...used, ...actions.keys()])].slice(0, 2);
    return { profile, channel, lines, recall: testSlots.map((slot) => ({ action: actions.get(slot)!, label: label(slot) })) };
  });
  const upstream = pedals.some(({ profile }) => profile.id === "valeton-gp180");
  const chain = upstream
    ? [
        "Connect the computer to the GP-180 over USB or Bluetooth MIDI.",
        ...(pedals.length > 1 ? ["Set GP-180 FS jack to MIDI OUT. Connect its TRS MIDI output to the downstream pedals."] : []),
        ...(pedals.length > 1 && clock ? ["Set GP-180 Send clock (TRS) to On. Check that clock reaches the downstream pedals."] : []),
      ]
    : ["Connect the selected MIDI output to the pedals and match each receive channel."];
  return { cards, chain, skippedSongs };
}

export function rigToggle(card: RigCard, library: Pick<RigLibrary, "assignments">): number[][][] | null {
  const { profile, channel } = card;
  const ids = profile.id === "strymon-timeline" ? ["engage", "bypass"] : profile.id === "boss-sy200" ? ["switch", "switch"] : [];
  if (!ids.length) return null;
  try {
    return ids.map((id) => {
      const action = profile.actions.find((action) => action.id === id)!;
      return actionCommands(action, channel, undefined, library.assignments[`${profile.id}:${id}`]).map(midiCommand);
    });
  } catch {
    return null;
  }
}

/** A checked line belongs to its exact instruction. New or edited instructions require a new check. */
export function rigCheckedAt(line: RigLine, marks: Record<string, { text: string; at: string }>): string | undefined {
  const stored = marks[line.id];
  return stored?.text === line.text ? stored.at : undefined;
}
