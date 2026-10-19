import { DEVICE_KEYS, PROFILES, type SlotTables } from "@shared/devices";
import { useGp200Catalog } from "@/gp200/app/catalog-store";
import { modelByFxid } from "@/gp200/lib/catalog.mjs";
import { NONE_FXID } from "@/gp150/lib/protocol.mjs";
import type { BlockState, ParamInfo } from "@/state/device-types";
import { AmpHead, Cab } from "./Amp";
import { Capture, EqPedal, eqControls } from "./EqPedal";
import { Pedal, pedalControls } from "./Pedal";
import { knobFromParam, type GearBaseProps, type GearKnob } from "./types";

/**
 * The end of a param's range that reads OFF: the minimum (a low cut at its lowest), except for a GP-200 catalog knob
 * that also has valueType 2, whose maximum is OFF (a high cut at its highest). The adapter keeps only `offAtMin`.
 */
function offEnd(block: BlockState, p: ParamInfo): GearKnob["off"] {
  if (!p.offAtMin) return undefined;
  const knob = modelByFxid(useGp200Catalog.getState().catalog, block.fxid, block.index)?.knobs.find((k) => k.id === p.index);
  return knob?.valueType === 2 ? "max" : "min";
}

/** Knobs of a block from its catalog params (values in display units). */
export function knobsForBlock(block: BlockState): GearKnob[] {
  return (block.model?.params ?? []).map((p) => knobFromParam(p, block.params[p.index] ?? p.default, offEnd(block, p)));
}

/** Display name of a block's model (catalog title), or a fallback for fxids missing from the catalog. */
export function modelTitle(block: BlockState): string {
  return block.model?.title ?? `Unknown ${block.code} model`;
}

const inTable = (fxid: number, t: SlotTables) => fxid >= t.fxidBase && fxid < t.fxidBase + t.slots;
/** A SnapTone slot: NS on the GP-5 family, AMP (slots 0-4) or DST (5-9) on the GP-200 family. */
export const isCaptureFxid = (fxid: number) => DEVICE_KEYS.some((k) => inTable(fxid, PROFILES[k].snapTone));
/** A User IR slot in the CAB block. */
export const isUserIrFxid = (fxid: number) => DEVICE_KEYS.some((k) => inTable(fxid, PROFILES[k].userIr));

export type GearArt = "pedal" | "eq" | "capture" | "amp" | "cab";

/**
 * The drawing a block gets: a SnapTone by its fxid, whichever block plays it; NS (also a GP-150 NAM slot) as a capture
 * unless it is the GP-150's empty module; the rest by block.
 */
export function artFor(block: Pick<BlockState, "code" | "fxid">): GearArt {
  if ((block.code === "NS" && block.fxid >>> 0 !== NONE_FXID) || isCaptureFxid(block.fxid)) return "capture";
  return block.code === "EQ" ? "eq" : block.code === "AMP" ? "amp" : block.code === "CAB" ? "cab" : "pedal";
}

/** The knobs a block's board drawing shows: NS dials sit beside the capture, amp and cab controls in their own views. */
function drawnKnobs(block: BlockState, all: GearKnob[]): GearKnob[] {
  switch (artFor(block)) {
    case "pedal": {
      const { knobs, toggles } = pedalControls(all);
      return [...knobs, ...toggles];
    }
    case "eq": {
      const { bands, vol } = eqControls(all);
      return vol ? [...bands, vol] : bands;
    }
    case "capture":
      return block.code === "NS" ? all : [];
    default:
      return all;
  }
}

/**
 * Controls of a board pedal its drawing has no room for, for a More controls strip: a pedal holds 9 knobs and 3
 * switches, an EQ 6 bands and a volume, a GP-200 SnapTone in AMP or DST none.
 */
export function moreControls(block: BlockState): GearKnob[] {
  const all = knobsForBlock(block);
  const shown = drawnKnobs(block, all);
  return all.filter((k) => !shown.includes(k));
}

export interface GearForProps extends Omit<GearBaseProps, "name" | "knobs" | "on" | "onKnobChange"> {
  block: BlockState;
  /** Name printed on the drawing (default: the model title) */
  name?: string;
  /** Called with the catalog param index and the new value */
  onParam?: (paramIndex: number, value: number) => void;
}

/** The drawing for any block: pedal, EQ, SnapTone capture, amp head or cab. */
export function GearFor({ block, name = modelTitle(block), onParam, ...rest }: GearForProps) {
  const knobs = knobsForBlock(block);
  const onKnobChange = onParam && ((id: string, v: number) => onParam(Number(id), v));
  const common = { name, knobs, on: block.enabled, onKnobChange, ...rest };
  switch (artFor(block)) {
    case "capture":
      return <Capture {...common} block={block.code} />;
    case "eq":
      return <EqPedal {...common} />;
    case "amp":
      return <AmpHead {...common} type={block.model?.type} origin={block.model?.origin} />;
    case "cab":
      return <Cab name={name} ir={isUserIrFxid(block.fxid)} origin={block.model?.origin} className={rest.className} style={rest.style} />;
    default:
      return <Pedal {...common} block={block.code} origin={block.model?.origin} />;
  }
}
