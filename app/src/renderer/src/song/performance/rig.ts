import { lrcTime, midiCommand, parseChart, expandSectionCues, type Cue } from "./chart";
import { managedChartBlock, replaceManagedChart } from "./managed-chart";
import type { MidiMacro } from "./midi-macros";
import { actionCommands, DEFAULT_PEDAL_CHANNELS, PEDAL_PROFILES, type MidiAction, type PedalProfile } from "./pedal-profiles";
import { manualMemorySlot, manualPresetNumber, presetModelOf } from "./pedal-preset-names";
import { sortedSections, type Section } from "./sections";
import type { PedalSettingsFile } from "@shared/pedal-settings";
import { RHYTHM_PEDAL_ID } from "./rhythm-automation";

export const RIG_MARKERS = {
  begin: "// Rig: begin",
  end: "// Rig: end",
  error: "The Rig cue markers were edited. Restore their begin/end lines in Lyrics & chords before rebuilding.",
};

const MAX_ROWS = 200;
const EMPTY = "—";
export interface RigExtra {
  action: string;
  value?: number;
}
export interface RigCell {
  preset?: number;
  extras?: RigExtra[];
}
export interface RigRow {
  id: string;
  time?: number;
  cells: Record<string, RigCell>;
}
export interface SongRig {
  lead: number;
  rows: RigRow[];
  block?: string;
  keepChart?: true;
}
export interface DisplayRigRow extends RigRow {
  label: string;
  at: number | null;
}

export type RigLibrary = Pick<PedalSettingsFile, "profiles" | "presets" | "owned" | "channels" | "assignments">;
export type RigNames = Partial<Record<string, readonly string[]>>;

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const supportedId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]{1,80}$/.test(value) && value !== "constructor" && value !== "prototype";
const sectionId = (id: string) => `section:${id}`;
const clip = (text: string) => text.replace(/[{}\r\n]/g, " ").replace(/\/\//g, "/ ").trim();
const labelOf = (profile: PedalProfile) => profile.name.replace(/^Valeton |^BOSS |^Strymon /, "");

export function parseSongRig(value: unknown): SongRig {
  const raw = record(value) ? value : {};
  const rows = new Map<string, RigRow>();
  for (const row of Array.isArray(raw.rows) ? raw.rows.slice(0, MAX_ROWS) : []) {
    if (!record(row) || typeof row.id !== "string" || row.id.length > 160 || !record(row.cells)) continue;
    if (row.id !== "load" && !row.id.startsWith("section:") && !(row.id.startsWith("time:") && finite(row.time) && row.time >= 0)) continue;
    const cells: Record<string, RigCell> = {};
    for (const [pedal, cell] of Object.entries(row.cells)) {
      if (!supportedId(pedal) || pedal === RHYTHM_PEDAL_ID || !record(cell)) continue;
      const preset = finite(cell.preset) && Number.isInteger(cell.preset) && cell.preset >= 0 && cell.preset <= 16_383 ? cell.preset : undefined;
      const extras: RigExtra[] = Array.isArray(cell.extras) ? cell.extras.slice(0, 24).flatMap((extra) => {
        if (!record(extra) || !supportedId(extra.action)) return [];
        const value = finite(extra.value) && Number.isInteger(extra.value) && extra.value >= 0 && extra.value <= 16_383 ? extra.value : undefined;
        return [{ action: extra.action, ...(value !== undefined ? { value } : {}) }];
      }) : [];
      if (preset !== undefined || extras.length) cells[pedal] = { ...(preset !== undefined ? { preset } : {}), ...(extras.length ? { extras } : {}) };
    }
    rows.set(row.id, { id: row.id, ...(finite(row.time) && row.id.startsWith("time:") ? { time: row.time } : {}), cells });
  }
  return {
    lead: finite(raw.lead) ? Math.min(32, Math.max(0, raw.lead)) : 1,
    rows: [...rows.values()],
    ...(typeof raw.block === "string" && raw.block.length <= 500_000 ? { block: raw.block } : {}),
    ...(raw.keepChart === true ? { keepChart: true } : {}),
  };
}

export function rigProfiles(library: RigLibrary): PedalProfile[] {
  const profiles = [...PEDAL_PROFILES, ...library.profiles];
  const ids = library.owned.length ? library.owned : profiles.filter((profile) => library.channels[profile.id] !== undefined).map((profile) => profile.id);
  return ids.flatMap((id) => profiles.filter((profile) => profile.id === id));
}

export function rigRows(rig: SongRig, sections: readonly Section[]): DisplayRigRow[] {
  const saved = new Map(rig.rows.map((row) => [row.id, row]));
  const rows: DisplayRigRow[] = [
    { id: "load", label: "Song load", at: null, cells: saved.get("load")?.cells ?? {} },
    ...sortedSections(sections).map((section) => ({
      id: sectionId(section.id), label: section.name, at: section.start, cells: saved.get(sectionId(section.id))?.cells ?? {},
    })),
    ...rig.rows.flatMap((row) => row.time === undefined ? [] : [{ ...row, label: lrcTime(row.time), at: row.time }]),
  ];
  return rows.sort((a, b) => (a.at ?? -1) - (b.at ?? -1));
}

export function withRigRow(rig: SongRig, row: RigRow): SongRig {
  return { ...rig, rows: [...rig.rows.filter((saved) => saved.id !== row.id), row] };
}

export function rigPresets(profile: PedalProfile, library: RigLibrary, names: RigNames): { slot: number; label: string; action: MidiAction }[] {
  const manual = new Map((library.presets[profile.id] ?? []).map((entry) => [entry.slot, entry.name]));
  return profile.actions.flatMap((action) => {
    const slot = manualMemorySlot(action);
    if (slot === null) return [];
    const name = names[profile.id]?.[slot]?.trim() || manual.get(slot)?.trim();
    const number = presetModelOf(profile.id) ? String(slot + 1).padStart(3, "0") : manualPresetNumber(profile.id, slot);
    return [{ slot, label: name ? `${number} ${name}` : number, action }];
  });
}

export function rigExtras(profile: PedalProfile): MidiAction[] {
  const ids = profile.id;
  if (ids === RHYTHM_PEDAL_ID) return [];
  return profile.actions.filter((action) => {
    if (ids === "strymon-timeline") return ["engage", "bypass", "division", "mix"].includes(action.id);
    if (ids === "boss-sy200") return ["switch", "effect-level"].includes(action.id);
    if (ids === "boss-ir200") return ["solo", "level", "solo-level"].includes(action.id);
    if (presetModelOf(ids)) return /^module-\d+-(on|off)$/.test(action.id) || ["patch-mode", "stomp-mode"].includes(action.id);
    return manualMemorySlot(action) === null;
  });
}

const displayCell = (pedal: PedalProfile, label: string) => `${labelOf(pedal)} ${label}`;
export function rigSummaries(rig: SongRig, sections: readonly Section[], library: RigLibrary, names: RigNames): { at: number; label: string }[] {
  if (rig.keepChart) return [];
  const profiles = rigProfiles(library).map((profile) => ({
    profile,
    presets: new Map(rigPresets(profile, library, names).map((entry) => [entry.slot, entry.label])),
    extras: new Map(rigExtras(profile).map((entry) => [entry.id, entry])),
  }));
  return rigRows(rig, sections).flatMap((row) => {
    if (row.at === null) return [];
    const label = profiles.flatMap(({ profile, presets, extras }) => {
      const cell = row.cells[profile.id];
      if (!cell) return [];
      const preset = cell.preset === undefined ? undefined : presets.get(cell.preset);
      const extraLabels = (cell.extras ?? []).flatMap((extra) => {
        const action = extras.get(extra.action);
        return action && (!action.assignment || library.assignments[`${profile.id}:${action.id}`] !== undefined) ? [action.label] : [];
      });
      const labels = [preset, ...extraLabels].filter(Boolean);
      return labels.length ? [displayCell(profile, labels.join(", "))] : [];
    }).join(" · ");
    return [{ at: row.at, label }];
  });
}

export function rigChartChanged(rig: SongRig, chart: string): boolean {
  return (rig.block ?? "") !== managedChartBlock(chart, RIG_MARKERS);
}

export function buildRig(rig: SongRig, chart: string, library: RigLibrary, names: RigNames, sections: readonly Section[], bpm: number, beats: number) {
  const profiles = [...PEDAL_PROFILES, ...library.profiles];
  const line = (commands: string[], label: string, at: number | null, noChase: boolean) =>
    `${at === null ? "" : lrcTime(at) + " "}{label:${clip(label)}}${noChase && at !== null ? " {nochase}" : ""} ${commands.map((c) => `{midi${at === null ? "@load" : ""}:${c}}`).join(" ")}`;
  const warnings: string[] = [];
  const body = rigRows(rig, sections).flatMap((row) => {
    const labels: string[] = [];
    const commands: string[] = [];
    const triggers: string[] = [];
    let recoversPreset = false;
    for (const [id, cell] of Object.entries(row.cells)) {
      const profile = profiles.find((pedal) => pedal.id === id);
      if (!profile || id === RHYTHM_PEDAL_ID) continue;
      const channel = library.channels[id] ?? DEFAULT_PEDAL_CHANNELS[id];
      if (channel === undefined) {
        warnings.push(`${profile.name} needs a MIDI channel for ${row.label}.`);
        continue;
      }
      const preset = cell.preset === undefined ? undefined : rigPresets(profile, library, names).find((entry) => entry.slot === cell.preset);
      const details: string[] = [];
      if (preset) {
        commands.push(...actionCommands(preset.action, channel));
        details.push(preset.label);
        recoversPreset = true;
      }
      for (const entry of cell.extras ?? []) {
        const action = rigExtras(profile).find((option) => option.id === entry.action);
        if (!action) continue;
        const assigned = library.assignments[`${id}:${action.id}`];
        if (action.assignment && assigned === undefined) {
          warnings.push(`${profile.name} ${action.label} needs ${action.assignment} assigned for ${row.label}.`);
          continue;
        }
        const dest = action.momentary ? triggers : commands;
        dest.push(...actionCommands(action, channel, entry.value, assigned));
        details.push(action.label + (action.value && entry.value !== undefined ? ` ${entry.value}` : ""));
      }
      if (details.length) labels.push(displayCell(profile, details.join(", ")));
    }
    if (!commands.length && !triggers.length) return [];
    const early = recoversPreset && row.id.startsWith("section:") ? (60 / (bpm > 0 ? bpm : 120)) * Math.min(Math.max(1, beats), rig.lead) : 0;
    const at = row.at === null ? null : Math.max(0, row.at - early);
    const label = `Rig: ${row.label} — ${labels.join(", ")}`;
    const data = JSON.stringify({ id: row.id, ...(row.time !== undefined ? { time: row.time } : {}), cells: row.cells });
    // A separate no-chase line is needed only when a row mixes a lasting command with a momentary switch.
    const head = line(commands.length ? commands : triggers, label, at, !commands.length);
    const tail = commands.length && triggers.length ? [line(triggers, `Rig: ${row.label} switches`, at, true)] : [];
    return [`${head} // Rig row ${data}`, ...tail];
  });
  const block = body.length ? [RIG_MARKERS.begin, ...body, RIG_MARKERS.end].join("\n") : "";
  if (block) parseChart(block);
  return { chart: replaceManagedChart(chart, block, RIG_MARKERS), block, warnings };
}

export function rigRowsFromBlock(chart: string): RigRow[] {
  const rows: unknown[] = [];
  for (const line of managedChartBlock(chart, RIG_MARKERS).split("\n")) {
    const at = line.indexOf(" // Rig row ");
    if (at < 0) continue;
    try { rows.push(JSON.parse(line.slice(at + " // Rig row ".length))); } catch { /* Ordinary or edited chart line. */ }
  }
  return parseSongRig({ rows }).rows;
}

export function importRigCues(rig: SongRig, chart: string, library: RigLibrary, sections: readonly Section[], macros: readonly MidiMacro[] = []) {
  const handChart = replaceManagedChart(chart, "", RIG_MARKERS);
  const profiles = rigProfiles(library).filter((profile) => profile.id !== RHYTHM_PEDAL_ID);
  const candidates = profiles.flatMap((profile) => {
    const channel = library.channels[profile.id] ?? DEFAULT_PEDAL_CHANNELS[profile.id];
    return channel === undefined ? [] : rigPresets(profile, library, {}).map(({ slot, action }) => ({
      profile, slot, bytes: actionCommands(action, channel).map(midiCommand),
    }));
  });
  const unmatched: string[] = [];
  let imported = 0;
  let updated = rig;
  const banks = new Map<number, number>();
  const ordered = expandSectionCues(parseChart(handChart, macros), sections).slice().sort((a, b) => Number(b.trigger === "load") - Number(a.trigger === "load") || a.time - b.time);
  for (const cue of ordered) {
    if (cue.trigger && cue.trigger !== "load") continue;
    for (let i = 0; i < cue.messages.length; i++) {
      const bytes = cue.messages[i];
      const channel = bytes[0] & 15;
      if ((bytes[0] & 0xf0) === 0xb0 && bytes[1] === 0) banks.set(channel, bytes[2]);
      if ((bytes[0] & 0xf0) !== 0xc0) continue;
      const same = (a: readonly number[], b: readonly number[]) => a.join(",") === b.join(",");
      const matching = candidates.filter(({ bytes: recall }) => {
        if (!same(recall[recall.length - 1], bytes)) return false;
        if (recall.length === 1) return true;
        if (recall.length === 2) return (banks.get(channel) ?? 0) === recall[0][2];
        const prior = cue.messages.slice(i + 1 - recall.length, i + 1);
        return prior.length === recall.length && prior.every((message, index) => same(message, recall[index]));
      });
      const labelled = matching.filter(({ profile }) => (cue.label ?? "").startsWith(profile.name + ":") || (cue.label ?? "").startsWith(labelOf(profile) + ":"));
      const matches = labelled.length ? labelled : matching;
      if (matches.length !== 1) {
        unmatched.push(cue.label ?? (cue.trigger === "load" ? "Song load" : lrcTime(cue.time)));
        continue;
      }
      const { profile, slot } = matches[0];
      const section = sortedSections(sections).find((entry) => Math.abs(entry.start - cue.time) <= 0.06);
      const id = cue.trigger === "load" ? "load" : section ? sectionId(section.id) : `time:${cue.time}`;
      const row = updated.rows.find((entry) => entry.id === id) ?? { id, ...(id.startsWith("time:") ? { time: cue.time } : {}), cells: {} };
      const cell = row.cells[profile.id];
      if (cell?.preset !== undefined && cell.preset !== slot) {
        unmatched.push(cue.label ?? lrcTime(cue.time));
        continue;
      }
      updated = withRigRow(updated, { ...row, cells: { ...row.cells, [profile.id]: { ...cell, preset: slot } } });
      imported++;
    }
  }
  return { rig: updated, imported, unmatched };
}

export function rigCueConflicts(cues: readonly Cue[]): string[] {
  const type = (bytes: number[]) => bytes[0] & 0xf0;
  const sets = (cue: Cue) => new Set(cue.messages.flatMap((bytes) => type(bytes) === 0xc0 || type(bytes) === 0xb0 ? [bytes[0] & 15] : []));
  const managed = cues.filter((cue) => cue.rig);
  const manual = cues.filter((cue) => !cue.rig);
  return managed.flatMap((own) => {
    const channels = sets(own);
    const clashes = manual.some((cue) => cue.trigger === own.trigger && (cue.trigger === "load" || Math.abs(cue.time - own.time) <= 0.01)
      && [...sets(cue)].some((channel) => channels.has(channel)));
    return clashes ? [`${own.label ?? "Rig cue"} shares a pedal channel with a handwritten cue at the same time.`] : [];
  }).filter((warning, index, all) => all.indexOf(warning) === index);
}

export function rigSetupWarnings(rig: SongRig, library: RigLibrary, sections: readonly Section[]): string[] {
  const profiles = [...PEDAL_PROFILES, ...library.profiles];
  return [...new Set(rigRows(rig, sections).flatMap((row) => Object.entries(row.cells).flatMap(([id, cell]) => {
    const profile = profiles.find((pedal) => pedal.id === id);
    if (!profile) return [`Rig pedal ${id} has no profile.`];
    const channel = library.channels[id] ?? DEFAULT_PEDAL_CHANNELS[id];
    const controls = rigExtras(profile);
    return [
      ...(channel === undefined ? [`Rig pedal ${profile.name} needs a MIDI channel.`] : []),
      ...(cell.extras ?? []).flatMap(({ action }) => {
        const control = controls.find((item) => item.id === action);
        return control?.assignment && library.assignments[`${id}:${action}`] === undefined ? [`Rig pedal ${profile.name} needs ${control.assignment} assigned.`] : [];
      }),
    ];
  })))];
}

export const noRigChange = EMPTY;
