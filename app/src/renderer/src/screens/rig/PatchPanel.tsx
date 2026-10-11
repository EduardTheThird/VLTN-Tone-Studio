import { useId, useState, type ReactNode } from "react";
import { notifyError } from "@/app/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePedalName } from "@/state/device";
import { slotNameError } from "@/state/device-model";
import type { Gp200Edit, Gp200Fields, PatchExp, PatchQuickAccess, PresetState } from "@/state/device-types";
import { editPatchFields } from "./edits";
import { EXP_HARDWARE, EXP_SETS, FIELD_RANGE, TEXT_LENGTH, paramOptions, retarget, styleOptions, targetOptions, targetValue, type Option } from "./patch-fields";

const apply = (edit: Gp200Edit) => {
  try {
    editPatchFields(edit);
  } catch (e) {
    notifyError("Couldn't change the patch setting", e);
  }
};

const targetOf = (value: string) => (value === "off" ? null : Number(value));

/**
 * Rig header "Patch settings" (GP-200 family): EXP, Quick Access, pan and FX loop, drum style, author and note, in a
 * side sheet. They change the preset here and reach the pedal with the save; every change is undoable.
 */
export function PatchPanel({ preset, fields, disabled }: { preset: PresetState; fields: Gp200Fields; disabled: boolean }) {
  const pedal = usePedalName();
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="xs" className="-mx-1 px-1.5 text-sm font-normal text-silkscreen-3">
          Patch settings
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[440px] gap-0 p-0 sm:max-w-[440px]">
        <SheetHeader className="border-b border-border py-5 pr-12 pl-6">
          <SheetTitle className="text-lg">Patch settings</SheetTitle>
          <SheetDescription className="text-pretty text-silkscreen-3">
            Stored with {preset.name}. Changes reach the {pedal} when you save.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-6 pt-5 pb-8">
          <Section title="EXP" note={EXP_HARDWARE[preset.device]}>
            <Tabs defaultValue="0">
              <TabsList className="w-full">
                {EXP_SETS.map((name, set) => (
                  <TabsTrigger key={name} value={String(set)}>
                    {name}
                  </TabsTrigger>
                ))}
              </TabsList>
              {EXP_SETS.map((name, set) => (
                <TabsContent key={name} value={String(set)}>
                  <ol className="m-0 flex list-none flex-col gap-4 p-0 pt-2">
                    {fields.exp.slice(set * 3, set * 3 + 3).map((entry, k) => (
                      <ExpEntry key={k} preset={preset} index={set * 3 + k} title={`Entry ${k + 1}`} name={`${name}, entry ${k + 1}`} entry={entry} disabled={disabled} />
                    ))}
                  </ol>
                </TabsContent>
              ))}
            </Tabs>
          </Section>

          <Section title="Quick Access" note="What each Quick Access knob turns in this patch.">
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {fields.quickAccess.map((knob, i) => (
                <QuickAccessRow key={i} preset={preset} index={i} knob={knob} disabled={disabled} />
              ))}
            </ol>
          </Section>

          <Section title="Pan and FX loop" note={`Shown as the preset stores them: what the numbers mean on the ${pedal} isn't confirmed yet.`}>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Pan" value={fields.pan} range={FIELD_RANGE.pan} disabled={disabled} onCommit={(pan) => apply({ pan })} />
              <NumberField label="FX loop mode" value={fields.loopMode} range={FIELD_RANGE.loopMode} disabled={disabled} onCommit={(loopMode) => apply({ loopMode })} />
              <NumberField label="FX loop send level" value={fields.sendLevel} range={FIELD_RANGE.sendLevel} disabled={disabled} onCommit={(sendLevel) => apply({ sendLevel })} />
              <NumberField label="FX loop return level" value={fields.returnLevel} range={FIELD_RANGE.returnLevel} disabled={disabled} onCommit={(returnLevel) => apply({ returnLevel })} />
            </div>
          </Section>

          <Section title="Drum style">
            <Choice label="Drum style" value={String(fields.style)} options={styleOptions(fields.style)} disabled={disabled} onChange={(v) => apply({ style: Number(v) })} />
          </Section>

          <Section title="Author and note">
            <TextField label="Author" value={fields.author} max={TEXT_LENGTH.author} disabled={disabled} onCommit={(author) => apply({ author })} />
            <TextField label="Note" value={fields.note} max={TEXT_LENGTH.note} disabled={disabled} onCommit={(note) => apply({ note })} />
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="m-0 text-sm font-[550] text-silkscreen-2">
          {title}
        </h2>
        {note && <p className="m-0 text-xs text-pretty text-silkscreen-3">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** One EXP entry: what it sweeps (Off, a block's param) and between which values. `name` labels it for screen readers. */
function ExpEntry(props: { preset: PresetState; index: number; title: string; name: string; entry: PatchExp; disabled: boolean }) {
  const { preset, index, title, name, entry, disabled } = props;
  const block = entry.block !== null && preset.blocks[entry.block] ? entry.block : null;
  return (
    <li className="flex flex-col gap-2">
      <span className="text-xs text-silkscreen-3">{title}</span>
      <Choice
        label={`${name} target`}
        value={targetValue(entry.block)}
        options={targetOptions(preset, "exp", entry.block)}
        disabled={disabled}
        onChange={(v) => apply({ exp: { [index]: retarget(preset, targetOf(v)) } })}
      />
      {entry.block !== null && (
        <div className="grid grid-cols-[1fr_4.5rem_4.5rem] items-end gap-2">
          {block !== null ? (
            <Choice label={`${name} parameter`} value={String(entry.param)} options={paramOptions(preset, block, entry.param)} disabled={disabled} onChange={(v) => apply({ exp: { [index]: { param: Number(v) } } })} />
          ) : (
            <span />
          )}
          <NumberField label="Min" name={`${name} min`} value={entry.min} range={FIELD_RANGE.expEnd} decimals disabled={disabled} onCommit={(min) => apply({ exp: { [index]: { min } } })} />
          <NumberField label="Max" name={`${name} max`} value={entry.max} range={FIELD_RANGE.expEnd} decimals disabled={disabled} onCommit={(max) => apply({ exp: { [index]: { max } } })} />
        </div>
      )}
    </li>
  );
}

/** One Quick Access knob: Off, a block's param, the patch volume or tempo. */
function QuickAccessRow({ preset, index, knob, disabled }: { preset: PresetState; index: number; knob: PatchQuickAccess; disabled: boolean }) {
  const name = `Quick Access ${index + 1}`;
  const block = knob.block !== null && preset.blocks[knob.block] ? knob.block : null;
  return (
    <li className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2">
      <span className="text-sm font-semibold text-silkscreen">Knob {index + 1}</span>
      <Choice
        label={`${name} target`}
        value={targetValue(knob.block)}
        options={targetOptions(preset, "quickAccess", knob.block)}
        disabled={disabled}
        onChange={(v) => apply({ quickAccess: { [index]: retarget(preset, targetOf(v)) } })}
      />
      {block !== null && (
        <Choice label={`${name} parameter`} value={String(knob.param)} options={paramOptions(preset, block, knob.param)} disabled={disabled} onChange={(v) => apply({ quickAccess: { [index]: { param: Number(v) } } })} />
      )}
    </li>
  );
}

/** A select over `options`; `label` names it for screen readers. */
function Choice({ label, value, options, disabled, onChange }: { label: string; value: string; options: Option[]; disabled: boolean; onChange(value: string): void }) {
  return (
    <Select value={value} disabled={disabled} onValueChange={(v) => v !== value && onChange(v)}>
      <SelectTrigger size="sm" aria-label={label} className="w-full min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A number the preset stores. It changes as you type, whenever the text reads as a number, within `range` and rounded
 * unless `decimals`, so nothing typed is lost when the sheet closes; leaving the field shows the stored value.
 */
function NumberField(props: { label: string; name?: string; value: number; range: { min: number; max: number }; decimals?: boolean; disabled: boolean; onCommit(value: number): void }) {
  const { label, name, value, range, decimals, disabled, onCommit } = props;
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const stored = String(Math.round(value * 1000) / 1000);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-normal text-silkscreen-3">
        {label}
      </Label>
      <Input
        id={id}
        aria-label={name}
        inputMode={decimals ? "decimal" : "numeric"}
        className="h-8 tabular-nums"
        value={draft ?? stored}
        disabled={disabled}
        onFocus={() => setDraft(stored)}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        onChange={(e) => {
          const text = e.currentTarget.value;
          setDraft(text);
          const n = Number(text.trim());
          if (!text.trim() || !Number.isFinite(n)) return;
          onCommit(Math.max(range.min, Math.min(range.max, decimals ? n : Math.round(n))));
        }}
      />
    </div>
  );
}

/** Text the preset stores, changed as you type; the pedal shows printable ASCII only, up to `max` characters. */
function TextField({ label, value, max, disabled, onCommit }: { label: string; value: string; max: number; disabled: boolean; onCommit(value: string): void }) {
  const id = useId();
  const pedal = usePedalName();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="text-xs font-normal text-silkscreen-3">
          {label}
        </Label>
        <span className="text-xs text-silkscreen-3 tabular-nums">
          {value.length}/{max}
        </span>
      </div>
      <Input
        id={id}
        value={value}
        maxLength={max}
        disabled={disabled}
        aria-invalid={!!error}
        onChange={(e) => {
          const text = e.currentTarget.value;
          // A blank author or note is fine; only characters the pedal can't show are refused
          const why = text.trim() ? slotNameError(text, pedal) : null;
          setError(why);
          if (!why) onCommit(text);
        }}
      />
      {error && (
        <span role="alert" className="text-xs text-led-fault">
          {error}
        </span>
      )}
    </div>
  );
}
