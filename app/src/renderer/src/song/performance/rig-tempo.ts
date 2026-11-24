import type { PedalSettingsFile } from "@shared/pedal-settings";
import type { Cue } from "./chart";
import { DEFAULT_PEDAL_CHANNELS } from "./pedal-profiles";

export const TIMELINE_ID = "strymon-timeline";
export const TIMELINE_DIVISIONS = ["Quarter", "Dotted eighth", "Eighth", "Triplet", "Sixteenth"] as const;
const CLOCK_PEDALS = [TIMELINE_ID, "boss-sy200", "boss-rc10r"];
const TEMPO_PEDALS = ["valeton-gp180", "valeton-gp150"];
type TempoLibrary = Pick<PedalSettingsFile, "owned" | "tempoFollow" | "channels">;

export interface SongRigTempo {
  enabled: true;
  noClock?: true;
  timelineDivision?: number;
}

export const supportsRigTempo = (id: string): boolean => CLOCK_PEDALS.includes(id) || TEMPO_PEDALS.includes(id);

export function readRigTempo(value: unknown): SongRigTempo | null {
  if (!value || typeof value !== "object") return null;
  const settings = value as Record<string, unknown>;
  if (settings.enabled !== true) return null;
  const division = settings.timelineDivision;
  return { enabled: true, ...(settings.noClock === true ? { noClock: true } : {}),
    ...(typeof division === "number" && Number.isInteger(division) && division >= 0 && division < TIMELINE_DIVISIONS.length ? { timelineDivision: division } : {}) };
}

export interface RigTempoPlan {
  clock: boolean;
  wantsClock: string[];
  timeline?: { status: number; following: boolean; division?: number };
  gpTempo: boolean;
  gpChannel?: number;
}

export function rigTempoPlan(settings: SongRigTempo | null, library: TempoLibrary): RigTempoPlan | null {
  if (!settings) return null;
  const follows = (id: string) => library.owned.includes(id) && library.tempoFollow?.[id] !== false;
  const wantsClock = CLOCK_PEDALS.filter(follows);
  const gp = TEMPO_PEDALS.find(follows);
  const timeline = library.owned.includes(TIMELINE_ID) ? {
    status: 0xb0 + (library.channels[TIMELINE_ID] ?? DEFAULT_PEDAL_CHANNELS[TIMELINE_ID]) - 1,
    following: follows(TIMELINE_ID),
    division: settings.timelineDivision,
  } : undefined;
  return { clock: !settings.noClock && wantsClock.length > 0, wantsClock, timeline, gpTempo: gp !== undefined, gpChannel: gp ? library.channels[gp] : undefined };
}

export function rigClockWarnings(plan: RigTempoPlan | null, clock: boolean): string[] {
  if (!plan?.wantsClock.length || clock) return [];
  const names = { "strymon-timeline": "TimeLine", "boss-sy200": "SY-200", "boss-rc10r": "RC-10R" };
  return [`Song MIDI clock is off. ${plan.wantsClock.map((id) => names[id as keyof typeof names]).join(", ")} cannot follow the app's clock.`];
}

/** Keeps the chart's load recalls and moves its TimeLine division after the preset and clock switch. */
export function rigTempoCues(cues: Cue[], plan: RigTempoPlan | null): Cue[] {
  const timeline = plan?.timeline;
  if (!timeline) return cues;
  const { status, following } = timeline;
  let division = timeline.division;
  const savedDivisions: number[] = [];
  const orderRecall = (cue: Cue): Cue => {
    if (!cue.messages.some((bytes) => bytes[0] === status + 0x10)) return cue;
    const divisions = cue.messages.filter((bytes) => bytes[0] === status && bytes[1] === 21);
    const chosen = divisions.at(-1) ?? (timeline.division === undefined ? undefined : [status, 21, timeline.division]);
    if (!chosen) return cue;
    return { ...cue, messages: [...cue.messages.filter((bytes) => bytes[0] !== status || bytes[1] !== 21), chosen] };
  };
  const ordered = cues.flatMap((cue) => {
    if (cue.trigger !== "load") return [orderRecall(cue)];
    const messages = cue.messages.filter((message) => {
      if (message[0] !== status) return true;
      if (message[1] === 21) savedDivisions.push(message[2]);
      return message[1] !== 63 && message[1] !== 21;
    });
    if (messages.length === cue.messages.length) return [cue];
    return messages.length ? [{ ...cue, messages }] : [];
  });
  division ??= savedDivisions.at(-1);
  ordered.push({
    time: 0, text: "", trigger: "load", label: "Rig tempo: TimeLine", rig: true, rigTempo: true,
    messages: [[status, 63, Number(following)], ...(division !== undefined ? [[status, 21, division]] : [])],
  });
  return ordered;
}

export function rigTempoLoadKey(cues: readonly Cue[]): string {
  return JSON.stringify(cues.filter((cue) => cue.rigTempo).flatMap((cue) => cue.messages));
}
