import { EXP_TARGETS } from "@/gp5/lib/protocol.mjs";
import { expTargetParams } from "@/state/device-model";
import type { BlockCode, ExpSettings, ParamInfo, PresetState } from "@/state/device-types";

/** One row of the unsaved-changes table (overlays.md B): Block, Parameter, Saved, Now. */
export interface ChangeRow {
  /** null for preset-wide rows (chain order, volume, tempo, footswitches, EXP) */
  block: { code: BlockCode; model: string } | null;
  parameter: string;
  saved: string;
  now: string;
}

/** A param value as the pedal shows it: enum label (labels[value - min]), else the number with its unit. */
export const formatParamValue = (info: ParamInfo | undefined, v: number): string => {
  const label = info?.labels?.[Math.round(v - info.min)];
  if (label !== undefined) return label;
  const n = Math.round(v * 10) / 10;
  return info?.unit ? `${n} ${info.unit}` : String(n);
};

const EXP_ROWS: { field: keyof ExpSettings; label: string; show: (e: ExpSettings, p: PresetState) => string }[] = [
  { field: "on", label: "EXP", show: (e) => (e.on ? "On" : "Off") },
  { field: "targetModule", label: "EXP target", show: (e) => EXP_TARGETS[e.targetModule] ?? String(e.targetModule) },
  { field: "targetParam", label: "EXP parameter", show: (e, p) => expTargetParams(p, e.targetModule)[e.targetParam]?.name ?? `Parameter ${e.targetParam + 1}` },
  { field: "paramMin", label: "EXP minimum", show: (e) => `${e.paramMin}%` },
  { field: "paramMax", label: "EXP maximum", show: (e) => `${e.paramMax}%` },
  { field: "volPosition", label: "EXP volume position", show: (e) => (e.volPosition === 1 ? "Post" : "Pre") },
  { field: "volMin", label: "EXP volume minimum", show: (e) => `${e.volMin}%` },
  { field: "volMax", label: "EXP volume maximum", show: (e) => `${e.volMax}%` },
];

/** Differences between the live preset and the saved one, in chain-storage order. */
export function diffPresets(saved: PresetState, now: PresetState): ChangeRow[] {
  const rows: ChangeRow[] = [];
  now.blocks.forEach((b, i) => {
    const s = saved.blocks[i];
    if (!s) return;
    const block = { code: b.code, model: b.model?.title ?? s.model?.title ?? "Unknown model" };
    if (s.fxid !== b.fxid) {
      rows.push({ block, parameter: "Model", saved: s.model?.title ?? "Unknown model", now: b.model?.title ?? "Unknown model" });
    } else {
      b.params.forEach((v, p) => {
        if (v === s.params[p]) return;
        // Each side with its own spec: a Sync toggle turns a Time in ms into a note division.
        const info = b.model?.params.find((x) => x.index === p);
        const savedInfo = s.model?.params.find((x) => x.index === p) ?? info;
        rows.push({ block, parameter: info?.name ?? `Parameter ${p + 1}`, saved: formatParamValue(savedInfo, s.params[p]), now: formatParamValue(info, v) });
      });
    }
    if (s.enabled !== b.enabled) rows.push({ block, parameter: "On/off", saved: s.enabled ? "On" : "Off", now: b.enabled ? "On" : "Off" });
  });
  if (saved.order.join() !== now.order.join()) rows.push({ block: null, parameter: "Chain order", saved: "", now: "Changed" });
  if (saved.volume !== now.volume) rows.push({ block: null, parameter: "Volume", saved: String(saved.volume), now: String(now.volume) });
  if (saved.bpm !== now.bpm) rows.push({ block: null, parameter: "Tempo", saved: `${saved.bpm} BPM`, now: `${now.bpm} BPM` });
  if (saved.footswitches.fs1.join() !== now.footswitches.fs1.join() || saved.footswitches.fs2.join() !== now.footswitches.fs2.join())
    rows.push({ block: null, parameter: "Footswitches", saved: "", now: "Changed" });
  const se = saved.exp;
  const ne = now.exp;
  if (se && ne) for (const r of EXP_ROWS) if (se[r.field] !== ne[r.field]) rows.push({ block: null, parameter: r.label, saved: r.show(se, saved), now: r.show(ne, now) });
  return rows;
}
