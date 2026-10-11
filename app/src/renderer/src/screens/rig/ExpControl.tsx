import { useId, useState } from "react";
import { EXP_TARGETS } from "@/gp5/lib/protocol.mjs";
import { notifyError } from "@/app/notify";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useDevice, usePedalName } from "@/state/device";
import { expTargetParams } from "@/state/device-model";
import type { ExpEdit, ExpSettings, PresetState } from "@/state/device-types";
import { editExp } from "./edits";

const VOLUME_TARGET = 0;

/** "Volume" for the EXP volume, else the block code with its current model ("DLY · Pure Eko"). */
function targetLabel(preset: PresetState, module: number): string {
  if (module === VOLUME_TARGET) return "Volume";
  const code = EXP_TARGETS[module] ?? `Block ${module}`;
  const block = preset.blocks.find((b) => b.code === code);
  return block?.model ? `${code} · ${block.model.title}` : code;
}

const apply = (edit: ExpEdit) => {
  try {
    editExp(edit);
  } catch (e) {
    notifyError("Couldn't change the EXP setting", e);
  }
};

/**
 * Rig header EXP pedal settings of the preset (GP-50): on/off, what the pedal sweeps and over which range. Shown only
 * for presets that store EXP settings; edits play live when the "exp" feature is usable, otherwise it explains why not.
 */
export function ExpControl({ preset, exp, disabled }: { preset: PresetState; exp: ExpSettings; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const pedal = usePedalName();
  const usable = useDevice((s) => s.features.includes("exp"));
  const locked = useDevice((s) => s.lockedFeatures.includes("exp"));
  const off = disabled || !usable;
  const ids = { on: useId(), target: useId(), param: useId(), range: useId(), pos: useId() };
  const volume = exp.targetModule === VOLUME_TARGET;
  const params = expTargetParams(preset, exp.targetModule);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" aria-label={`EXP pedal ${exp.on ? "on" : "off"}, settings`} className="-mx-1 gap-1.5 px-1.5 text-sm font-normal text-silkscreen-3">
          EXP
          <span className={cn("font-semibold", exp.on ? "text-silkscreen" : "text-silkscreen-4")}>{exp.on ? targetLabel(preset, exp.targetModule).split(" · ")[0] : "Off"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-[320px] flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={ids.on} className="text-sm font-[550] text-silkscreen-2">
            EXP pedal
          </Label>
          <Switch id={ids.on} checked={exp.on} disabled={off} onCheckedChange={(v) => apply({ on: v })} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.target} className="text-xs text-silkscreen-3">
            Controls
          </Label>
          <Select
            value={String(exp.targetModule)}
            disabled={off}
            onValueChange={(v) => {
              const module = Number(v);
              if (module !== exp.targetModule) apply({ targetModule: module, targetParam: 0 });
            }}
          >
            <SelectTrigger id={ids.target} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXP_TARGETS.map((_, m) => (
                <SelectItem key={m} value={String(m)}>
                  {targetLabel(preset, m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {volume ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span id={ids.pos} className="text-xs text-silkscreen-3">
                Volume position
              </span>
              <ToggleGroup
                type="single"
                spacing={1.5}
                value={String(exp.volPosition)}
                disabled={off}
                aria-labelledby={ids.pos}
                onValueChange={(v) => v && apply({ volPosition: v === "1" ? 1 : 0 })}
              >
                <ToggleGroupItem value="0">Pre (before the amp)</ToggleGroupItem>
                <ToggleGroupItem value="1">Post (after the amp)</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <RangeRow id={ids.range} label="Volume range" min={exp.volMin} max={exp.volMax} disabled={off} onChange={(lo, hi) => apply(changedEnds("volMin", lo, exp.volMin, "volMax", hi, exp.volMax))} />
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.param} className="text-xs text-silkscreen-3">
                Parameter
              </Label>
              <Select value={String(exp.targetParam)} disabled={off || params.length === 0} onValueChange={(v) => apply({ targetParam: Number(v) })}>
                <SelectTrigger id={ids.param} size="sm" className="w-full">
                  <SelectValue placeholder={`Parameter ${exp.targetParam + 1}`} />
                </SelectTrigger>
                <SelectContent>
                  {params.map((p, i) => (
                    <SelectItem key={p.index} value={String(i)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <RangeRow
              id={ids.range}
              label="Sweep (share of the parameter's range)"
              min={exp.paramMin}
              max={exp.paramMax}
              disabled={off}
              onChange={(lo, hi) => apply(changedEnds("paramMin", lo, exp.paramMin, "paramMax", hi, exp.paramMax))}
            />
          </>
        )}

        {!usable && (
          <p className="text-xs text-pretty text-silkscreen-3">
            {locked
              ? "Changing EXP settings needs GP-50 extras (experimental), which you can turn on in Settings."
              : `Connect the ${pedal} to change its EXP settings.`}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The ends of a range that moved, as an EXP edit (one send per changed field). */
function changedEnds(loKey: "paramMin" | "volMin", lo: number, loNow: number, hiKey: "paramMax" | "volMax", hi: number, hiNow: number): ExpEdit {
  return { ...(lo !== loNow ? { [loKey]: lo } : {}), ...(hi !== hiNow ? { [hiKey]: hi } : {}) };
}

/** Two-thumb 0..100 % slider. */
function RangeRow({ id, label, min, max, disabled, onChange }: { id: string; label: string; min: number; max: number; disabled: boolean; onChange(lo: number, hi: number): void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span id={id} className="text-silkscreen-3">
          {label}
        </span>
        <span className="font-semibold text-silkscreen tabular-nums">
          {min}% – {max}%
        </span>
      </div>
      <Slider
        aria-labelledby={id}
        min={0}
        max={100}
        step={1}
        value={[min, max]}
        disabled={disabled}
        onValueChange={([lo, hi]) => (lo !== min || hi !== max) && onChange(lo, hi)}
      />
    </div>
  );
}
