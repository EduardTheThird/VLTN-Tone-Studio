import { PatchCables } from "./PatchCables";
import { ZoomBar } from "./ZoomBar";
import { useBoardZoom, ZOOM_STEP } from "./zoom";
import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent } from "react";
import { profileFor, snapToneLabel, type DeviceKey } from "@shared/devices";
import { ChevronDownIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import pedalboardUrl from "@/assets/backdrops/pedalboard.svg";
import { Capture, Dial, GearFor, artFor, knobsForBlock, modelTitle, moreControls, paramTitle } from "@/components/gear";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useDevice, usePedalName } from "@/state/device";
import { snapToneReplacesAmpCab } from "@/state/device-model";
import type { BlockState, PresetState } from "@/state/device-types";
import { BlockMenu } from "./BlockMenu";
import { editEnabled, editOrder, editParam } from "./edits";
import { saveOnlyNote, useLiveMode } from "./live-edits";
import { groupsOf, isMovable, moveBlock, orderHint } from "./order";
import { useRig } from "./rig-store";
import { snapToneIndex, snapToneName } from "./snaptone";
import { useMediaQuery } from "./use-media-query";

export const DRAG_MIME = "application/x-gp5-block";

/** Pedal art width: scales with the window height left for the board (2:3 gear), so a 1280×800 window still shows
 *  whole pedals. --rig-banner is the offline banner height (set by RigScreen). Never wider than what makes all pedals
 *  of the row (--n, on the container) fit side by side, down to 132px; a longer GP-200 board scrolls from there. */
const GEAR_W =
  "w-[calc(min(clamp(calc(112px-var(--rig-banner,0px)/1.5),calc((100vh-570px-var(--rig-banner,0px))/1.5),236px),max(132px,calc((100cqw-(var(--n,1)-1)*2.25rem)/var(--n,1))))*var(--z,1))]";

function stateLine(b: BlockState, device: DeviceKey) {
  if (b.code === "NS") return b.enabled ? (snapToneReplacesAmpCab(device) ? "SnapTone on, replacing the amp and cab" : "SnapTone on") : "SnapTone off";
  const base = `${b.code} ${b.enabled ? "on" : "off"}`;
  const time = b.model?.params.find((p) => p.name === "Time");
  if (!b.enabled || b.code !== "DLY" || !time) return base;
  const v = b.params[time.index];
  // A synced Time holds a note division (GP-50 Sync on)
  return `${base}, time ${time.labels?.[Math.round(v - time.min)] ?? `${Math.round(v)} ${time.unit ?? "ms"}`}`;
}

interface BoardProps {
  preset: PresetState;
  view: "before" | "after";
  readOnly: boolean;
  showValues: boolean;
}

/** The open group drawn large on the pedalboard backdrop: model buttons, editable pedals, on/off pills. */
export function Pedalboard({ preset, view, readOnly, showValues }: BoardProps) {
  const { device } = preset;
  const blocks = groupsOf(device, preset.order)[view];
  // GP-5 family: an engaged NS (SnapTone) plays in place of the amp and cab; the GP-150's NS module is one more pedal
  const ns = profileFor(device).blocks.indexOf("NS");
  const nsOn = ns >= 0 && snapToneReplacesAmpCab(device) && preset.blocks[ns].enabled;
  const [drag, setDrag] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ target: number; side: "before" | "after" } | null>(null);
  // The pedal whose More controls strip is open
  const [moreFor, setMoreFor] = useState<number | null>(null);
  const selected = useRig((s) => s.selected);
  const rowRef = useRef<HTMLDivElement>(null);
  // The row scrolls only when even the smallest pedals don't fit: then its ends fade out and the wheel scrolls it sideways
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const check = () => setScrolls(row.scrollWidth > row.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(row);
    return () => ro.disconnect();
  }, [blocks.length, view]);
  const zoom = useBoardZoom((s) => s.zoom);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const onWheel = (e: globalThis.WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const { zoom: z, setZoom } = useBoardZoom.getState();
        setZoom(z + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && row.scrollWidth > row.clientWidth && row.scrollHeight <= row.clientHeight) row.scrollLeft += e.deltaY;
    };
    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  }, []);
  const snapTones = useDevice((s) => s.snapTones);
  const pedal = usePedalName();
  const nsSlot = ns >= 0 ? snapToneName(preset.blocks[ns], snapTones, device) : "";
  // A SnapTone shows its slot name (NS on the GP-5 family, AMP or DST on the GP-200 family)
  const nameOf = (b: BlockState) => (artFor(b) === "capture" ? snapToneName(b, snapTones, device) : modelTitle(b));
  const orderNote = saveOnlyNote(useLiveMode("liveOrder"), "The new order", pedal);

  const hint = readOnly
    ? `Showing the last read. Pedals can't be turned, switched or moved until the ${pedal} is back.`
    : view === "before" && nsOn
      ? `NS is on, so ${nsSlot} plays in place of the amp and cab.`
      : `${orderHint(device, preset.order, view, preset.blocks.map((b) => b.code))}${orderNote && ` ${orderNote}`}`;

  // A GP-200 board can hold up to 10 pedals: scroll the row (only the row) to keep the selected one in view
  useEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>(`[data-block="${selected}"]`);
    if (!row || !el) return;
    const r = row.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    if (e.left < r.left) row.scrollBy({ left: e.left - r.left - 12 });
    else if (e.right > r.right) row.scrollBy({ left: e.right - r.right + 12 });
  }, [selected, view, preset.order]);

  const onDragOver = (target: number) => (e: DragEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const side = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    if (!moveBlock(device, preset.order, drag, target, side)) {
      setDrop(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (drop?.target !== target || drop.side !== side) setDrop({ target, side });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (drag !== null && drop) {
      const next = moveBlock(device, preset.order, drag, drop.target, drop.side);
      if (next) editOrder(next);
    }
    setDrag(null);
    setDrop(null);
  };

  return (
    <section
      aria-label={view === "before" ? "Before the amp" : "After the amp"}
      className="relative mx-7 my-3.5 flex min-h-0 flex-1 flex-col gap-3.5 overflow-hidden rounded-xl bg-[#070708] bg-cover bg-center bg-no-repeat pr-14 pl-6 pt-[18px] pb-5 shadow-[inset_0_0_0_1px_var(--glass-edge),inset_0_1px_0_rgb(255_255_255/0.07)] [@media(max-height:820px)]:my-2.5 [@media(max-height:820px)]:gap-2.5 [@media(max-height:820px)]:py-3"
      style={{ backgroundImage: `url(${pedalboardUrl})` }}
    >
      <BoardHead title={view === "before" ? "Before the amp" : "After the amp"} hint={hint} keys />
      <ZoomBar className="absolute top-16 right-2 z-10" />
      <div
        ref={rowRef}
        style={{ "--n": blocks.length, "--z": zoom } as CSSProperties}
        role="list"
        aria-label="Pedals in signal order"
        className={cn("relative flex min-h-0 flex-1 items-center-safe justify-center-safe gap-9 overflow-auto [container-type:inline-size] [scrollbar-width:thin]", scrolls && "[mask-image:linear-gradient(to_right,transparent,#000_32px,#000_calc(100%-32px),transparent)]", readOnly && "opacity-70")}
      >
        <PatchCables rowRef={rowRef} codes={blocks.map((b) => preset.blocks[b].code)} />
        {blocks.map((b) =>
          b === ns && nsOn ? (
            <NsColumn key={b} block={preset.blocks[ns]} readOnly={readOnly} name={nsSlot} device={device} />
          ) : (
            <SlotColumn
              key={b}
              block={preset.blocks[b]}
              device={device}
              order={preset.order}
              readOnly={readOnly}
              showValues={showValues}
              dropSide={drop?.target === b ? drop.side : null}
              dragging={drag === b}
              onDragStart={() => setDrag(b)}
              onDragEnd={() => {
                setDrag(null);
                setDrop(null);
              }}
              onDragOver={onDragOver(b)}
              onDrop={onDrop}
              name={nameOf(preset.blocks[b])}
              moreOpen={moreFor === b}
              onMore={() => setMoreFor(moreFor === b ? null : b)}
            />
          ),
        )}
      </div>
      {moreFor !== null && blocks.includes(moreFor) && (
        <MoreControls block={preset.blocks[moreFor]} name={nameOf(preset.blocks[moreFor])} readOnly={readOnly} onClose={() => setMoreFor(null)} />
      )}
    </section>
  );
}

export function BoardHead({ title, hint, keys }: { title: string; hint: string; keys?: boolean }) {
  return (
    <div className="relative -mx-2.5 -mt-1.5 flex items-center gap-4 self-stretch rounded-lg bg-[rgb(10_10_12/0.66)] px-3.5 py-2">
      <h2 className="m-0 shrink-0 text-[15px] font-semibold">{title}</h2>
      <span className="min-w-0 truncate text-sm text-silkscreen-3" title={hint}>
        {hint}
      </span>
      <span className="grow" />
      {keys && (
        <span className="flex shrink-0 items-center gap-1 text-sm whitespace-nowrap text-silkscreen-3 max-[1320px]:hidden">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> pedal <Kbd>Space</Kbd> on/off <Kbd>M</Kbd> change model
        </span>
      )}
    </div>
  );
}

export function ModelButton({ block, label, selected, disabled, className }: { block: BlockState; label?: string; selected?: boolean; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-haspopup="dialog"
      aria-label={`${block.code} model: ${label ?? modelTitle(block)}. Change model`}
      onClick={() => {
        useRig.getState().select(block.index);
        useRig.getState().openPicker({ block: block.index });
      }}
      className={cn(
        "flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-pill px-3 text-sm font-medium text-silkscreen transition-shadow disabled:cursor-default",
        selected
          ? "bg-white/15 shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_0_0_1.5px_rgb(255_255_255/0.9)]"
          : "bg-[rgb(10_10_12/0.62)] shadow-[inset_0_0_0_1px_var(--glass-edge)] enabled:hover:shadow-[inset_0_0_0_1px_var(--silkscreen-2)]",
        !block.enabled && !selected && "text-silkscreen-3",
        className,
      )}
    >
      <span className="size-2 flex-none rounded-full" style={{ background: `var(--block-${block.code.toLowerCase()})` }} />
      <span className="min-w-0 flex-1 truncate text-left">{label ?? modelTitle(block)}</span>
      <ChevronDownIcon className="size-3.5 text-silkscreen-3" aria-hidden />
    </button>
  );
}

function SlotFoot({ block, readOnly, text, more }: { block: BlockState; readOnly: boolean; text: string; more?: { count: number; open: boolean; toggle(): void } }) {
  return (
    <div className="flex items-center gap-2 rounded-pill bg-[rgb(10_10_12/0.66)] py-[3px] pr-2.5 pl-1 text-xs text-silkscreen-2">
      <Switch size="sm" checked={block.enabled} disabled={readOnly} onCheckedChange={(on) => editEnabled(block.index, on)} aria-label={`${block.code} on`} />
      <span className="whitespace-nowrap">{text}</span>
      {more && (
        <button
          type="button"
          aria-expanded={more.open}
          aria-label={`${more.count} more ${block.code} control${more.count === 1 ? "" : "s"}`}
          title="More controls"
          onClick={more.toggle}
          className="-my-0.5 -mr-1.5 flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-silkscreen-2 hover:bg-white/10 aria-expanded:bg-white/15 aria-expanded:text-silkscreen"
        >
          <SlidersHorizontalIcon className="size-3" aria-hidden />
          {more.count}
        </button>
      )}
    </div>
  );
}

/** Controls a pedal drawing has no room for (GP-200: long delays, wide EQs, SnapTones), in a strip over the board. */
function MoreControls({ block, name, readOnly, onClose }: { block: BlockState; name: string; readOnly: boolean; onClose(): void }) {
  const knobs = moreControls(block);
  if (!knobs.length) return null;
  const color = `var(--block-${block.code.toLowerCase()})`;
  return (
    <div
      role="group"
      aria-label={`More ${block.code} controls`}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="absolute inset-x-6 bottom-[52px] z-10 flex items-center gap-5 rounded-xl bg-surface-solid/95 py-2.5 pr-2.5 pl-4 shadow-[0_0_0_1px_var(--glass-edge),0_12px_32px_rgb(0_0_0/0.5)] [@media(max-height:820px)]:bottom-11"
    >
      <div className="flex w-36 shrink-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-silkscreen">
          <span className="size-2 flex-none rounded-full" style={{ background: color }} />
          <span className="truncate">{name}</span>
        </span>
        <span className="text-xs text-silkscreen-3">More {block.code} controls</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-4 gap-y-2">
        {knobs.map((k) =>
          k.toggle ? (
            <span key={k.id} className="flex w-[58px] flex-col items-center gap-1.5 text-xs font-medium tracking-wide text-silkscreen-3 uppercase">
              {paramTitle(k.label)}
              <Switch size="sm" checked={k.value >= 0.5} disabled={readOnly} onCheckedChange={(on) => editParam(block.index, Number(k.id), on ? 1 : 0)} aria-label={`${name} ${paramTitle(k.label)}`} />
            </span>
          ) : (
            <Dial
              key={k.id}
              label={paramTitle(k.label)}
              ariaLabel={`${name} ${paramTitle(k.label)}`}
              value={k.value}
              spec={k}
              size={34}
              color={color}
              disabled={readOnly}
              onChange={(v) => editParam(block.index, Number(k.id), v)}
              className="w-[58px]"
            />
          ),
        )}
      </div>
      <Button variant="ghost" size="icon" aria-label={`Close more ${block.code} controls`} onClick={onClose}>
        <XIcon aria-hidden />
      </Button>
    </div>
  );
}

interface SlotProps {
  block: BlockState;
  device: DeviceKey;
  order: number[];
  readOnly: boolean;
  showValues: boolean;
  dropSide: "before" | "after" | null;
  dragging: boolean;
  onDragStart(): void;
  onDragEnd(): void;
  onDragOver(e: DragEvent<HTMLDivElement>): void;
  onDrop(e: DragEvent): void;
  /** Model title, or the SnapTone slot name */
  name: string;
  /** This pedal's More controls strip is open */
  moreOpen: boolean;
  onMore(): void;
}

function SlotColumn({ block, device, readOnly, showValues, dropSide, dragging, onDragStart, onDragEnd, onDragOver, onDrop, name: label, moreOpen, onMore }: SlotProps) {
  const selected = useRig((s) => s.selected === block.index);
  const fromControl = useRef(false);
  const more = moreControls(block).length;
  const movable = isMovable(device, block.index) && !readOnly;
  const onPointerDownCapture = (e: PointerEvent) => {
    fromControl.current = !!(e.target as HTMLElement).closest("button,[role=slider],[role=switch],input");
    useRig.getState().select(block.index);
  };
  return (
    <BlockMenu block={block} readOnly={readOnly}>
      <div
        role="listitem"
        aria-label={`${block.code} ${label}, ${block.enabled ? "on" : "off"}${isMovable(device, block.index) ? ", movable" : ""}`}
        aria-current={selected || undefined}
        data-block={block.index}
        draggable={movable}
        onPointerDownCapture={onPointerDownCapture}
        onDragStart={(e) => {
          if (fromControl.current) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData(DRAG_MIME, String(block.index));
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={cn("relative flex flex-none flex-col items-center gap-2.5 [@media(max-height:820px)]:gap-2", movable && "cursor-grab", dragging && "opacity-50")}
      >
        {dropSide && <span aria-hidden className={cn("absolute top-10 bottom-10 w-[3px] rounded-pill bg-silkscreen", dropSide === "before" ? "-left-[19px]" : "-right-[19px]")} />}
        <ModelButton block={block} label={label} selected={selected} disabled={readOnly} />
        {block.code === "NS" && snapToneReplacesAmpCab(device) ? (
          <Capture
            name={label}
            on={block.enabled}
            interactive
            disabled={readOnly}
            onToggleOn={(on) => editEnabled(block.index, on)}
            className={cn(GEAR_W, "drop-shadow-[0_18px_24px_rgb(0_0_0/0.6)]", !block.enabled && "saturate-[.2] brightness-50")}
          />
        ) : (
          <GearFor
            block={block}
            name={label}
            interactive
            disabled={readOnly}
            showValues={showValues}
            onParam={(i, v) => editParam(block.index, i, v)}
            onToggleOn={(on) => editEnabled(block.index, on)}
            className={cn(GEAR_W, "drop-shadow-[0_18px_24px_rgb(0_0_0/0.6)]", !block.enabled && "saturate-[.2] brightness-50")}
          />
        )}
        <SlotFoot block={block} readOnly={readOnly} text={stateLine(block, device)} more={more ? { count: more, open: moreOpen, toggle: onMore } : undefined} />
      </div>
    </BlockMenu>
  );
}

/** NS engaged: the capture plus its dials, wider than a pedal column. */
function NsColumn({ block, readOnly, name, device }: { block: BlockState; readOnly: boolean; name: string; device: DeviceKey }) {
  const selected = useRig((s) => s.selected === block.index);
  const knobs = knobsForBlock(block);
  const short = useMediaQuery("(max-height: 820px)");
  const slot = snapToneLabel(device, snapToneIndex(block.fxid));
  return (
    <BlockMenu block={block} readOnly={readOnly}>
      <div
        role="listitem"
        aria-label={`NS ${name}, on`}
        aria-current={selected || undefined}
        data-block={block.index}
        onPointerDownCapture={() => useRig.getState().select(block.index)}
        className="relative flex w-[clamp(420px,36vw,520px)] flex-none flex-col items-center gap-2.5 [@media(max-height:820px)]:gap-2"
      >
        <ModelButton block={block} label={name} selected={selected} disabled={readOnly} />
        <div className="flex w-full items-start gap-[22px]">
          <Capture
            name={name}
            on
            interactive
            disabled={readOnly}
            onToggleOn={(on) => editEnabled(block.index, on)}
            className="w-[clamp(104px,calc((100vh-490px-var(--rig-banner,0px))*0.38),140px)] flex-none drop-shadow-[0_18px_24px_rgb(0_0_0/0.6)]"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-3.5 rounded-lg bg-[rgb(10_10_12/0.66)] px-4 py-3.5 [@media(max-height:820px)]:gap-2.5 [@media(max-height:820px)]:px-3.5 [@media(max-height:820px)]:py-2.5">
            <div className="flex flex-col gap-1">
              <b className="text-[15px] leading-tight font-semibold text-silkscreen">{name}</b>
              <span className="text-xs text-silkscreen-3">
                {name === slot ? "Playing" : `${slot}, playing`} in place of the amp and cab
              </span>
            </div>
            <div className="flex justify-between border-t border-seam pt-3 [@media(max-height:820px)]:pt-2">
              {knobs.map((k) => (
                <Dial
                  key={k.id}
                  label={paramTitle(k.label)}
                  ariaLabel={`${name} ${paramTitle(k.label)}`}
                  value={k.value}
                  spec={k}
                  size={short ? 34 : 46}
                  color="var(--block-ns)"
                  disabled={readOnly}
                  onChange={(v) => editParam(block.index, Number(k.id), v)}
                  className="w-[58px]"
                />
              ))}
            </div>
          </div>
        </div>
        <SlotFoot block={block} readOnly={readOnly} text={stateLine(block, device)} />
      </div>
    </BlockMenu>
  );
}
