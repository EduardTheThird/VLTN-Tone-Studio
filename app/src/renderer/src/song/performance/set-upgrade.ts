import { trackKey, trackKindOf, type LibrarySong } from "@shared/song-library";
import { CURRENT_ENGINE, WHOLE_SONG_ID, parseBandSettings, type BandSettings, type RenderedKind } from "../band/arrangement";
import { GENERATED_PART_NAMES } from "../band/generated-names";
import { parseSections } from "./sections";
import { parseChart } from "./chart";
import type { MidiMacro } from "./midi-macros";
import { presetCueLabel, presetCueTarget, type PresetNames } from "./pedal-preset-names";

export interface SetUpgradeOptions {
  updateBand: boolean;
  warmBass: boolean;
  nameCues: boolean;
}
export const DEFAULT_SET_UPGRADE: SetUpgradeOptions = { updateBand: true, warmBass: false, nameCues: false };

/** The saved options, read strictly so a damaged song is reported instead of replaced with defaults. */
export function upgradeSongOptions(song: LibrarySong): Record<string, unknown> {
  const value: unknown = JSON.parse(song.settings[":options"] || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The song's saved options cannot be read.");
  return value as Record<string, unknown>;
}

export interface SetUpgradePlan {
  settings: BandSettings;
  generated: RenderedKind[];
  render: boolean;
  band: string;
  bass: string;
  warm: boolean;
}

/** Plans only mechanical changes. A generated track must actually exist; rendered parts are always excluded. */
export function planSetUpgrade(song: LibrarySong, options: SetUpgradeOptions): SetUpgradePlan {
  const saved = upgradeSongOptions(song);
  const settings = parseBandSettings(saved.band);
  const keys = savedGeneratedKeys(song);
  const generated = (["drums", "bass"] as const).filter((kind) => settings.parts[kind] && !settings.rendered[kind] && keys[kind] !== undefined);
  const update = options.updateBand && generated.length > 0 && settings.engine < CURRENT_ENGINE;
  const warm = options.warmBass && generated.includes("bass") && settings.bassTone.kind === "clean";
  return {
    settings: { ...settings, ...(update ? { engine: CURRENT_ENGINE } : {}), ...(warm ? { bassTone: { kind: "builtin", id: "warm" } as const } : {}) },
    generated: [...generated],
    render: update || warm,
    band: !generated.length ? "Skipped: No generated parts" : !options.updateBand ? "Skipped: Not selected" : update ? "To do" : "Skipped: Already current",
    bass: !options.warmBass
      ? "Skipped: Not selected"
      : !generated.includes("bass")
        ? "Skipped: No generated bass"
        : warm
          ? "To do"
          : "Skipped: Bass already has a tone",
    warm,
  };
}

export interface CueNaming {
  names: PresetNames;
  channel: number;
}

/** Relabels whole cue lines only when the label unambiguously belongs to that preset. MIDI tokens remain byte for byte intact. */
export function relabelPresetCues(chart: string, known: readonly CueNaming[], macros: readonly MidiMacro[] = []) {
  const before = parseChart(chart, macros);
  const lines = chart.split("\n");
  let renamed = 0;
  let unnamed = 0;
  const byLine = new Map<number, typeof before>();
  for (const cue of before) {
    const line = cue.source?.line ?? cue.line?.index;
    if (line !== undefined) byLine.set(line, [...(byLine.get(line) ?? []), cue]);
  }
  for (const [line, cues] of byLine) {
    const replacements: string[] = [];
    for (const cue of cues) {
      for (const { names, channel } of known) {
        if (!names.model) continue;
        const target = presetCueTarget(cue, channel);
        if (!target || target.name) continue;
        // A legacy label may identify its model even though it has no preset name.
        if (cue.label?.includes("GP-150") && names.model !== "gp150") continue;
        if (cue.label?.includes("GP-180") && names.model !== "gp180") continue;
        const name = names.names[target.slot]?.trim();
        if (name) replacements.push(presetCueLabel(names.model, target.slot, name));
        else unnamed++;
        break;
      }
    }
    if (!replacements.length) continue;
    // Labels apply to every cue on a line. Never attach one preset's name to a different command on that line.
    if (replacements.length !== cues.length || new Set(replacements).size !== 1) {
      unnamed += replacements.length;
      continue;
    }
    const text = lines[line];
    const commentAt = text.search(/(^|\s)\/\//);
    const code = commentAt < 0 ? text : text.slice(0, commentAt);
    const comment = commentAt < 0 ? "" : text.slice(commentAt);
    const label = `{label:${replacements[0]}}`;
    lines[line] = /\{label:[^}]*\}/.test(code)
      ? code.replace(/\{label:[^}]*\}/g, label) + comment
      : code.slice(0, code.trimEnd().length) + " " + label + code.slice(code.trimEnd().length) + comment;
    renamed += replacements.length;
  }
  const next = lines.join("\n");
  const after = parseChart(next, macros);
  // Check the actual parsed messages too, including expanded macros and bank-select slots above 128.
  if (JSON.stringify(before.map(({ messages }) => messages)) !== JSON.stringify(after.map(({ messages }) => messages)))
    throw new Error("Cue names could not be updated without changing MIDI messages.");
  return { chart: next, renamed, unnamed };
}

/** Reminders only. No musical decision here is applied by the upgrade. */
export function setUpgradeReminders(song: LibrarySong, first: boolean) {
  const saved = upgradeSongOptions(song);
  const settings = parseBandSettings(saved.band);
  const sections = parseSections(saved.sections);
  const rows = sections.length ? sections : [{ id: WHOLE_SONG_ID, name: "Whole song" }];
  const automatic = rows.filter(({ id }) => settings.sections[id]?.fill === undefined || settings.sections[id]?.shape === undefined).map(({ name }) => name);
  const loops = sections.filter((section) => section.mode === "loop" || section.mode === "repeat-once").map((section) => section.name);
  const endings = { hit: "Hit", hold: "Fill and hold", hits: "Three hits", slow: "Slow down", none: "None" };
  return [
    { text: `Key: confirm ${song.key || "the song's key"} in Performance → This song`, tab: "parts" as const },
    {
      text: `Room and Kit: ${Math.round(settings.drumRoom * 100)}% · ${settings.kit === undefined ? "Automatic" : settings.kit === "rock" ? "Standard, heavier" : "Standard"}`,
      tab: "feel" as const,
    },
    { text: `Ending: ${endings[settings.ending.kind]}`, tab: "feel" as const },
    {
      text: `${first ? "Count-in on the first song" : "Count-in after a pause"}: ${settings.countIn.bars ? `${settings.countIn.bars} bar(s), ${settings.countIn.sound}` : "Off"}`,
      tab: "feel" as const,
    },
    { text: `Fill and Shape left on Auto: ${automatic.join(", ") || "None"}`, tab: "parts" as const },
    { text: `Loop sections: ${loops.join(", ") || "None"} — choose in This song → Sections → At the end`, tab: "parts" as const },
    { text: `Bar marks: ${settings.marks.length} saved — check stops, fills and hits`, tab: "notes" as const },
  ];
}

/** The generated track keys present in a saved song. Kept independent of the live song store. */
export function savedGeneratedKeys(song: LibrarySong): Partial<Record<RenderedKind, string>> {
  const saved = upgradeSongOptions(song).generatedParts;
  if (!saved || typeof saved !== "object") return {};
  const record = saved as Record<string, unknown>;
  return Object.fromEntries(
    (["drums", "bass"] as const).flatMap((kind) => {
      const track = song.audio.find((audio) => trackKey(audio) === record[kind] && trackKindOf(audio) === "user" && audio.name === GENERATED_PART_NAMES[kind]);
      return track ? [[kind, trackKey(track)]] : [];
    }),
  );
}
