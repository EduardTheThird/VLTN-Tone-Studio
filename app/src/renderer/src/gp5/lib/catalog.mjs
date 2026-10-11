// Effect/model catalog lookups for the GP-5 and GP-50. Data: ./catalog-data.mjs (generated, one merged list).
// Every lookup takes the device key ("gp5" | "gp50"): the GP-50 has 3 more models and tempo-sync params that the
// GP-5 lacks, so a model's param list depends on the pedal.
// Param fields: name, index (algId), min, max, step, default, unit?, toggle?, labels? (enum: labels[value]),
// syncs? (on a Sync toggle: algId of the Time/Rate param it switches to note divisions).
import { BLOCKS } from "./protocol.mjs";
import { MODELS as ALL_MODELS, SNAPTONE_PARAMS } from "./catalog-data.mjs";

const SNAPTONE_SLOTS = 80;

function build(device) {
  const keep = (x) => !x.only || x.only === device;
  const strip = ({ only, ...rest }) => (void only, rest);
  const models = ALL_MODELS.filter(keep).map((m) => Object.freeze({ ...strip(m), params: m.params.filter(keep).map(strip) }));
  return { models: Object.freeze(models), byFxid: new Map(models.map((m) => [m.fxid, m])) };
}
const CATALOGS = Object.freeze({ gp5: build("gp5"), gp50: build("gp50") });

function catalogOf(device) {
  const c = CATALOGS[device];
  if (!c) throw new RangeError(`unknown device ${JSON.stringify(device)}; expected "gp5" or "gp50"`);
  return c;
}

/** Every model of `device` outside the NS block. */
export function modelsFor(device) {
  return catalogOf(device).models;
}

/** Model entry for an fxid on `device` (SnapTone slots synthesized); undefined when the pedal has no such model. */
export function modelByFxid(fxid, device) {
  const id = fxid >>> 0;
  const c = catalogOf(device);
  if (c.byFxid.has(id)) return c.byFxid.get(id);
  if (id >>> 24 === 0x0f && (id & 0xffffff) < SNAPTONE_SLOTS) {
    const n = id & 0xff;
    return { fxid: id, block: "NS", name: `SnapTone ${n}`, title: `Tone Catch ${n + 1}`, type: "SnapTone", params: SNAPTONE_PARAMS };
  }
  return undefined;
}

/** All models of `device` in a block ("AMP", 3, ...). NS returns the 80 SnapTone slots. */
export function modelsForBlock(block, device) {
  const name = typeof block === "number" ? BLOCKS[block] : String(block).toUpperCase();
  if (name === "NS") return Array.from({ length: SNAPTONE_SLOTS }, (_, n) => modelByFxid(0x0f000000 | n, device));
  return catalogOf(device).models.filter((m) => m.block === name);
}

/** Case-insensitive search by name or title within a block (undefined = everywhere) on `device`. */
export function findModel(query, block, device) {
  const q = String(query).toLowerCase();
  const pool = block === undefined ? modelsFor(device) : modelsForBlock(block, device);
  return pool.find((m) => m.name.toLowerCase() === q || m.title.toLowerCase() === q) ?? pool.find((m) => m.name.toLowerCase().includes(q) || m.title.toLowerCase().includes(q));
}

/** Resolve a parameter of a model by name (e.g. "Gain", "Time") -> { name, index, min, max, ... }. */
export function findParam(fxid, paramName, device) {
  const m = modelByFxid(fxid, device);
  if (!m) throw new RangeError(`unknown fxid 0x${(fxid >>> 0).toString(16)}`);
  const q = String(paramName).toLowerCase();
  const p = m.params.find((x) => x.name.toLowerCase() === q);
  if (!p) throw new RangeError(`${m.title} has no param ${paramName}; params: ${m.params.map((x) => x.name).join(", ")}`);
  return p;
}

/** Clamp + snap a value to the parameter's range/step. */
export function clampParam(p, value) {
  let v = Math.min(p.max, Math.max(p.min, Number(value)));
  if (p.toggle) return v >= 0.5 ? 1 : 0;
  if (p.step > 0) v = p.min + Math.round((v - p.min) / p.step) * p.step;
  return Number(v.toFixed(6));
}

/** Default param array (8 slots) for a model, as the pedal loads them on a model change (per Suite data). */
export function defaultParams(fxid, device) {
  const out = new Array(8).fill(0);
  for (const p of modelByFxid(fxid, device)?.params ?? []) out[p.index] = p.default;
  return out;
}

/** Note divisions a synced Time/Rate param holds as an index 0..10 (GP-50, Valeton Suite 2.1.0 RE). */
export const SYNC_DIVISIONS = Object.freeze(["1/1", "1/2", "1/2D", "1/2T", "1/4", "1/4D", "1/4T", "1/8", "1/8D", "1/8T", "1/16"]);
/** Division index the pedal sets when Sync turns on (1/4); turning Sync off restores the param's default. */
export const SYNC_ON_DIVISION = 4;

/** The Sync toggle param that switches param `algId` of model `fxid` to note divisions, or undefined. */
export function syncToggleFor(fxid, algId, device) {
  return modelByFxid(fxid, device)?.params.find((p) => p.syncs === algId);
}

/** True when param `algId` of a block (model `fxid`, current `params`) is synced and so holds a division index. */
export function isSynced(fxid, algId, params, device) {
  const toggle = syncToggleFor(fxid, algId, device);
  return !!toggle && params[toggle.index] >= 0.5;
}

/**
 * The param spec as the pedal currently shows it: a synced Time/Rate becomes a 0..10 index labelled with
 * SYNC_DIVISIONS; anything else is returned unchanged. undefined when the model has no such param.
 */
export function displayedParam(fxid, algId, params, device) {
  const p = modelByFxid(fxid, device)?.params.find((x) => x.index === algId);
  if (!p || !isSynced(fxid, algId, params, device)) return p;
  const { unit, ...rest } = p;
  void unit;
  return { ...rest, min: 0, max: SYNC_DIVISIONS.length - 1, step: 1, default: SYNC_ON_DIVISION, labels: SYNC_DIVISIONS };
}

/** Human-readable view of a parsed preset (from prst.parsePrst; its `device` selects the catalog). */
export function describePreset(parsed) {
  return parsed.blocks.map((b) => {
    const m = modelByFxid(b.fxid, parsed.device);
    return {
      block: b.name,
      enabled: b.enabled,
      fxid: `0x${b.fxid.toString(16).padStart(8, "0")}`,
      model: m ? m.title : "unknown",
      params: Object.fromEntries((m?.params ?? []).map((p) => [p.name, b.params[p.index]])),
    };
  });
}
