// Chain order helpers for the Rig. Order = permutation of the preset's block indices. GP-5 family (0 NR, 1 PRE, 2 DST,
// 3 AMP, 4 CAB, 5 EQ, 6 MOD, 7 DLY, 8 RVB, 9 NS): NR/PRE/MOD/DLY/RVB can move; the core DST, NS, AMP, CAB, EQ stays
// contiguous. GP-200 family: every block can move.
import { profileFor, type DeviceKey } from "@shared/devices";
import { isGp5Family } from "@/state/device-model";
import { orderError } from "@/state/preset-codec";

/** GP-5 family: the blocks that may move, and DST, where the fixed core starts. */
const GP5_MOVABLE: readonly number[] = [0, 1, 6, 7, 8];
const GP5_CORE_START = 2;

/** The amp and cab blocks of `device`'s presets. */
export function ampCab(device: DeviceKey): { amp: number; cab: number } {
  const { blocks } = profileFor(device);
  return { amp: blocks.indexOf("AMP"), cab: blocks.indexOf("CAB") };
}

export type GroupId = "before" | "amp" | "after";
export const GROUPS: readonly GroupId[] = ["before", "amp", "after"];
export const GROUP_TITLE: Record<GroupId, string> = { before: "Before the amp", amp: "Amp & cab", after: "After the amp" };

export const isMovable = (device: DeviceKey, block: number) => !isGp5Family(device) || GP5_MOVABLE.includes(block);

/** Blocks of each group in signal order: before = everything ahead of AMP, amp = AMP and CAB, after = the rest. */
export function groupsOf(device: DeviceKey, order: readonly number[]): Record<GroupId, number[]> {
  const { amp, cab } = ampCab(device);
  const a = order.indexOf(amp);
  const notCab = (b: number) => b !== cab;
  return { before: order.slice(0, a).filter(notCab), amp: [amp, cab], after: order.slice(a + 1).filter(notCab) };
}

export function groupOf(device: DeviceKey, order: readonly number[], block: number): GroupId {
  const g = groupsOf(device, order);
  return g.before.includes(block) ? "before" : g.after.includes(block) ? "after" : "amp";
}

/** Insert `block` at `index` of the order without it; null when not a legal chain. */
function insertAt(device: DeviceKey, order: readonly number[], block: number, index: number): number[] | null {
  const rest = order.filter((b) => b !== block);
  const next = [...rest.slice(0, index), block, ...rest.slice(index)];
  return orderError(device, next) === null ? next : null;
}

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Move `block` next to `target` (before or after it). Null when the block is fixed, the drop would split the
 * core, or nothing changes.
 */
export function moveBlock(device: DeviceKey, order: readonly number[], block: number, target: number, side: "before" | "after"): number[] | null {
  if (!isMovable(device, block) || block === target || orderError(device, order) !== null) return null;
  const rest = order.filter((b) => b !== block);
  const t = rest.indexOf(target);
  if (t < 0) return null;
  const next = insertAt(device, order, block, side === "before" ? t : t + 1);
  return next && !same(next, order) ? next : null;
}

/** Move `block` to the end of a group (overview drop): last before the amp group, or last in the chain. */
export function moveToGroup(device: DeviceKey, order: readonly number[], block: number, group: GroupId): number[] | null {
  if (!isMovable(device, block) || group === "amp") return null;
  const rest = order.filter((b) => b !== block);
  // just ahead of the GP-5 family's core (DST) or of AMP / chain end
  const index = group === "before" ? rest.indexOf(isGp5Family(device) ? GP5_CORE_START : ampCab(device).amp) : rest.length;
  const next = insertAt(device, order, block, index);
  return next && !same(next, order) ? next : null;
}

/** Keyboard reorder: the next legal position left (-1) or right (+1), jumping over the core as a unit. */
export function nudge(device: DeviceKey, order: readonly number[], block: number, dir: -1 | 1): number[] | null {
  if (!isMovable(device, block)) return null;
  const i = order.indexOf(block);
  for (let j = i + dir; j >= 0 && j <= order.length - 1; j += dir) {
    const next = insertAt(device, order, block, j);
    if (next && !same(next, order)) return next;
  }
  return null;
}

/**
 * GP-200 family FX loop: the send and return nodes sit in gaps of the chain, a position counting the blocks in front of
 * the node in signal order. The pedal takes 1..11 (1 = after the first block, 11 = after the last) and never puts the
 * return in front of the send (Valeton's GP-200 manual; GP200 Studio's patch docs give the same range).
 */
export interface LoopPos {
  sendPos: number;
  returnPos: number;
}
export type LoopNode = "send" | "return";
export type ChainItem = { block: number } | { node: LoopNode };

/** Positions `node` can take in a chain of `n` blocks: send 1..return, return send..n (none when the other is off range). */
export function loopRange(loop: LoopPos, node: LoopNode, n: number): [number, number] {
  return node === "send" ? [1, Math.min(n, loop.returnPos)] : [Math.max(1, loop.sendPos), n];
}

/** `loop` with `node` at `pos`, or null when the pedal can't take it there or nothing changes. */
export function moveLoopNode(loop: LoopPos, node: LoopNode, pos: number, n: number): LoopPos | null {
  const [lo, hi] = loopRange(loop, node, n);
  const cur = node === "send" ? loop.sendPos : loop.returnPos;
  if (!Number.isInteger(pos) || pos < lo || pos > hi || pos === cur) return null;
  return node === "send" ? { ...loop, sendPos: pos } : { ...loop, returnPos: pos };
}

/** Blocks in signal order with the loop nodes in their gaps, as stored (a position outside 0..n at the nearer end). */
export function chainItems(order: readonly number[], loop: LoopPos): ChainItem[] {
  const at = (p: number) => Math.max(0, Math.min(order.length, p));
  const items: ChainItem[] = [];
  for (let gap = 0; gap <= order.length; gap++) {
    if (at(loop.sendPos) === gap) items.push({ node: "send" });
    if (at(loop.returnPos) === gap) items.push({ node: "return" });
    if (gap < order.length) items.push({ block: order[gap] });
  }
  return items;
}

/** Where gap `pos` of the chain is: "after AMP", or "before PRE" for the input end. */
export const gapLabel = (order: readonly number[], pos: number, codes: readonly string[]) =>
  pos <= 0 ? `before ${codes[order[0]]}` : `after ${codes[order[Math.min(pos, order.length) - 1]]}`;

/** "A", "A and B", "A, B and C". */
export const joinAnd = (items: readonly string[]) => (items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/**
 * Board hint for one side of the amp, from the order rules: which of its pedals can move and which stay put.
 * `codes[b]` is the block code of block index b.
 */
export function orderHint(device: DeviceKey, order: readonly number[], group: "before" | "after", codes: readonly string[]): string {
  const blocks = groupsOf(device, order)[group];
  const movable = blocks.filter((b) => isMovable(device, b)).map((b) => codes[b]);
  const fixed = blocks.filter((b) => !isMovable(device, b)).map((b) => codes[b]);
  const stays = fixed.length ? `${joinAnd(fixed)} ${fixed.length === 1 ? "stays" : "stay"} ${group === "before" ? "in front of the amp" : "right after the cab"}` : "";
  if (!movable.length) return `${stays}. To bring a pedal here, drag it onto “${GROUP_TITLE[group]}” in the chain overview.`;
  return `Drag a pedal to reorder. ${joinAnd(movable)} can move${stays ? `; ${stays}` : ""}.`;
}
