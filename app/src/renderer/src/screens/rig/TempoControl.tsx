import { useEffect, useId, useRef, useState } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDevice, usePedalName } from "@/state/device";
import { editBpm } from "./edits";
import { BPM_MAX, BPM_MIN, clampBpm, tap } from "./tempo";

/** Where a tempo edit goes: live on a GP-50 with extras, else into the preset (reaches the pedal on save). */
function useTempoNote(): string {
  const pedal = usePedalName();
  const live = useDevice((s) => s.features.includes("liveBpm"));
  const locked = useDevice((s) => s.lockedFeatures.includes("liveBpm"));
  if (live) return `Plays on the ${pedal} right away. Save the preset to keep it.`;
  if (locked) return `The ${pedal} gets the new tempo when you save. Turn on GP-50 extras in Settings to hear it right away.`;
  return `The ${pedal} gets the new tempo when you save the preset.`;
}

/** Rig header tempo: the preset's BPM with a field and a tap button; taps are averaged in the app. */
export function TempoControl({ bpm, disabled }: { bpm: number; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(bpm));
  const taps = useRef<number[]>([]);
  const inputId = useId();
  const note = useTempoNote();

  useEffect(() => setDraft(String(bpm)), [bpm]);

  const commit = (text: string) => {
    const n = Number(text.trim());
    if (text.trim() && Number.isFinite(n)) editBpm(clampBpm(n));
    setDraft(String(useDevice.getState().preset?.bpm ?? bpm));
  };

  const onTap = () => {
    const next = tap(taps.current, performance.now());
    taps.current = next.taps;
    if (next.bpm !== null) editBpm(next.bpm);
  };

  return (
    <span className="flex items-center gap-1.5">
      Tempo
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="xs" disabled={disabled} aria-label={`Tempo ${bpm} BPM, change`} className="-mx-1 px-1.5 text-sm font-semibold text-silkscreen tabular-nums">
            {bpm} BPM
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-[260px] flex-col gap-3">
          <label htmlFor={inputId} className="text-sm font-[550] text-silkscreen-2">
            Tempo ({BPM_MIN}–{BPM_MAX} BPM)
          </label>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon-sm" aria-label="Slower" onClick={() => editBpm(bpm - 1)} disabled={bpm <= BPM_MIN}>
              <MinusIcon aria-hidden />
            </Button>
            <Input
              id={inputId}
              inputMode="numeric"
              className="h-8 w-20 text-center tabular-nums"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit(e.currentTarget.value);
                else if (e.key === "Escape") setDraft(String(bpm));
              }}
            />
            <Button variant="outline" size="icon-sm" aria-label="Faster" onClick={() => editBpm(bpm + 1)} disabled={bpm >= BPM_MAX}>
              <PlusIcon aria-hidden />
            </Button>
          </div>
          <p className="text-xs text-pretty text-silkscreen-3">{note}</p>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="xs" disabled={disabled} onClick={onTap} aria-label="Tap tempo" title="Tap in time: the tempo follows the last few taps">
        Tap
      </Button>
    </span>
  );
}
