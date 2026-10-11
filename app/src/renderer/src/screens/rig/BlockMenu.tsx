import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { modelTitle } from "@/components/gear";
import { useDevice, usePedalName } from "@/state/device";
import type { BlockState } from "@/state/device-types";
import { copyBlock, pasteBlock } from "./clipboard";
import { editEnabled, editOrder, footswitchToggle, resetToDefaults, toggleFootswitch } from "./edits";
import { isMovable, nudge } from "./order";
import { useLiveMode } from "./live-edits";
import { useRig } from "./rig-store";

/** Right-click menu of a pedal: on/off, change model, copy/paste settings, FS1/FS2, move, reset. */
export function BlockMenu({ block, readOnly, children }: { block: BlockState; readOnly: boolean; children: ReactNode }) {
  const preset = useDevice((s) => s.preset);
  const fs = preset?.footswitches;
  const order = useDevice((s) => s.preset?.order);
  const clip = useRig((s) => s.clipboard);
  const pedal = usePedalName();
  const fsMode = useLiveMode("liveFootswitches");
  const orderMode = useLiveMode("liveOrder");
  const canPaste = !!clip && clip.code === block.code && !readOnly;
  const left = order && nudge(order, block.index, -1);
  const right = order && nudge(order, block.index, 1);
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
        {(["fs1", "fs2"] as const).map((which) => {
          const label = which.toUpperCase();
          const other = which === "fs1" ? "FS2" : "FS1";
          const t = preset ? footswitchToggle(preset, which, block.index) : null;
          const assigned = !!fs?.[which].includes(block.index);
          const moves = !assigned && preset?.device === "gp50" && !!fs?.[which === "fs1" ? "fs2" : "fs1"].includes(block.index);
          const full = !!t && "reason" in t;
          return (
            <ContextMenuCheckboxItem key={which} disabled={readOnly || full} checked={assigned} onCheckedChange={() => toggleFootswitch(which, block.index)}>
              Assign to {label}
              {full && <ContextMenuShortcut>3 blocks max</ContextMenuShortcut>}
              {moves && <ContextMenuShortcut>moves from {other}</ContextMenuShortcut>}
            </ContextMenuCheckboxItem>
          );
        })}
        {!readOnly && fsMode !== "live" && <SaveNote pedal={pedal} />}
        {isMovable(block.index) && (
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
