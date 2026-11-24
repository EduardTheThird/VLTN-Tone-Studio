import { TIMELINE_DIVISIONS, TIMELINE_ID } from "@/song/performance/rig-tempo";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/ui/settings-card";
import { usePedalLibrary } from "@/song/performance/pedal-library";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { RHYTHM_PEDAL_ID } from "@/song/performance/rhythm-automation";
import {
  buildRig, importRigCues, rigSummaries, noRigChange, parseSongRig, rigChartChanged, rigExtras, rigPresets, rigProfiles,
  rigRows, withRigRow, type DisplayRigRow, type RigCell, type RigLibrary, type RigNames, type SongRig,
} from "@/song/performance/rig";
import type { PedalProfile } from "@/song/performance/pedal-profiles";
import type { Section } from "@/song/performance/sections";
import { usePlaybackClock } from "@/song/performance/playback-clock";
import { usePresetNames } from "./use-preset-names";

const field = "max-w-full rounded border border-seam bg-background px-2 py-1 text-sm";
const short = (profile: PedalProfile) => profile.name.replace(/^Valeton |^BOSS |^Strymon /, "");
const kind = (name: string) => name.toLowerCase().replace(/\s+\d+$/, "").trim();

function useRigNames(): RigNames {
  const gp180 = usePresetNames("gp180").presetNames?.names;
  const gp150 = usePresetNames("gp150").presetNames?.names;
  return useMemo(() => ({ "valeton-gp180": gp180, "valeton-gp150": gp150 }), [gp150, gp180]);
}

export function RigStageNext({ value, sections, chart }: { value: unknown; sections: readonly Section[]; chart?: string }) {
  const library = usePedalLibrary();
  const names = useRigNames();
  const rig = useMemo(() => parseSongRig(value), [value]);
  const summaries = useMemo(() => {
    if (!rig.rows.length) return [];
    try {
      return chart !== undefined && rigChartChanged(rig, chart) ? [] : rigSummaries(rig, sections, library, names);
    } catch {
      return [];
    }
  }, [rig, sections, library, names, chart]);
  const next = usePlaybackClock((state) => summaries.find((row) => row.at > state.position)?.label ?? "");
  return next ? <span className="text-sm font-medium text-silkscreen-2">Next: {next}</span> : null;
}

function RigCellEditor({
  row, profile, library, names, disabled, memory, onChange,
}: {
  row: DisplayRigRow;
  profile: PedalProfile;
  library: RigLibrary;
  names: RigNames;
  disabled: boolean;
  memory?: number;
  onChange: (cell: RigCell) => void;
}) {
  const presets = useMemo(() => rigPresets(profile, library, names), [profile, library, names]);
  const actions = useMemo(() => rigExtras(profile), [profile]);
  const cell = row.cells[profile.id] ?? {};
  const extras = cell.extras ?? [];
  const title = row.label + " " + short(profile);
  if (profile.id === RHYTHM_PEDAL_ID) {
    return <span aria-label={title + " memory"}>{row.id === "load" && memory !== undefined ? `Memory ${memory}` : noRigChange}</span>;
  }
  const assignment = (id: string) => library.assignments[`${profile.id}:${id}`];
  return (
    <div className="flex min-w-28 flex-col gap-2">
      <select
        className={field}
        aria-label={title + " preset"}
        value={cell.preset ?? ""}
        disabled={disabled || !presets.length}
        onChange={(event) => onChange({ ...cell, preset: event.target.value === "" ? undefined : Number(event.target.value) })}
      >
        <option value="">{noRigChange}</option>
        {presets.map((preset) => <option key={preset.slot} value={preset.slot}>{preset.label}</option>)}
      </select>
      {!!actions.length && (
        <details>
          <summary className="cursor-pointer text-xs" aria-label={title + " extras"}>+ Extras{extras.length > 0 && ` (${extras.length})`}</summary>
          <div className="space-y-2 py-2">
            <select
              className={field}
              aria-label={title + " add extra"}
              disabled={disabled}
              value=""
              onChange={(event) => {
                const action = actions.find((option) => option.id === event.target.value);
                if (action) onChange({ ...cell, extras: [...extras, { action: action.id, value: action.value?.default }] });
              }}
            >
              <option value="">Add a control</option>
              {actions.filter((action) => !extras.some((extra) => extra.action === action.id)).map((action) => (
                <option key={action.id} value={action.id}>{action.label}</option>
              ))}
            </select>
            {extras.map((extra, i) => {
              const action = actions.find((option) => option.id === extra.action);
              if (!action) return null;
              const value = action.value;
              return (
                <div key={extra.action + i} className="flex flex-wrap items-center gap-1">
                  <span className="text-xs">{action.label}</span>
                  {profile.id === TIMELINE_ID && action.id === "division" ? (
                    <select className={field} aria-label={title + " tap division"} value={extra.value ?? value?.default ?? 0}
                      disabled={disabled} onChange={(event) => onChange({ ...cell, extras: extras.map((item, index) =>
                        i === index ? { ...item, value: Number(event.target.value) } : item) })}>
                      {TIMELINE_DIVISIONS.map((label, index) => <option key={label} value={index}>{label}</option>)}
                    </select>
                  ) : value && (
                    <input type="number" min={value.min} max={value.max} className={field + " w-20"} disabled={disabled}
                      aria-label={title + " " + action.label} value={extra.value ?? value.default}
                      onChange={(event) => {
                        const next = event.target.valueAsNumber;
                        if (Number.isInteger(next) && next >= value.min && next <= value.max) {
                          onChange({ ...cell, extras: extras.map((item, index) => i === index ? { ...item, value: next } : item) });
                        }
                      }} />
                  )}
                  <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onChange({ ...cell, extras: extras.filter((_, index) => i !== index) })}>
                    Remove
                  </Button>
                  {!!action.assignment && assignment(action.id) === undefined && (
                    <span className="block w-full text-xs text-led-warn">Needs {action.assignment} set on the pedal and in MIDI setup.</span>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

export function RigTable({
  value, chart, sections, bpm, beats, duration, memory, locked, onSave,
}: {
  value: unknown;
  chart: string;
  sections: readonly Section[];
  bpm: number;
  beats: number;
  duration: number;
  memory?: number;
  locked: boolean;
  onSave: (rig: SongRig, chart: string) => void;
}) {
  const library = usePedalLibrary();
  const names = useRigNames();
  const macros = useMidiConfiguration((state) => state.macros);
  const rig = useMemo(() => parseSongRig(value), [value]);
  const profiles = useMemo(() => rigProfiles(library), [library]);
  const rows = useMemo(() => rigRows(rig, sections), [rig, sections]);
  const [time, setTime] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<DisplayRigRow | null>(null);
  let changed = false;
  let chartWarning = "";
  try { changed = rigChartChanged(rig, chart); } catch (reason) { chartWarning = String((reason as Error).message); }
  const readOnly = locked || !!chartWarning || rig.keepChart === true || changed;
  const save = (next: SongRig, extra?: string) => {
    if (locked) return;
    try {
      const bank = { ...next, keepChart: undefined };
      const built = buildRig(bank, chart, library, names, sections, bpm, beats);
      onSave({ ...bank, block: built.block }, built.chart);
      setNotice([extra, ...built.warnings].filter(Boolean).join(" "));
    } catch (reason) {
      setNotice(String((reason as Error).message));
    }
  };
  const put = (row: DisplayRigRow, cells: Record<string, RigCell>) => save(withRigRow(rig, { id: row.id, time: row.time, cells }));
  return (
    <SettingsCard title="Song Rig table" summary={`${profiles.length} pedals · ${rows.length} rows`} storageKey="song-rig-table">
      <div className="space-y-3 py-2">
        {!profiles.length && <p className="text-sm">Choose your pedals in My rig to add their columns.</p>}
        {chartWarning && <p role="alert">{chartWarning}</p>}
        {!chartWarning && (changed || rig.keepChart) && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{rig.keepChart ? "Using the chart’s version." : "The Rig block was edited in the chart."}</span>
            <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => save(rig)}>Rebuild from table</Button>
            {!rig.keepChart && <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => onSave({ ...rig, keepChart: true }, chart)}>Keep the chart’s version</Button>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            Preset change lead (beats)
            <input aria-label="Preset change lead" type="number" min={0} max={beats} step={0.25} className={field + " w-20"} value={Math.min(beats, rig.lead)} disabled={readOnly}
              onChange={(event) => {
                const lead = event.target.valueAsNumber;
                if (Number.isFinite(lead) && lead >= 0 && lead <= beats) save({ ...rig, lead });
              }} />
          </label>
          <Button type="button" size="sm" variant="outline" disabled={readOnly || !profiles.length} onClick={() => {
            try {
              const imported = importRigCues(rig, chart, library, sections, macros);
              const summary = `Imported ${imported.imported} preset recalls.${imported.unmatched.length ? ` Could not place ${imported.unmatched.join(", ")}.` : ""}`;
              if (imported.imported) save(imported.rig, summary);
              else setNotice(summary);
            } catch (reason) { setNotice(String((reason as Error).message)); }
          }}>Make a Rig table from this song’s cues</Button>
          {!changed && !rig.keepChart && rig.rows.some((row) => Object.keys(row.cells).length > 0) &&
            <Button type="button" size="sm" variant="outline" disabled={readOnly} onClick={() => save(rig)}>Rebuild cues</Button>}
        </div>
        {!!profiles.length && (
          <div className="overflow-x-auto rounded border border-seam">
            <table className="w-full text-left text-sm" aria-label="Song Rig">
              <thead><tr><th className="p-2">Moment</th>{profiles.map((profile) => <th key={profile.id} className="p-2">{short(profile)}</th>)}<th className="p-2">Row actions</th></tr></thead>
              <tbody>
                {rows.map((row, index) => {
                  const previous = row.id.startsWith("section:")
                    ? rows.slice(0, index).findLast((candidate) => candidate.id.startsWith("section:") && kind(candidate.label) === kind(row.label))
                    : undefined;
                  return (
                    <tr key={row.id} className="border-t border-seam align-top">
                      <th className="p-2 font-medium">{row.label}</th>
                      {profiles.map((profile) => (
                        <td key={profile.id} className="p-2">
                          <RigCellEditor row={row} profile={profile} library={library} names={names} disabled={readOnly}
                            memory={memory} onChange={(cell) => put(row, { ...row.cells, [profile.id]: cell })} />
                        </td>
                      ))}
                      <td className="p-2">
                        <div className="flex min-w-32 flex-wrap gap-1">
                          <Button size="xs" variant="outline" disabled={readOnly} onClick={() => setCopied(row)}>Copy row</Button>
                          {copied && copied.id !== row.id && <Button size="xs" variant="outline" disabled={readOnly} onClick={() => put(row, copied.cells)}>Paste row</Button>}
                          {previous && <Button size="xs" variant="outline" disabled={readOnly} onClick={() => put(row, previous.cells)}>Same as {previous.label}</Button>}
                          <Button size="xs" variant="outline" disabled={readOnly} onClick={() => put(row, {})}>Clear row</Button>
                          {row.time !== undefined && <Button size="xs" variant="ghost" disabled={readOnly} onClick={() => save({ ...rig, rows: rig.rows.filter((entry) => entry.id !== row.id) })}>Remove row</Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-end gap-2">
          <label className="grid gap-1 text-sm">
            Time (seconds)
            <input aria-label="Rig row time" className={field + " w-28"} type="number" min={0} max={duration} step={0.01}
              disabled={readOnly} value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
          <Button type="button" size="sm" variant="outline" disabled={readOnly || !time || Number(time) < 0 || Number(time) > duration || rows.length >= 200}
            onClick={() => {
              const at = Number(time);
              const id = `time:${at}`;
              if (!rows.some((row) => row.id === id)) save(withRigRow(rig, { id, time: at, cells: {} }));
              setTime("");
            }}>Add a row at a time</Button>
        </div>
        {notice && <p role="status" className="text-sm">{notice}</p>}
      </div>
    </SettingsCard>
  );
}
