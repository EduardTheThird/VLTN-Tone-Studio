import { useGp200Catalog } from "@/gp200/app/catalog-store";
import { modelByFxid } from "@/gp200/lib/catalog.mjs";
import type { BlockState, ParamInfo } from "@/state/device-types";
import { AmpHead, Cab } from "./Amp";
import { Capture, EqPedal } from "./EqPedal";
import { Pedal } from "./Pedal";
import { knobFromParam, type GearBaseProps, type GearKnob } from "./types";

/**
 * The end of a param's range that reads OFF: the minimum (a low cut at its lowest), except for a GP-200 catalog knob
 * that also has valueType 2, whose maximum is OFF (a high cut at its highest). The adapter keeps only `offAtMin`.
 */
function offEnd(block: BlockState, p: ParamInfo): GearKnob["off"] {
  if (!p.offAtMin) return undefined;
  const catalog = useGp200Catalog.getState().catalog;
  const knob = catalog ? modelByFxid(catalog, block.fxid, block.index)?.knobs.find((k) => k.id === p.index) : undefined;
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

export interface GearForProps extends Omit<GearBaseProps, "name" | "knobs" | "on" | "onKnobChange"> {
  block: BlockState;
  /** Called with the catalog param index and the new value */
  onParam?: (paramIndex: number, value: number) => void;
}

/** The drawing for any pedal block: pedal, EQ, capture (NS), amp head or cab. */
export function GearFor({ block, onParam, ...rest }: GearForProps) {
  const name = modelTitle(block);
  const knobs = knobsForBlock(block);
  const onKnobChange = onParam && ((id: string, v: number) => onParam(Number(id), v));
  const common = { name, knobs, on: block.enabled, onKnobChange, ...rest };
  switch (block.code) {
    case "NS":
      return <Capture {...common} />;
    case "EQ":
      return <EqPedal {...common} />;
    case "AMP":
      return <AmpHead {...common} type={block.model?.type} />;
    case "CAB":
      return <Cab name={name} className={rest.className} style={rest.style} />;
    default:
      return <Pedal {...common} block={block.code} />;
  }
}
