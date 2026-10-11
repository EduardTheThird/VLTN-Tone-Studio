// Rig edit actions: every user edit goes through here so it lands in the undo history, then plays on the pedal
// through the device store (live edits) or changes the preset locally (reaching the pedal on save).
import { MAX_FOOTSWITCH_BLOCKS } from "@/gp5/lib/prst.mjs";
import { EXP_FIELDS } from "@/gp5/lib/protocol.mjs";
import { profileFor } from "@shared/devices";
import { useDevice } from "@/state/device";
import { switchLabel } from "@/state/device-model";
import type { BlockState, ExpEdit, ExpSettings, Gp200Edit, Gp200Fields, PresetState } from "@/state/device-types";
import { defaultParamsFor } from "@/state/preset-codec";
import { invert, useHistory, type BlockSnapshot, type Edit } from "./history";

const dev = () => useDevice.getState();

export const snapshot = (b: BlockState): BlockSnapshot => ({ index: b.index, fxid: b.fxid, enabled: b.enabled, params: [...b.params] });

export function editParam(block: number, index: number, value: number) {
  const p = dev().preset;
  if (!p) return;
  const from = p.blocks[block].params[index];
  dev().setParam(block, index, value);
  const to = dev().preset?.blocks[block].params[index] ?? value;
  if (to !== from) useHistory.getState().record({ kind: "param", block, index, from, to, at: performance.now() });
}

export function editEnabled(block: number, on: boolean) {
  const p = dev().preset;
  if (!p || p.blocks[block].enabled === on) return;
  dev().setBlockEnabled(block, on);
  useHistory.getState().record({ kind: "enabled", block, from: !on, to: on });
}

export function editOrder(order: number[]) {
  const p = dev().preset;
  if (!p) return;
  const from = [...p.order];
  dev().setOrder(order);
  useHistory.getState().record({ kind: "order", from, to: [...order] });
}

export function editVolume(volume: number) {
  const p = dev().preset;
  if (!p || p.volume === volume) return;
  const from = p.volume;
  dev().setVolume(volume);
  useHistory.getState().record({ kind: "volume", from, to: volume, at: performance.now() });
}

export function editBpm(bpm: number) {
  const p = dev().preset;
  if (!p) return;
  const from = p.bpm;
  dev().setBpm(bpm);
  const to = dev().preset?.bpm ?? from;
  if (to !== from) useHistory.getState().record({ kind: "bpm", from, to, at: performance.now() });
}

/** EXP settings edit (GP-50); the store checks every value and throws RangeError for one out of range. */
export function editExp(edit: ExpEdit) {
  const exp = dev().preset?.exp;
  if (!exp) return;
  // The same fields as `edit`, with the preset's current values (what undo puts back)
  const from = Object.fromEntries((EXP_FIELDS as (keyof ExpSettings)[]).filter((k) => edit[k] !== undefined).map((k) => [k, exp[k]])) as ExpEdit;
  dev().setExp(edit);
  useHistory.getState().record({ kind: "exp", from, to: edit, at: performance.now() });
}

/** `cur`'s values of the fields `keys` names. */
const pick = (cur: object, keys: object): Record<string, unknown> => Object.fromEntries(Object.keys(keys).map((k) => [k, (cur as Record<string, unknown>)[k]]));

/** The fields `edit` names, at their values in `g`. */
function patchValues(g: Gp200Fields, edit: Gp200Edit): Gp200Edit {
  const { exp, quickAccess, ...fields } = edit;
  return {
    ...pick(g, fields),
    ...(exp ? { exp: Object.fromEntries(Object.entries(exp).map(([i, e]) => [i, pick(g.exp[Number(i)], e)])) } : {}),
    ...(quickAccess ? { quickAccess: Object.fromEntries(Object.entries(quickAccess).map(([i, q]) => [i, pick(g.quickAccess[Number(i)], q)])) } : {}),
  };
}

/**
 * GP-200 family patch fields (FX loop, pan, style, author, note, EXP, Quick Access); reach the pedal on save. Recorded
 * as the preset stores them (names sanitized, EXP ranges as 32-bit floats); an edit that changes nothing isn't recorded.
 */
export function editPatchFields(edit: Gp200Edit) {
  const g = dev().preset?.gp200;
  if (!g) return;
  const from = patchValues(g, edit);
  dev().editPatch(edit);
  const now = dev().preset?.gp200;
  const to = now ? patchValues(now, edit) : edit;
  if (JSON.stringify(to) !== JSON.stringify(from)) useHistory.getState().record({ kind: "patch", from, to, at: performance.now() });
}

export function editFootswitches(lists: number[][]) {
  const p = dev().preset;
  if (!p) return;
  const from = p.footswitches.map((l) => [...l]);
  dev().setFootswitches(lists);
  useHistory.getState().record({ kind: "footswitches", from, to: lists });
}

/**
 * The switches of `p` a model shows, as indices into PresetState.footswitches: FS1 and FS2 on the GP-5 family; on the
 * GP-200 family one CTRL per footswitch (GP-200 8, LT 4, JR 3; the LT and JR counts aren't confirmed on a unit yet), and
 * any higher CTRL that holds blocks (external footswitches can play CTRL 5-8).
 */
export function shownSwitches(p: PresetState): number[] {
  const { ctrls, footswitches } = profileFor(p.device);
  return p.footswitches.flatMap((list, i) => (i < Math.min(ctrls, footswitches) || list.length > 0 ? [i] : []));
}

export type FootswitchToggle = { next: number[][] } | { reason: string };

/**
 * Assignment after toggling `block` on switch `which` (index into PresetState.footswitches). GP-50 rules: at most 3
 * blocks per switch, and a block on one switch only (assigning it moves it off the other switch). The other models
 * keep a free assignment.
 */
export function footswitchToggle(p: PresetState, which: number, block: number): FootswitchToggle {
  const list = p.footswitches[which] ?? [];
  const withList = (next: number[]) => p.footswitches.map((l, i) => (i === which ? next : l));
  if (list.includes(block)) return { next: withList(list.filter((b) => b !== block)) };
  const added = [...list, block].sort((a, b) => a - b);
  if (p.device !== "gp50") return { next: withList(added) };
  if (list.length >= MAX_FOOTSWITCH_BLOCKS) return { reason: `${switchLabel(p.device, which)} already switches ${MAX_FOOTSWITCH_BLOCKS} blocks, the most it can` };
  return { next: p.footswitches.map((l, i) => (i === which ? added : l.filter((b) => b !== block))) };
}

/** Toggle `block` on switch `which` (callers disable the menu item when footswitchToggle gives a reason). */
export function toggleFootswitch(which: number, block: number) {
  const p = dev().preset;
  if (!p) return;
  const t = footswitchToggle(p, which, block);
  if ("next" in t) editFootswitches(t.next);
}

/**
 * Put a block back to `target` with live edits: model (the pedal loads its defaults), then Sync toggles (they reset
 * and re-scale their Time/Rate), then every other catalog param that differs, then on/off.
 */
export async function applyBlock(target: BlockSnapshot) {
  let cur = dev().preset?.blocks[target.index];
  if (!cur) return;
  if (cur.fxid !== target.fxid) {
    await dev().setModel(target.index, target.fxid);
    cur = dev().preset?.blocks[target.index];
    if (!cur) return;
  }
  const differs = (b: BlockState, i: number) => Math.abs(b.params[i] - target.params[i]) > 1e-3;
  for (const p of cur.model?.params ?? []) if (p.syncs !== undefined && differs(cur, p.index)) dev().setParam(target.index, p.index, target.params[p.index]);
  cur = dev().preset?.blocks[target.index] ?? cur;
  for (const p of cur.model?.params ?? []) if (p.syncs === undefined && differs(cur, p.index)) dev().setParam(target.index, p.index, target.params[p.index]);
  if (cur.enabled !== target.enabled) dev().setBlockEnabled(target.index, target.enabled);
}

/** Record a whole-block change made elsewhere (model picker keep). */
export function recordBlock(label: string, from: BlockSnapshot, to: BlockSnapshot) {
  if (from.fxid === to.fxid && from.enabled === to.enabled && from.params.every((v, i) => Math.abs(v - to.params[i]) < 1e-3)) return;
  useHistory.getState().record({ kind: "block", label, from, to });
}

/** Apply a whole-block change and record it (paste settings, reset to defaults). */
export async function editBlock(label: string, to: BlockSnapshot) {
  const cur = dev().preset?.blocks[to.index];
  if (!cur) return;
  const from = snapshot(cur);
  await applyBlock(to);
  const after = dev().preset?.blocks[to.index];
  if (after) recordBlock(label, from, snapshot(after));
}

export function resetToDefaults(block: BlockState) {
  const p = dev().preset;
  if (!p) return Promise.resolve();
  return editBlock("Reset to defaults", { ...snapshot(block), params: defaultParamsFor(p.device, block.index, block.fxid) });
}

/** Apply an edit as described (redo) — the caller inverts it for undo. */
async function apply(e: Edit) {
  switch (e.kind) {
    case "param":
      return dev().setParam(e.block, e.index, e.to);
    case "enabled":
      return dev().setBlockEnabled(e.block, e.to);
    case "order":
      return dev().setOrder(e.to);
    case "volume":
      return dev().setVolume(e.to);
    case "bpm":
      return dev().setBpm(e.to);
    case "exp":
      return dev().setExp(e.to);
    case "footswitches":
      return dev().setFootswitches(e.to);
    case "patch":
      return dev().editPatch(e.to);
    case "block":
      return applyBlock(e.to);
  }
}

export async function undo() {
  const e = useHistory.getState().takeUndo();
  if (e) await apply(invert(e));
}

export async function redo() {
  const e = useHistory.getState().takeRedo();
  if (e) await apply(e);
}

/**
 * Play `target` on the pedal with live edits (Compare with saved): every block and the volume; chain order, tempo,
 * footswitches and EXP only where the pedal takes them live (GP-50 features), since otherwise they don't play.
 */
export async function playPreset(target: PresetState) {
  for (const b of target.blocks) await applyBlock(snapshot(b));
  const d = dev();
  const now = d.preset;
  if (!now) return;
  if (now.volume !== target.volume) d.setVolume(target.volume);
  if (d.can("liveOrder") && now.order.join() !== target.order.join()) d.setOrder(target.order);
  if (d.can("liveBpm") && now.bpm !== target.bpm) d.setBpm(target.bpm);
  if (d.can("liveFootswitches") && now.footswitches.some((l, i) => l.join() !== target.footswitches[i]?.join())) d.setFootswitches(target.footswitches);
  if (d.can("exp") && target.exp && now.exp) {
    const exp = target.exp;
    const changed = (EXP_FIELDS as (keyof ExpSettings)[]).filter((k) => now.exp?.[k] !== exp[k]);
    if (changed.length) d.setExp(Object.fromEntries(changed.map((k) => [k, exp[k]])) as ExpEdit);
  }
}
