// The built-in GP-150 catalog (gp150/lib/catalog-data.mjs) in the app's ModelInfo/ParamInfo shape, so GP-150 modules
// render like every other family's. Param index = the param id (0..14, the preset block's f32 slot and the live 0x3033
// param byte).
import { GP150_CATALOG } from "@/gp150/lib/catalog-data.mjs";
import { defaultParams, modelByFxid, modelsForBlock, type Gp150Knob, type Gp150Model } from "@/gp150/lib/catalog.mjs";
import type { BlockName } from "@/gp150/lib/protocol.mjs";
import type { BlockCode, ModelInfo, ParamInfo } from "@/state/device-types";

/** What each module holds, as a model's category. */
export const GP150_BLOCK_TYPES: Readonly<Record<BlockName, string>> = {
  PRE: "Pre effect",
  WAH: "Wah",
  DST: "Drive",
  NS: "SnapTone",
  AMP: "Amp",
  NR: "Noise gate",
  CAB: "Cab",
  EQ: "EQ",
  MOD: "Modulation",
  DLY: "Delay",
  RVB: "Reverb",
  VOL: "Volume",
};

function toParamInfo(model: Gp150Model, knob: Gp150Knob): ParamInfo {
  const synced = model.knobs.find((k) => k.sync === knob.id);
  return {
    name: knob.name,
    index: knob.id,
    min: knob.min,
    max: knob.max,
    step: knob.step,
    default: knob.default,
    ...(knob.unit ? { unit: knob.unit } : {}),
    ...(knob.labels ? { labels: knob.labels } : {}),
    ...(knob.kind === "Switch" ? { toggle: true } : {}),
    ...(knob.kind === "Switch" && synced ? { syncs: synced.id } : {}),
  };
}

const MODELS = new WeakMap<Gp150Model, ModelInfo>();

/** One catalog model as a ModelInfo (memoized per model object). */
function toModelInfo(model: Gp150Model): ModelInfo {
  const hit = MODELS.get(model);
  if (hit) return hit;
  const block = model.module as BlockName;
  const info: ModelInfo = {
    fxid: model.code,
    block: block as BlockCode,
    name: model.name,
    title: model.name,
    type: GP150_BLOCK_TYPES[block] ?? model.module,
    params: model.knobs.map((k) => toParamInfo(model, k)),
  };
  MODELS.set(model, info);
  return info;
}

/** The model of `fxid` in module `block` (index or code). */
export function gp150ModelByFxid(fxid: number, block: number | BlockName): ModelInfo | undefined {
  const model = modelByFxid(GP150_CATALOG, fxid, block);
  return model ? toModelInfo(model) : undefined;
}

/** Every model of module `block` (index or code), in Suite's list order. */
export function gp150ModelsForBlock(block: number | BlockName): ModelInfo[] {
  return modelsForBlock(GP150_CATALOG, block).map(toModelInfo);
}

/** The 15 params a fresh model loads. */
export function gp150DefaultParams(fxid: number, block: number | BlockName): number[] {
  return defaultParams(GP150_CATALOG, fxid, block);
}
