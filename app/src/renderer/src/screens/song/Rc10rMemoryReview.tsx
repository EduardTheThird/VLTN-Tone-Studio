import { useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inspectRc10rRhythmMemory, type Rc10rRhythmMemory } from "@shared/rc10r-memory";
import { compareRc10rMemory, RC10R_KITS, RC10R_PLAY_MODES, RC10R_STOP_MODES, type Rc10rMemorySetup } from "@/song/performance/rc10r-memory-setup";

export function Rc10rMemoryReview({ memory, value, onChange }: {
  memory: number;
  value: Rc10rMemorySetup;
  onChange(value: Rc10rMemorySetup): void;
}) {
  const [backup, setBackup] = useState<{ memory: number; fields: Rc10rRhythmMemory } | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const selection = useRef(0);
  const read = async (files: FileList | null) => {
    if (!files?.length) return;
    const id = ++selection.current;
    setBackup(null);
    setError("");
    const chosen = Array.from(files);
    const one = chosen.find((file) => file.name.toUpperCase() === "MEMORY1.RC0");
    const two = chosen.find((file) => file.name.toUpperCase() === "MEMORY2.RC0");
    if (!one || !two || chosen.length !== 2) {
      setError("Select MEMORY1.RC0 and MEMORY2.RC0 from the same backup.");
      return;
    }
    if (one.size > 8 * 1024 * 1024 || two.size > 8 * 1024 * 1024) {
      setError("The RC-10R memory files are too large.");
      return;
    }
    setReading(true);
    try {
      const [a, b] = await Promise.all([one.arrayBuffer(), two.arrayBuffer()]);
      const fields = inspectRc10rRhythmMemory(new Uint8Array(a), new Uint8Array(b), memory);
      if (id === selection.current) setBackup({ memory, fields });
    } catch (problem) {
      if (id === selection.current) setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      if (id === selection.current) setReading(false);
    }
  };
  const kitOptions = RC10R_KITS.map((kit) => [kit, kit] as const);
  const choose = <K extends "kit" | "stopMode" | "playMode">(field: K, title: string, options: readonly (readonly [string, string])[]) => (
    <label className="flex flex-col gap-1">
      {title}
      <Select value={value[field]} onValueChange={(choice) => onChange({ ...value, [field]: choice })}>
        <SelectTrigger className="w-44" aria-label={title}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );
  return (
    <details className="rounded border border-seam p-3">
      <summary className="cursor-pointer font-medium">RC-10R memory setup</summary>
      <div className="space-y-2 pt-3">
        <div className="flex flex-wrap gap-3">
          {choose("kit", "Rhythm kit", kitOptions)}
          {choose("stopMode", "Stop mode", Object.entries(RC10R_STOP_MODES))}
          {choose("playMode", "Play mode", Object.entries(RC10R_PLAY_MODES))}
          {([["level", "Rhythm level"], ["reverb", "Rhythm reverb"]] as const).map(([field, label]) => (
            <label key={field} className="flex flex-col gap-1">
              {label}
              <Input className="w-32" aria-label={label} type="number" min={0} max={100} step={1} value={value[field]}
                onChange={(event) => {
                  const next = event.target.valueAsNumber;
                  if (Number.isInteger(next) && next >= 0 && next <= 100) onChange({ ...value, [field]: next });
                }} />
            </label>
          ))}
          <label className="flex items-center gap-2">
            <Checkbox checked={value.intro} onCheckedChange={(on) => onChange({ ...value, intro: on === true })} />
            Rhythm intro
          </label>
        </div>
        <label className="flex max-w-sm flex-col gap-1">
          Compare a backup
          <Input type="file" accept=".rc0" multiple disabled={reading}
            aria-label="RC-10R backup memory files"
            onChange={(event) => {
              void read(event.target.files);
              event.target.value = "";
            }} />
        </label>
        <p className="text-xs text-silkscreen-3">Select MEMORY1.RC0 and MEMORY2.RC0 from one backup. Song settings are saved with the cues.</p>
        {reading && <p role="status">Reading the backup…</p>}
        {error && <p role="alert">{error}</p>}
        {backup?.memory === memory && (
          <table aria-label={`Backup comparison for memory ${memory}`} className="w-full text-left">
            <thead><tr><th>Setting</th><th>Song</th><th>Backup value</th><th>Comparison</th></tr></thead>
            <tbody>
              {compareRc10rMemory(value, backup.fields).map((row) => (
                <tr key={row.field}>
                  <th scope="row">{row.label}</th><td>{row.song}</td><td>{row.raw ?? "—"}</td><td>{row.comparison}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}
