// What the app last read from the RC-10R in a storage session (specs 174, 177), kept on this computer, plus the pure helpers the RC-10R
// screens use: setting checks for a song, memory notes, loop lengths and plain error messages (spec 179). Nothing here writes to the pedal.

import { create } from "zustand";
import type { Rc10rPedalReading } from "@shared/host/rc10r";
import { hasLoops, type Rc10rMemorySummary } from "@shared/rc10r-memory-map";
import { checkRc10rSettings, type Rc10rExpectations, type Rc10rSettingCheck } from "@shared/rc10r-system";
import type { RhythmControls } from "../performance/rhythm-automation";

const STORAGE_KEY = "vltn.rc10r.pedal.v1";

export interface SavedRc10rReading {
  readAt: string;
  reading: Rc10rPedalReading;
}

function load(): SavedRc10rReading | null {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "null") as SavedRc10rReading | null;
    return value && typeof value.readAt === "string" && value.reading && typeof value.reading === "object" ? value : null;
  } catch {
    return null;
  }
}

interface PedalReadingState {
  saved: SavedRc10rReading | null;
  save(reading: Rc10rPedalReading, readAt?: string): void;
}

/** The last reading. A storage session (transfer or read-only) replaces it. */
export const useRc10rPedalReading = create<PedalReadingState>((set) => ({
  saved: load(),
  save(reading, readAt = new Date().toISOString()) {
    const saved = { readAt, reading };
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      /* Kept for this run only. */
    }
    set({ saved });
  },
}));

/** What a song's cues expect from the pedal; break and level only when the song's cues use them. */
export function rc10rExpectations(controls: RhythmControls, uses: { break: boolean; level: boolean }): Rc10rExpectations {
  return {
    channel: controls.channel,
    rhythmStart: controls.start,
    rhythmDivision: controls.division,
    rhythmFill: controls.fill,
    rhythmStop: controls.stop,
    ...(uses.break && controls.break !== undefined ? { rhythmBreak: controls.break } : {}),
    ...(uses.level && controls.level !== undefined ? { rhythmLevel: controls.level } : {}),
  };
}

/** Checks against the saved reading, or null when the pedal's settings have not been read. */
export function rc10rSettingChecks(saved: SavedRc10rReading | null, expected: Rc10rExpectations): Rc10rSettingCheck[] | null {
  const system = saved?.reading.system;
  return system ? checkRc10rSettings(system, expected) : null;
}

/** Song titles by the pedal memory their automatic cues recall. */
export function memoryUsers(songs: readonly { id: string; title: string; settings: Record<string, string> }[]): Map<number, { id: string; title: string }[]> {
  const result = new Map<number, { id: string; title: string }[]>();
  for (const song of songs) {
    let memory: unknown;
    try {
      memory = (JSON.parse(song.settings[":options"] || "{}") as { rhythmAutomation?: { memory?: unknown } }).rhythmAutomation?.memory;
    } catch {
      continue;
    }
    if (typeof memory !== "number" || !Number.isInteger(memory)) continue;
    result.set(memory, [...(result.get(memory) ?? []), { id: song.id, title: song.title }]);
  }
  return result;
}

const seconds = (value: number) => (value >= 10 ? `${Math.round(value)} s` : `${value.toFixed(1)} s`);

/** Warnings before cues or a transfer use a memory (spec 177). */
export function memoryNotes(
  map: readonly Rc10rMemorySummary[] | undefined,
  users: Map<number, { id: string; title: string }[]>,
  memory: number,
  songId?: string,
): string[] {
  const notes: string[] = [];
  const summary = map?.find((entry) => entry.memory === memory);
  if (summary && hasLoops(summary)) {
    const lengths = summary.tracks.filter((track) => track.recorded).map((track) => seconds(track.seconds));
    notes.push(`Memory ${memory} holds loops (${lengths.join(", ")}). The cues only recall it; the loops stay.`);
  }
  const others = (users.get(memory) ?? []).filter((user) => user.id !== songId);
  if (others.length) notes.push(`Memory ${memory} is also used by ${others.map((user) => user.title).join(", ")}.`);
  return notes;
}

/** Length of a looper WAV: stereo 32-bit float at 44.1 kHz after a 44-byte header. */
export const loopSeconds = (bytes: number): number => Math.max(0, bytes - 44) / (44100 * 2 * 4);

export const megabytes = (bytes: number): string => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

/** Plain sentences for the storage errors seen on macOS (spec 179). Unknown messages pass through. */
export function friendlyRc10rError(message: string): string {
  if (/could not be unmounted|resource busy|drive is busy/i.test(message))
    return "macOS says the RC-10R drive is busy. Eject BOSS RC-10R in Finder, then press EXIT on the pedal.";
  if (/Waiting for RC-10R storage/i.test(message)) return "The RC-10R drive hasn't appeared. Keep the pedal on USB, check its screen, then try again.";
  if (/EROFS|read-only file system/i.test(message)) return "The RC-10R drive is read-only. Eject it, reconnect the pedal and try again.";
  if (/volume changed|mounted device changed/i.test(message)) return "A different drive appeared where the RC-10R was. Nothing was written. Reconnect the pedal and start again.";
  if (/ENOENT|no such file/i.test(message)) return "The RC-10R drive disappeared. Check the USB cable, then reconnect.";
  return message;
}

/** The storage-session steps the dialogs show, in order (spec 179). */
export const RC10R_PHASES = [
  ["connecting", "Connecting"],
  ["reading", "Reading"],
  ["backing-up", "Backing up"],
  ["review", "Review"],
  ["writing", "Writing and checking"],
  ["closing", "Ejecting"],
  ["done", "Done"],
] as const;
