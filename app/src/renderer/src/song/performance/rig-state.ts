import type { Cue } from "./chart";
import { midiCommand } from "./chart";
import { chaseTriggerSet, computeChaseState, type TriggerCc } from "./midi-chase";
import { orderForPedal } from "./midi-pedal-order";
import { actionCommands, DEFAULT_PEDAL_CHANNELS, PEDAL_PROFILES, type PedalProfile } from "./pedal-profiles";
import { manualMemorySlot } from "./pedal-preset-names";
import { parseSongRig, rigExtras, type RigCell, type RigLibrary } from "./rig";

export interface PedalWireState {
  slot?: number;
  enabled?: boolean;
  controls: Record<number, number>;
  at: number;
  source: "sent" | "pedal";
}

export type RigState = Record<string, PedalWireState>;
export type SoloMode = "on" | "off" | "toggle";
export interface RigSolo {
  cells?: Record<string, RigCell>;
  softenBand?: true;
}

export function readRigSolo(value: unknown): RigSolo {
  if (!value || typeof value !== "object") return {};
  const { cells, softenBand } = value as { cells?: unknown; softenBand?: unknown };
  return {
    ...(cells && typeof cells === "object" ? { cells: parseSongRig({ rows: [{ id: "load", cells }] }).rows[0]?.cells ?? {} } : {}),
    ...(softenBand === true ? { softenBand: true } : {}),
  };
}

const GP = ["valeton-gp180", "valeton-gp150"];
const TIMELINE = "strymon-timeline";
const IR = "boss-ir200";
const profileChannel = (library: RigLibrary, id: string, gpChannel: number): number | undefined =>
  library.channels[id] ?? (GP.includes(id) ? gpChannel : DEFAULT_PEDAL_CHANNELS[id]);

export function rigDestinations(library: RigLibrary, gpChannel: number): { profile: PedalProfile; channel: number }[] {
  const profiles = [...PEDAL_PROFILES, ...library.profiles];
  return library.owned.flatMap((id) => {
    const profile = profiles.find((candidate) => candidate.id === id);
    const channel = profileChannel(library, id, gpChannel);
    return profile && channel !== undefined ? [{ profile, channel }] : [];
  });
}

/** Only one owned destination may claim a shared channel. Incoming observations are limited to the GP input. */
export function rigPedalFor(bytes: readonly number[], library: RigLibrary, gpChannel: number, incoming = false): string | undefined {
  const kind = bytes[0] & 0xf0;
  if ((kind !== 0xc0 || bytes.length !== 2) && (kind !== 0xb0 || bytes.length !== 3)) return;
  const candidates = rigDestinations(library, gpChannel).filter(({ channel }) => channel === (bytes[0] & 15) + 1);
  if (candidates.length !== 1) return;
  const id = candidates[0].profile.id;
  if (incoming && !GP.includes(id)) return;
  return id;
}

export function updateRigState(state: RigState, id: string, bytes: readonly number[], at: number, source: PedalWireState["source"]): RigState {
  const previous = state[id];
  const controls = previous?.controls ?? {};
  const kind = bytes[0] & 0xf0;
  if (kind === 0xc0) {
    const slot = (controls[0] ?? 0) * 128 + bytes[1];
    return { ...state, [id]: { ...previous, slot, controls, at, source } };
  }
  const [_, cc, value] = bytes;
  if (controls[cc] === value) return state;
  return { ...state, [id]: { ...previous, controls: { ...controls, [cc]: value },
    ...(id === TIMELINE && cc === 102 ? { enabled: value >= 64 } : {}), at, source } };
}

function ownedMessages(messages: number[][], library: RigLibrary, gpChannel: number): number[][] {
  return messages.filter((bytes) => rigPedalFor(bytes, library, gpChannel) !== undefined);
}

/** Includes the Song load row as the baseline when the timeline has not yet recalled a pedal. */
export function rigResetMessages(cues: Cue[], position: number, startOnly: boolean, library: RigLibrary, gpChannel: number, triggers: TriggerCc[]): number[][] {
  const lasting = chaseTriggerSet(triggers);
  const ready = cues.flatMap((cue) => {
    if (cue.trigger === "load") return [{ ...cue, trigger: undefined, time: -1 }];
    return !startOnly && !cue.trigger ? [cue] : [];
  });
  const messages = computeChaseState(ready, startOnly ? 0 : Math.max(0, position) + 0.002, lasting).map(({ bytes }) => bytes);
  return orderForPedal(ownedMessages(messages, library, gpChannel), gpChannel, (bytes) => bytes);
}

export interface SoloPlan {
  send: number[][];
  switches: number[][];
}

export function soloMessages(options: RigSolo, state: RigState, library: RigLibrary, gpChannel: number): SoloPlan {
  const send: number[][] = [];
  const switches: number[][] = [];
  for (const { profile, channel } of rigDestinations(library, gpChannel)) {
    const id = profile.id;
    // A shared receive channel cannot identify the device that will take the change.
    if (rigPedalFor([0xc0 + channel - 1, 0], library, gpChannel) !== id) continue;
    const fallback = id === TIMELINE ? { extras: [{ action: "mix", value: Math.min(127, (state[id]?.controls[14] ?? 64) + 25) }] }
      : id === IR ? { extras: [{ action: "solo" }] } : undefined;
    const cell: RigCell | undefined = options.cells ? options.cells[id] : fallback;
    if (!cell) continue;
    const preset = profile.actions.find((action) => cell.preset !== undefined && manualMemorySlot(action) === cell.preset);
    if (preset) send.push(...actionCommands(preset, channel).map(midiCommand));
    for (const entry of cell.extras ?? []) {
      const action = rigExtras(profile).find((candidate) => candidate.id === entry.action);
      if (!action || (action.momentary && !((id === IR && action.id === "solo") || (id === "boss-sy200" && action.id === "switch")))) continue;
      const assignment = library.assignments[`${id}:${entry.action}`];
      if (action.assignment && assignment === undefined) continue;
      try {
        const bytes = actionCommands(action, channel, entry.value, assignment).map(midiCommand);
        send.push(...bytes);
        if (action.momentary) switches.push(...bytes);
      } catch { /* A stale value is ignored until the row is corrected. */ }
    }
  }
  return { send: orderForPedal(send, gpChannel, (bytes) => bytes), switches };
}

/** Restores the latest chart value for controls we touched, falling back to the state before Solo. */
export function soloReturn(plan: SoloPlan, here: number[][], before: RigState, library: RigLibrary, gpChannel: number): number[][] {
  const restore: number[][] = [...plan.switches];
  for (const bytes of plan.send) {
    const kind = bytes[0] & 0xf0;
    const id = rigPedalFor(bytes, library, gpChannel);
    if (!id || plan.switches.includes(bytes)) continue;
    if (kind === 0xc0) {
      const prior = here.filter((candidate) => candidate[0] === bytes[0] || (candidate[0] === bytes[0] - 0x10 && [0, 32].includes(candidate[1])));
      if (prior.some((candidate) => candidate[0] === bytes[0])) restore.push(...prior);
      else if (before[id]?.slot !== undefined) {
        const destination = rigDestinations(library, gpChannel).find(({ profile }) => profile.id === id);
        const preset = destination?.profile.actions.find((action) => manualMemorySlot(action) === before[id].slot);
        if (destination && preset) restore.push(...actionCommands(preset, destination.channel).map(midiCommand));
      }
    } else if (kind === 0xb0 && ![0, 32].includes(bytes[1])) {
      const value = here.findLast((candidate) => candidate[0] === bytes[0] && candidate[1] === bytes[1])?.[2]
        ?? before[id]?.controls[bytes[1]] ?? (id === TIMELINE && bytes[1] === 14 ? 64 : undefined);
      if (value !== undefined) restore.push([bytes[0], bytes[1], value]);
    }
  }
  return orderForPedal(restore, gpChannel, (bytes) => bytes);
}
