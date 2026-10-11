import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { modelTitle } from "@/components/gear";
import { useDevice, usePedalName } from "@/state/device";
import { switchLabel } from "@/state/device-model";
import type { BlockState } from "@/state/device-types";
import { copyBlock, pasteBlock } from "./clipboard";
import { editEnabled, editOrder, footswitchToggle, resetToDefaults, shownSwitches, toggleFootswitch } from "./edits";
import { isMovable, nudge } from "./order";
import { useLiveMode } from "./live-edits";
import { useRig } from "./rig-store";

/** Right-click menu of a pedal: on/off, change model, copy/paste settings, FS1/FS2 (CTRL submenu), move, reset. */
export function BlockMenu({ block, readOnly, children }: { block: BlockState; readOnly: boolean; children: ReactNode }) {
  const preset = useDevice((s) => s.preset);
  const order = useDevice((s) => s.preset?.order);
  const clip = useRig((s) => s.clipboard);
  const pedal = usePedalName();
  const fsMode = useLiveMode("liveFootswitches");
  const orderMode = useLiveMode("liveOrder");
  const canPaste = !!clip && clip.code === block.code && !readOnly;
  const left = preset && order && nudge(preset.device, order, block.index, -1);
  const right = preset && order && nudge(preset.device, order, block.index, 1);
  const switches = preset ? shownSwitches(preset) : [];
  /** The shown switches this block is on */
  const on = switches.filter((which) => preset?.footswitches[which].includes(block.index));
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem disabled={readOnly} onSelect={() => editEnabled(block.index, !block.enabled)}>
          {block.enabled ? "Turn off" : "Turn on"}
          <ContextMenuShortcut>Space</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={readOnly}
          onSelect={() => {
            useRig.getState().select(block.index);
            useRig.getState().openPicker({ block: block.index });
          }}
        >
          Change model…
          <ContextMenuShortcut>M</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => copyBlock(block)}>Copy settings</ContextMenuItem>
        <ContextMenuItem disabled={!canPaste} onSelect={() => void pasteBlock(block.index)}>
          {clip && clip.code === block.code ? `Paste ${clip.title} settings` : "Paste settings"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {preset && switches.length > 2 ? (
          // GP-200 family: up to 8 CTRL, one submenu instead of a checkbox each
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={readOnly}>
              Assign to CTRL
              {on.length > 0 && <ContextMenuShortcut>{on.map((i) => i + 1).join(", ")}</ContextMenuShortcut>}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {switches.map((which) => (
                <ContextMenuCheckboxItem key={which} checked={on.includes(which)} onCheckedChange={() => toggleFootswitch(which, block.index)}>
                  {switchLabel(preset.device, which)}
                </ContextMenuCheckboxItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : (
          preset &&
          switches.map((which) => {
            const t = footswitchToggle(preset, which, block.index);
            const assigned = on.includes(which);
            const from = preset.footswitches.findIndex((l, i) => i !== which && l.includes(block.index));
            const moves = !assigned && preset.device === "gp50" && from >= 0;
            const full = "reason" in t;
            return (
              <ContextMenuCheckboxItem key={which} disabled={readOnly || full} checked={assigned} onCheckedChange={() => toggleFootswitch(which, block.index)}>
                Assign to {switchLabel(preset.device, which)}
                {full && <ContextMenuShortcut>3 blocks max</ContextMenuShortcut>}
                {moves && <ContextMenuShortcut>moves from {switchLabel(preset.device, from)}</ContextMenuShortcut>}
              </ContextMenuCheckboxItem>
            );
          })
        )}
        {!readOnly && fsMode !== "live" && <SaveNote pedal={pedal} />}
        {preset && isMovable(preset.device, block.index) && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={readOnly || !left} onSelect={() => left && editOrder(left)}>
              Move earlier in the chain
              <ContextMenuShortcut>Alt ←</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={readOnly || !right} onSelect={() => right && editOrder(right)}>
              Move later in the chain
              <ContextMenuShortcut>Alt →</ContextMenuShortcut>
            </ContextMenuItem>
            {!readOnly && orderMode !== "live" && <SaveNote pedal={pedal} />}
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={readOnly || !block.model} onSelect={() => void resetToDefaults(block)}>
          Reset {block.model ? modelTitle(block) : "model"} to defaults
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Under the footswitch and move items when the pedal has no live command for them. */
function SaveNote({ pedal }: { pedal: string }) {
  return <ContextMenuLabel className="text-xs font-normal text-pretty text-silkscreen-3">Reaches the {pedal} when you save</ContextMenuLabel>;
}
