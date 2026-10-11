import { useId, useMemo, useRef, useState } from "react";
import { gearIncludesCab } from "@shared/tone3000";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_DEVICE, isGp5Family, pedalName } from "@/state/device-model";
import type { DeviceKey } from "@/state/device-types";
import { useTones, type CabIrChoice } from "./store";

/** Opened WAVs are read whole; real IRs are a few hundred KB, so anything this big isn't one. */
const MAX_IR_FILE = 64 * 1024 * 1024;
const NONE = "none";
const FILE = "file";
const CHOOSE = "choose";
const toneValue = (toneId: number) => `tone:${toneId}`;

function valueOf(choice: CabIrChoice | null): string {
  if (!choice) return NONE;
  return choice.kind === "tone" ? toneValue(choice.toneId) : FILE;
}

/**
 * Why a SnapTone for `device` (the connected or last connected pedal) gets no cab IR, or null when one is offered.
 * A capture whose `gears` (TONE3000 gear, NAM gear_type) include the cab needs none; on the GP-200 family CAB plays
 * after the SnapTone, so the cab stays a block there. Before the first connection DEFAULT_DEVICE's rule applies.
 */
export function noCabIrReason(device: DeviceKey | null, ...gears: (string | null | undefined)[]): string | null {
  if (gears.some(gearIncludesCab)) return "The capture includes the cab, so no cab IR goes into the SnapTone.";
  const d = device ?? DEFAULT_DEVICE;
  return isGp5Family(d) ? null : `CAB plays after the SnapTone on the ${pedalName(d)}, so no cab IR goes into the SnapTone.`;
}

/**
 * Cab IR to bake into a SnapTone: none, a downloaded TONE3000 IR, or a WAV from disk. Offered on the GP-5 family only
 * (noCabIrReason), where an engaged SnapTone bypasses CAB.
 */
export function CabIrPicker({ value, onChange, disabled }: { value: CabIrChoice | null; onChange: (choice: CabIrChoice | null) => void; disabled?: boolean }) {
  const records = useTones((s) => s.records);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const hintId = useId();
  const irTones = useMemo(
    () =>
      Object.values(records)
        .filter((r) => r.format === "ir" && r.models.length > 0)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [records],
  );

  const pick = (v: string) => {
    setError(null);
    if (v === CHOOSE) return fileInput.current?.click();
    if (v === NONE) return onChange(null);
    const rec = irTones.find((r) => toneValue(r.tone_id) === v);
    if (rec) onChange({ kind: "tone", toneId: rec.tone_id, name: rec.title });
  };

  const openFile = async (file: File) => {
    if (file.size > MAX_IR_FILE) return setError(`${file.name} is too large for an impulse response.`);
    try {
      onChange({ kind: "file", name: file.name.replace(/\.wav$/i, ""), wav: new Uint8Array(await file.arrayBuffer()) });
    } catch {
      setError(`Couldn't read ${file.name}.`);
    }
  };

  const hint = "An engaged SnapTone bypasses CAB, so the cab has to be inside the SnapTone.";

  return (
    <span className="flex flex-col gap-1">
      <input
        ref={fileInput}
        type="file"
        accept=".wav"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void openFile(file);
        }}
      />
      <Select value={valueOf(value)} onValueChange={pick} disabled={disabled}>
        <SelectTrigger className="h-8 w-56" aria-label="Cab IR baked into the SnapTone" aria-describedby={hintId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No cab IR</SelectItem>
          {irTones.map((r) => (
            <SelectItem key={r.tone_id} value={toneValue(r.tone_id)}>
              {r.title}
            </SelectItem>
          ))}
          {value?.kind === "tone" && !irTones.some((r) => r.tone_id === value.toneId) && <SelectItem value={toneValue(value.toneId)}>{value.name}</SelectItem>}
          {value?.kind === "file" && <SelectItem value={FILE}>{value.name}</SelectItem>}
          <SelectSeparator />
          <SelectItem value={CHOOSE}>Choose a WAV file…</SelectItem>
        </SelectContent>
      </Select>
      <span id={hintId} className="text-[11px] text-pretty text-silkscreen-3">
        {hint}
      </span>
      {error && (
        <span className="text-[11px] text-led-fault" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
