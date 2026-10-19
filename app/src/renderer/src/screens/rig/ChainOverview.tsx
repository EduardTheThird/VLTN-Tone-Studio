import { useState, type DragEvent, type KeyboardEvent } from "react";
import { ArrowDownRightIcon, ArrowUpRightIcon, LockIcon } from "lucide-react";
import { Dial, GearFor, artFor, modelTitle, type GearArt } from "@/components/gear";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { profileFor } from "@shared/devices";
import { useDevice, usePedalName } from "@/state/device";
import { isGp5Family, snapToneReplacesAmpCab } from "@/state/device-model";
import type { PresetState } from "@/state/device-types";
import { editOrder, editPatchFields, editVolume } from "./edits";
import { saveOnlyNote } from "./live-edits";
import { GROUPS, GROUP_TITLE, chainItems, gapLabel, groupOf, groupsOf, loopRange, moveBlock, moveLoopNode, moveToGroup, type GroupId, type LoopNode, type LoopPos } from "./order";
import { DRAG_MIME } from "./Pedalboard";
import { useRig } from "./rig-store";
import { snapToneName } from "./snaptone";

const IN_SPEC = { min: -20, max: 20, step: 1, unit: "dB" };
const OUT_SPEC = { min: 0, max: 100, step: 1 };
/** Drawings wider than tall (amp head, cab) get a wide thumbnail; pedals and captures a narrow one. */
const WIDE_ART: readonly GearArt[] = ["amp", "cab"];

/** Paradise-style top strip: IN trim, the three groups as thumbnails (click to open, drop to move), lock, OUT. */
export function ChainOverview({ preset, readOnly }: { preset: PresetState; readOnly: boolean }) {
  const group = useRig((s) => s.group);
  const inputTrim = useDevice((s) => s.globals?.inputTrim);
  const connected = useDevice((s) => s.status === "connected");
  const pedal = usePedalName();
  const groups = groupsOf(preset.device, preset.order);
  const ns = profileFor(preset.device).blocks.indexOf("NS");
  const nsOn = ns >= 0 && snapToneReplacesAmpCab(preset.device) && preset.blocks[ns].enabled;
  const [dropGroup, setDropGroup] = useState<GroupId | null>(null);

  const onDragOver = (g: GroupId) => (e: DragEvent) => {
    const raw = e.dataTransfer.types.includes(DRAG_MIME);
    if (!raw || readOnly || g === "amp") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropGroup(g);
  };
  const onDrop = (g: GroupId) => (e: DragEvent) => {
    setDropGroup(null);
    const block = Number(e.dataTransfer.getData(DRAG_MIME));
    const next = Number.isInteger(block) ? moveToGroup(preset.device, preset.order, block, g) : null;
    if (!next) return;
    e.preventDefault();
    editOrder(next);
    useRig.getState().setGroup(g);
  };

  return (
    <section aria-label="Signal chain overview" className="glass mx-7 flex items-center gap-3.5 rounded-xl px-[18px] pt-3.5 pb-2.5">
      {inputTrim !== undefined && (
        <>
          <Dial
            layout="row"
            size={30}
            label="In"
            ariaLabel="Input trim"
            value={inputTrim}
            spec={IN_SPEC}
            disabled={readOnly || !connected}
            onChange={(v) => useDevice.getState().setGlobal("inputTrim", v)}
          />
          <div className="h-9 w-px bg-seam-strong" />
        </>
      )}
      {isGp5Family(preset.device) ? (
        <div className="relative flex flex-1 items-center justify-center gap-1.5 before:absolute before:inset-x-0 before:top-1/2 before:h-0.5 before:bg-cable">
          {GROUPS.map((g) => {
            const active = g === group;
            const replaced = g === "amp" && nsOn;
            return (
              <Tooltip key={g}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-pressed={active}
                    aria-label={`${GROUP_TITLE[g]}${replaced ? ", replaced by SnapTone" : ""}`}
                    onClick={() => useRig.getState().setGroup(g)}
                    onDragOver={onDragOver(g)}
                    onDragLeave={() => setDropGroup(null)}
                    onDrop={onDrop(g)}
                    className={cn(
                      "relative mt-2 flex min-h-12 items-end gap-1.5 rounded-lg px-2.5 py-2 transition-colors",
                      active ? "bg-faceplate-raised shadow-[0_0_0_1.5px_rgb(255_255_255/0.85)]" : "hover:bg-faceplate",
                      dropGroup === g && "shadow-[0_0_0_2px_var(--silkscreen)]",
                    )}
                  >
                    <span className={cn("absolute -top-[17px] left-1.5 text-xs font-medium whitespace-nowrap", active ? "text-silkscreen" : "text-silkscreen-3")}>{GROUP_TITLE[g]}</span>
                    {groups[g].map((b) => {
                      const block = preset.blocks[b];
                      const wide = WIDE_ART.includes(artFor(block));
                      return (
                        <GearFor
                          key={b}
                          block={block}
                          className={cn(wide ? "w-[58px]" : "h-[46px] w-auto [&>svg]:h-full [&>svg]:w-auto", replaced ? "saturate-0 brightness-[.4]" : !block.enabled && "saturate-[.15] brightness-50")}
                        />
                      );
                    })}
                    {replaced && (
                      <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-surface-solid px-1.5 text-xs font-semibold whitespace-nowrap text-block-ns">Replaced by SnapTone</span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{groups[g].map((b) => `${preset.blocks[b].code} ${modelTitle(preset.blocks[b])}`).join(" · ")}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      ) : (
        <FlatChain preset={preset} readOnly={readOnly} />
      )}
      {isGp5Family(preset.device) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} aria-label="Fixed order" className="grid size-8 place-items-center rounded-pill text-silkscreen-4">
              <LockIcon className="size-[13px]" aria-hidden />
            </span>
          </TooltipTrigger>
          <TooltipContent>DST, NS, AMP, CAB and EQ keep a fixed order on the {pedal}</TooltipContent>
        </Tooltip>
      )}
      <div className="h-9 w-px bg-seam-strong" />
      <Dial layout="row" size={30} label="Out" ariaLabel="Patch volume" value={preset.volume} spec={OUT_SPEC} disabled={readOnly} onChange={editVolume} />
    </section>
  );
}

/** A dragged GP-200 FX loop node ("send" or "return"). */
const LOOP_MIME = "application/x-gp200-loop-node";

type DropAt = { target: number; side: "before" | "after" };

/**
 * GP-200 family: every block in signal order, the FX loop's send and return nodes in their gaps. A click opens the
 * block's board; blocks and nodes move by drag, a focused node by the arrow keys.
 */
function FlatChain({ preset, readOnly }: { preset: PresetState; readOnly: boolean }) {
  const { device, order, blocks } = preset;
  const group = useRig((s) => s.group);
  const selected = useRig((s) => s.selected);
  const snapTones = useDevice((s) => s.snapTones);
  const pedal = usePedalName();
  const [dragging, setDragging] = useState<{ block: number } | { node: LoopNode } | null>(null);
  const [drop, setDrop] = useState<DropAt | null>(null);
  const loop: LoopPos | null = preset.gp200 && { sendPos: preset.gp200.sendPos, returnPos: preset.gp200.returnPos };
  const inGroup = groupsOf(device, order)[group];
  const codes = blocks.map((b) => b.code);
  const gapAt = ({ target, side }: DropAt) => order.indexOf(target) + (side === "after" ? 1 : 0);

  const moveNode = (node: LoopNode, pos: number) => {
    const next = loop && moveLoopNode(loop, node, pos, order.length);
    if (next) editPatchFields(node === "send" ? { sendPos: next.sendPos } : { returnPos: next.returnPos });
  };
  /** A node into a gap the pedal takes, or a block next to another (one dragged from the board shows its index on drop only). */
  const allowed = (e: DragEvent, at: DropAt) => {
    if (dragging && "node" in dragging) return !!loop && moveLoopNode(loop, dragging.node, gapAt(at), order.length) !== null;
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return false;
    return !dragging || moveBlock(device, order, dragging.block, at.target, at.side) !== null;
  };
  const onDragOver = (target: number) => (e: DragEvent<HTMLElement>) => {
    if (readOnly) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const at: DropAt = { target, side: e.clientX < rect.left + rect.width / 2 ? "before" : "after" };
    if (!allowed(e, at)) {
      setDrop(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (drop?.target !== at.target || drop.side !== at.side) setDrop(at);
  };
  const endDrag = () => {
    setDrop(null);
    setDragging(null);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const node = e.dataTransfer.getData(LOOP_MIME);
    const block = e.dataTransfer.getData(DRAG_MIME);
    if (drop && (node === "send" || node === "return")) moveNode(node, gapAt(drop));
    else if (drop && block !== "") {
      const next = moveBlock(device, order, Number(block), drop.target, drop.side);
      if (next) editOrder(next);
    }
    endDrag();
  };

  return (
    <div role="group" aria-label="Signal chain" className="relative flex flex-1 items-center justify-center gap-1.5 before:absolute before:inset-x-0 before:top-1/2 before:h-0.5 before:bg-cable">
      {(loop ? chainItems(order, loop) : order.map((b) => ({ block: b }))).map((item) => {
        if ("node" in item)
          return (
            <LoopHandle
              key={item.node}
              node={item.node}
              loop={loop!}
              order={order}
              codes={codes}
              note={saveOnlyNote("save", "The new position", pedal)}
              readOnly={readOnly}
              onMove={(pos) => moveNode(item.node, pos)}
              onDragStart={() => setDragging({ node: item.node })}
              onDragEnd={endDrag}
            />
          );
        const b = item.block;
        const block = blocks[b];
        const name = artFor(block) === "capture" ? snapToneName(block, snapTones, device) : modelTitle(block);
        return (
          <Tooltip key={b}>
            <TooltipTrigger asChild>
              <button
                type="button"
                draggable={!readOnly}
                aria-label={`${block.code} ${name}, ${block.enabled ? "on" : "off"}`}
                aria-current={selected === b || undefined}
                onClick={() => {
                  useRig.getState().select(b);
                  useRig.getState().setGroup(groupOf(device, order, b));
                }}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_MIME, String(b));
                  e.dataTransfer.effectAllowed = "move";
                  setDragging({ block: b });
                }}
                onDragEnd={endDrag}
                onDragOver={onDragOver(b)}
                onDragLeave={() => drop?.target === b && setDrop(null)}
                onDrop={onDrop}
                className={cn(
                  "relative flex h-14 items-end rounded-md px-1 pb-1.5 transition-colors",
                  inGroup.includes(b) ? "bg-faceplate-raised" : "hover:bg-faceplate",
                  selected === b && "shadow-[0_0_0_1.5px_rgb(255_255_255/0.85)]",
                )}
              >
                {drop?.target === b && <span aria-hidden className={cn("absolute inset-y-1 w-0.5 rounded-pill bg-silkscreen", drop.side === "before" ? "-left-1" : "-right-1")} />}
                <GearFor block={block} name={name} className={cn(WIDE_ART.includes(artFor(block)) ? "w-[58px]" : "h-[46px] w-auto [&>svg]:h-full [&>svg]:w-auto", !block.enabled && "saturate-[.15] brightness-50")} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{`${block.code} ${name}`}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

interface LoopHandleProps {
  node: LoopNode;
  loop: LoopPos;
  order: readonly number[];
  codes: readonly string[];
  /** When the move reaches the pedal */
  note: string;
  readOnly: boolean;
  onMove(pos: number): void;
  onDragStart(): void;
  onDragEnd(): void;
}

/** An FX loop node on the chain: a slider over the gaps it may take (drag it, or arrows, Home, End). */
function LoopHandle({ node, loop, order, codes, note, readOnly, onMove, onDragStart, onDragEnd }: LoopHandleProps) {
  const pos = node === "send" ? loop.sendPos : loop.returnPos;
  const [lo, hi] = loopRange(loop, node, order.length);
  const where = gapLabel(order, pos, codes);
  const Icon = node === "send" ? ArrowUpRightIcon : ArrowDownRightIcon;
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = ({ ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 } as Record<string, number>)[e.key];
    const to = e.key === "Home" ? lo : e.key === "End" ? hi : step === undefined ? null : pos + step;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (!readOnly) onMove(to);
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="slider"
          aria-label={`FX loop ${node}`}
          aria-valuemin={lo}
          aria-valuemax={Math.max(lo, hi)}
          aria-valuenow={pos}
          aria-valuetext={where}
          draggable={!readOnly}
          onKeyDown={onKeyDown}
          onDragStart={(e) => {
            e.dataTransfer.setData(LOOP_MIME, node);
            e.dataTransfer.effectAllowed = "move";
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          className="relative flex h-6 cursor-grab items-center gap-1 rounded-pill bg-surface-solid px-2 text-xs font-medium whitespace-nowrap text-silkscreen-2 shadow-[inset_0_0_0_1px_var(--seam-strong)] hover:text-silkscreen"
        >
          <Icon className="size-3" aria-hidden />
          {node === "send" ? "Send" : "Return"}
        </button>
      </TooltipTrigger>
      <TooltipContent>{`FX loop ${node}, ${where}. Drag it or use the arrow keys. ${note}`}</TooltipContent>
    </Tooltip>
  );
}
