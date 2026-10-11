import { PlusIcon, XIcon } from "lucide-react";
import { MAX_FOOTSWITCH_BLOCKS } from "@/gp5/lib/prst.mjs";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePedalName } from "@/state/device";
import type { PresetState } from "@/state/device-types";
import { footswitchToggle, toggleFootswitch } from "./edits";
import { saveOnlyNote, useLiveMode } from "./live-edits";

const SWITCHES = [
  { key: "fs1", label: "FS1" },
  { key: "fs2", label: "FS2" },
] as const;

/**
 * Rig header "Footswitches": one button for the preset's switch assignments, a popover with one row per switch (its
 * blocks, remove, add). Rows keep the header one control wide however many switches a model has.
 */
export function FootswitchControl({ preset, disabled }: { preset: PresetState; disabled: boolean }) {
  const pedal = usePedalName();
  const note = saveOnlyNote(useLiveMode("liveFootswitches"), "A footswitch change", pedal);
  const total = SWITCHES.reduce((n, s) => n + preset.footswitches[s.key].length, 0);
  const code = (b: number) => preset.blocks[b]?.code ?? "?";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="-mx-1 gap-1.5 px-1.5 text-sm font-normal text-silkscreen-3">
          Footswitches
          <span className={total ? "font-semibold text-silkscreen" : "text-silkscreen-4"}>{total === 0 ? "none" : total === 1 ? "1 block" : `${total} blocks`}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-[320px] flex-col gap-3 bg-surface-solid-raised!">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-[550] text-silkscreen-2">Footswitches</span>
          <span className="text-xs text-pretty text-silkscreen-3">
            Each switch turns its blocks on and off together in Stomp mode.
            {preset.device === "gp50" && ` Up to ${MAX_FOOTSWITCH_BLOCKS} blocks per switch, and a block can be on one switch only.`}
          </span>
        </div>
        <ul className="flex flex-col gap-2">
          {SWITCHES.map(({ key, label }) => {
            const assigned = preset.footswitches[key];
            const free = preset.order.filter((b) => !assigned.includes(b));
            return (
              <li key={key} className="flex min-h-7 items-center gap-2">
                <span className="w-9 shrink-0 text-sm font-semibold text-silkscreen">{label}</span>
                <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {assigned.length === 0 && <span className="text-sm text-silkscreen-4">none</span>}
                  {assigned.map((b) => (
                    <span key={b} className="inline-flex h-7 items-center gap-[5px] rounded-pill pr-0.5 pl-[9px] text-xs font-semibold text-silkscreen-2 shadow-[inset_0_0_0_1px_var(--seam-strong)]">
                      <span className="size-1.5 rounded-full" style={{ background: `var(--block-${code(b).toLowerCase()})` }} aria-hidden />
                      {code(b)}
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`Remove ${code(b)} from ${label}`}
                        onClick={() => toggleFootswitch(key, b)}
                        className="grid size-6 place-items-center rounded-full text-silkscreen-3 enabled:hover:bg-accent enabled:hover:text-silkscreen disabled:opacity-50"
                      >
                        <XIcon className="size-3" aria-hidden />
                      </button>
                    </span>
                  ))}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon-xs" disabled={disabled} aria-label={`Add a block to ${label}`}>
                      <PlusIcon aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 bg-surface-solid-raised!">
                    {free.map((b) => {
                      const t = footswitchToggle(preset, key, b);
                      const from = SWITCHES.find((s) => s.key !== key && preset.footswitches[s.key].includes(b));
                      return (
                        <DropdownMenuItem key={b} disabled={"reason" in t} onSelect={() => toggleFootswitch(key, b)}>
                          {code(b)}
                          {"reason" in t ? (
                            <DropdownMenuShortcut>{MAX_FOOTSWITCH_BLOCKS} blocks max</DropdownMenuShortcut>
                          ) : (
                            preset.device === "gp50" && from && <DropdownMenuShortcut>moves from {from.label}</DropdownMenuShortcut>
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
        {note && <p className="text-xs text-pretty text-silkscreen-3">{note}</p>}
      </PopoverContent>
    </Popover>
  );
}
