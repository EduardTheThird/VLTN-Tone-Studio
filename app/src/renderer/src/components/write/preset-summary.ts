// Read-only summary of a GP-5 family .prst (GP-5 or GP-50) for lists, chain previews and write confirmations.
import { parsePrst } from "@/gp5/lib/prst.mjs";
import { modelByFxid } from "@/gp5/lib/catalog.mjs";
import { profileFor } from "@shared/devices";
import { blockCodes, modelsMissingOn } from "@/state/device-model";
import type { BlockCode, Gp5FamilyKey, ModelInfo, SlotName } from "@/state/device-types";

export interface SummaryBlock {
  index: number;
  code: BlockCode;
  enabled: boolean;
  fxid: number;
  model: ModelInfo | undefined;
  params: number[];
}

export interface PresetSummary {
  /** Model the file was made for (from its header); its catalog names the blocks */
  device: Gp5FamilyKey;
  name: string;
  /** Storage order (profileFor(device).blocks) */
  blocks: SummaryBlock[];
  /** Chain order (block indices) */
  order: number[];
  volume: number;
  bpm: number;
  footswitches: { fs1: number[]; fs2: number[] };
  /** Blocks whose model only exists on the GP-50, e.g. "PRE (PRE C-Wah)"; dropped when converting to the GP-5 */
  gp50Only: string[];
}

const cache = new WeakMap<Uint8Array, PresetSummary | null>();

/** Parse once per byte array; null when the bytes are not a valid preset. */
export function summarize(prst: Uint8Array): PresetSummary | null {
  if (cache.has(prst)) return cache.get(prst)!;
  let out: PresetSummary | null = null;
  try {
    const p = parsePrst(prst);
    const device: Gp5FamilyKey = p.device;
    const codes = blockCodes(device);
    const blocks = p.blocks.map((b: { enabled: boolean; fxid: number; params: number[] }, index: number) => {
      const fxid = b.fxid >>> 0;
      return { index, code: codes[index], enabled: b.enabled, fxid, model: modelByFxid(fxid, device) as ModelInfo | undefined, params: b.params };
    });
    out = {
      device,
      name: p.name,
      blocks,
      order: p.order,
      volume: p.settings.volume,
      bpm: p.settings.bpm,
      footswitches: { fs1: p.footswitches.fs1, fs2: p.footswitches.fs2 },
      gp50Only: modelsMissingOn(prst, "gp5"),
    };
  } catch {
    out = null;
  }
  cache.set(prst, out);
  return out;
}

/** SnapTone slot (0-based) of `device` for an NS fxid ("Tone Catch N" = slot N−1); null for any other fxid. */
function snapToneIndex(fxid: number, device: Gp5FamilyKey): number | null {
  const base = profileFor(device).snapTone.fxidBase;
  return fxid >>> 24 === base >>> 24 ? fxid & 0xff : null;
}

/**
 * The "Amp or SnapTone" column: with NS on, the SnapTone slot name (user names when read), otherwise the amp.
 */
export function ampOrSnapTone(s: PresetSummary, snapTones: SlotName[] | null): { kind: "snaptone" | "amp"; title: string } | null {
  const codes = blockCodes(s.device);
  const ns = s.blocks[codes.indexOf("NS")];
  if (ns.enabled) {
    const idx = snapToneIndex(ns.fxid, s.device);
    const named = idx === null ? undefined : snapTones?.find((t) => t.slot === idx)?.name;
    return { kind: "snaptone", title: named || ns.model?.title || "SnapTone" };
  }
  const amp = s.blocks[codes.indexOf("AMP")];
  return amp.model ? { kind: "amp", title: amp.model.title } : null;
}

/** Plain description for confirmations: "Rector Dual V, 7 of 10 blocks on". */
export function describeSummary(s: PresetSummary, snapTones: SlotName[] | null): string {
  const lead = ampOrSnapTone(s, snapTones)?.title;
  const on = s.blocks.filter((b) => b.enabled).length;
  return [lead, `${on} of ${s.blocks.length} blocks on`].filter(Boolean).join(", ");
}
