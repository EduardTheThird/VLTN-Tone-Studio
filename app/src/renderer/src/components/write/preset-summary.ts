// Read-only summary of a .prst of any family for lists, chain previews and write confirmations.
import { profileFor } from "@shared/devices";
import { isGp5Family, modelsMissingOn } from "@/state/device-model";
import type { BlockState, DeviceKey, ExpSettings, SlotName } from "@/state/device-types";
import { toPresetState } from "@/state/preset-codec";

export type SummaryBlock = BlockState;

export interface PresetSummary {
  /** Model the file was made for (a GP-200 family file reads as "gp200"); its catalog names the blocks */
  device: DeviceKey;
  name: string;
  /** Storage order (profileFor(device).blocks) */
  blocks: SummaryBlock[];
  /** Chain order (block indices) */
  order: number[];
  volume: number;
  bpm: number;
  /** Switch assignments, one block list per switch (FS1 and FS2, or CTRL 1-8) */
  footswitches: number[][];
  /** Blocks whose model only exists on the GP-50, e.g. "PRE (PRE C-Wah)"; dropped when converting to the GP-5 */
  gp50Only: string[];
  /** EXP pedal settings stored with the preset (GP-50); null on models without them */
  exp: ExpSettings | null;
  /** Time/Rate params set to follow the tempo (GP-50 Sync on), e.g. "DLY Time" */
  synced: string[];
}

/** "DLY Time" for every Time/Rate param whose Sync toggle is on (GP-50). */
function syncedParams(blocks: readonly SummaryBlock[]): string[] {
  return blocks.flatMap((b) =>
    (b.model?.params ?? []).filter((p) => p.syncs !== undefined && b.params[p.index] >= 0.5).flatMap((toggle) => {
      const bound = b.model?.params.find((p) => p.index === toggle.syncs);
      return bound ? [`${b.code} ${bound.name}`] : [];
    }),
  );
}

const cache = new WeakMap<Uint8Array, PresetSummary | null>();

/** Parse once per byte array; null when the bytes are not a valid preset. */
export function summarize(prst: Uint8Array): PresetSummary | null {
  if (cache.has(prst)) return cache.get(prst)!;
  let out: PresetSummary | null = null;
  try {
    const p = toPresetState(0, prst);
    out = {
      device: p.device,
      name: p.name,
      blocks: p.blocks,
      order: p.order,
      volume: p.volume,
      bpm: p.bpm,
      footswitches: p.footswitches,
      gp50Only: isGp5Family(p.device) ? modelsMissingOn(prst, "gp5") : [],
      exp: p.exp,
      synced: syncedParams(p.blocks),
    };
  } catch {
    out = null;
  }
  cache.set(prst, out);
  return out;
}

/**
 * The "Amp or SnapTone" column: with NS on, the SnapTone slot name (user names when read), otherwise the amp.
 */
export function ampOrSnapTone(s: PresetSummary, snapTones: SlotName[] | null): { kind: "snaptone" | "amp"; title: string } | null {
  const { blocks, snapTone } = profileFor(s.device);
  const isCapture = (b: SummaryBlock) => b.fxid >>> 24 === snapTone.fxidBase >>> 24;
  const ns = s.blocks[blocks.indexOf("NS")];
  const amp = s.blocks[blocks.indexOf("AMP")];
  // GP-5 family: NS on replaces the amp; GP-200 family: a SnapTone plays in the AMP block itself
  const capture = ns?.enabled ? ns : amp && isCapture(amp) ? amp : undefined;
  if (capture) {
    const named = isCapture(capture) ? snapTones?.find((t) => t.slot === (capture.fxid & 0xff))?.name : undefined;
    return { kind: "snaptone", title: named || capture.model?.title || "SnapTone" };
  }
  return amp?.model ? { kind: "amp", title: amp.model.title } : null;
}

/** Plain description for confirmations: "Rector Dual V, 7 of 10 blocks on". */
export function describeSummary(s: PresetSummary, snapTones: SlotName[] | null): string {
  const lead = ampOrSnapTone(s, snapTones)?.title;
  const on = s.blocks.filter((b) => b.enabled).length;
  return [lead, `${on} of ${s.blocks.length} blocks on`].filter(Boolean).join(", ");
}
