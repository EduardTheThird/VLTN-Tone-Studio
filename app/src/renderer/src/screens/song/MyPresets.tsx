import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { manualMemorySlots, manualPresetNumber, parsePresetList } from "@/song/performance/pedal-preset-names";
import { usePedalLibrary } from "@/song/performance/pedal-library";
import { PEDAL_PROFILES, type PedalProfile } from "@/song/performance/pedal-profiles";
import type { PresetEntry } from "@shared/pedal-settings";

const input = "rounded border border-seam bg-background px-2 py-1";

/** The song library's editable memory names for pedals that do not supply live names. */
export function MyPresets({ disabled }: { disabled: boolean }) {
  const imported = usePedalLibrary((s) => s.profiles);
  const saveError = usePedalLibrary((s) => s.saveError);
  const [id, setId] = useState("strymon-timeline");
  const [open, setOpen] = useState(false);
  const profiles = useMemo(() => [...PEDAL_PROFILES, ...imported].filter((profile) => manualMemorySlots(profile).size > 0), [imported]);
  const profile = profiles.find((item) => item.id === id) ?? profiles[0];
  return (
    <details className="space-y-2 rounded border border-seam p-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer">My presets</summary>
      <label className="flex items-center gap-2">
        Pedal for preset names
        <select className={input} value={profile.id} onChange={(event) => setId(event.target.value)}>
          {profiles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {open && <PresetTable key={profile.id} profile={profile} disabled={disabled} />}
      {saveError && (
        <p role="alert">
          {saveError}{" "}
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() =>
              void usePedalLibrary
                .getState()
                .flush()
                .catch(() => {})
            }
          >
            Retry saving
          </Button>
        </p>
      )}
    </details>
  );
}

function PresetTable({ profile, disabled }: { profile: PedalProfile; disabled: boolean }) {
  const presets = usePedalLibrary((s) => s.presets[profile.id]);
  const slots = useMemo(() => [...manualMemorySlots(profile)].sort((a, b) => a - b), [profile]);
  const entries = useMemo(() => new Map((presets ?? []).map((preset) => [preset.slot, preset])), [presets]);
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof parsePresetList> | null>(null);
  const [error, setError] = useState("");
  const save = (changed: PresetEntry[]) => {
    try {
      usePedalLibrary.getState().savePresets(profile.id, changed);
      setError("");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  return (
    <>
      <div className="max-h-60 overflow-auto">
        <table className="w-full text-left" aria-label="Preset names">
          <thead>
            <tr>
              <th>Memory</th>
              <th>Name</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => {
              const number = manualPresetNumber(profile.id, slot);
              const entry = entries.get(slot);
              const name = entry?.name ?? "";
              const note = entry?.note ?? "";
              return (
                <tr key={slot}>
                  <th scope="row">{number}</th>
                  <td>
                    <input
                      className={input}
                      key={name}
                      aria-label={`Name for ${number}`}
                      defaultValue={name}
                      disabled={disabled}
                      maxLength={32}
                      onBlur={(event) => {
                        if (event.target.value.trim() !== name) save([{ slot, name: event.target.value, note }]);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className={input}
                      key={note}
                      aria-label={`Note for ${number}`}
                      defaultValue={note}
                      disabled={disabled || !name}
                      maxLength={1000}
                      onBlur={(event) => {
                        if (event.target.value.trim() !== note) save([{ slot, name, note: event.target.value }]);
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <label className="block">
        Paste preset names, one memory and name per line
        <textarea
          className={input + " block w-full"}
          value={paste}
          rows={3}
          disabled={disabled}
          maxLength={64_000}
          onChange={(event) => {
            setPaste(event.target.value);
            setPreview(null);
          }}
        />
      </label>
      <Button variant="outline" disabled={disabled || !paste.trim()} onClick={() => setPreview(parsePresetList(profile, paste))}>
        Preview pasted names
      </Button>
      {preview && (
        <div className="space-y-2">
          <ul aria-label="Preset import preview" className="max-h-32 overflow-auto">
            {preview.entries.map(({ slot, name }) => (
              <li key={slot}>
                {manualPresetNumber(profile.id, slot)} {name}
              </li>
            ))}
          </ul>
          {preview.errors.length > 0 && (
            <ul aria-label="Unrecognised lines" className="max-h-32 overflow-auto">
              {preview.errors.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <Button
            disabled={disabled || !preview.entries.length}
            onClick={() => {
              const changed = preview.entries.map((entry) => ({ ...entry, note: entries.get(entry.slot)?.note }));
              if (save(changed)) {
                setPreview(null);
                setPaste("");
              }
            }}
          >
            Save preset names
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
