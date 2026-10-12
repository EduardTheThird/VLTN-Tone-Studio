// GP-150 effect catalog lookups (the data: catalog-data.mjs). Pure, isomorphic ESM.
// Catalog shape: { meta: { device, source, counts }, modules: [{ module, algs: [{ name, module, code, index,
//   knobs: [{ kind: "Knob" | "Switch" | "Combox", name, id, default, min, max, step, labels?, sync? }] }] }] }
// `id` is the param id (0..14, the f32 slot of the preset block and the live 0x3033 param byte); `sync` names the id of
// the switch that turns this Time/Rate knob into note values.

import { BLOCKS, PARAM_COUNT } from "./protocol.mjs";

const INDEX = new WeakMap();
function indexOf(catalog) {
  let ix = INDEX.get(catalog);
  if (!ix) {
    ix = new Map(catalog.modules.map((m) => [m.module, new Map(m.algs.map((a) => [a.code >>> 0, a]))]));
    INDEX.set(catalog, ix);
  }
  return ix;
}
const moduleName = (block) => (typeof block === "number" ? BLOCKS[block] : String(block).toUpperCase());

/** Model `fxid` of module `block` (index or code). */
export function modelByFxid(catalog, fxid, block) {
  return indexOf(catalog).get(moduleName(block))?.get(fxid >>> 0);
}

/** Every model of a module, in Suite's list order. */
export function modelsForBlock(catalog, block) {
  return catalog.modules.find((m) => m.module === moduleName(block))?.algs ?? [];
}

/** Value for the pedal: within [min, max], on a step. */
export function clampParam(knob, value) {
  const v = Math.min(knob.max, Math.max(knob.min, Number(value)));
  const stepped = knob.step > 0 ? knob.min + Math.round((v - knob.min) / knob.step) * knob.step : v;
  return Number(stepped.toFixed(6));
}

/** The 15 params a fresh model loads: its controls at their defaults, the rest 0. */
export function defaultParams(catalog, fxid, block) {
  const out = new Array(PARAM_COUNT).fill(0);
  for (const k of modelByFxid(catalog, fxid, block)?.knobs ?? []) out[k.id] = k.default;
  return out;
}
