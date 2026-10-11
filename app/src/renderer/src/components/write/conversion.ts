// What writing a preset made on one pedal model to another (GP-5 ⇄ GP-50) does, in plain words. Presets of another
// family (GP-200 on a GP-5, …) are refused, not converted.
import { convertsLosslessly, crossFamilyNote, pedalName } from "@/state/device-model";
import type { DeviceKey } from "@/state/device-types";
import { profileFor } from "@shared/devices";
import type { PresetSummary } from "./preset-summary";

export interface Conversion {
  from: DeviceKey;
  to: DeviceKey;
  /** Blocks left empty because their model doesn't exist on `to`, e.g. "PRE (PRE C-Wah)" */
  dropped: string[];
  /** Why it can't be written at all (another family), else null */
  refused: string | null;
}

/** The conversion writing `s` to a `target` pedal needs; null when the models match or the pedal model is unknown. */
export function conversionFor(s: Pick<PresetSummary, "device" | "gp50Only">, target: DeviceKey | null): Conversion | null {
  if (!target || s.device === target) return null;
  if (profileFor(s.device).family !== profileFor(target).family) return { from: s.device, to: target, dropped: [], refused: crossFamilyNote(s.device, target) };
  return { from: s.device, to: target, dropped: convertsLosslessly(s.device, target) ? [] : s.gp50Only, refused: null };
}

/** The conversion can lose blocks (or can't happen at all), so lists flag it on the preset itself. */
export function isLossy(c: Conversion): boolean {
  return c.refused !== null || !convertsLosslessly(c.from, c.to);
}

/** "PRE (PRE C-Wah) has no GP-5 equivalent, so that block is left empty." Empty when nothing is dropped. */
export function droppedSentence(c: Pick<Conversion, "to" | "dropped">): string {
  const n = c.dropped.length;
  if (!n) return "";
  return `${c.dropped.join(", ")} ${n === 1 ? "has" : "have"} no ${pedalName(c.to)} equivalent, so ${n === 1 ? "that block is" : "those blocks are"} left empty.`;
}

/** "Made on a GP-50. Converted for your GP-5 when you write it; …" GP-5 → GP-50 says nothing is lost. */
export function conversionNote(c: Pick<Conversion, "from" | "to" | "dropped"> & { refused?: string | null }): string {
  if (c.refused) return c.refused;
  const lead = `Made on a ${pedalName(c.from)}. Converted for your ${pedalName(c.to)} when you write it`;
  if (c.dropped.length) return `${lead}. ${droppedSentence(c)}`;
  return convertsLosslessly(c.from, c.to) ? `${lead}; nothing is lost.` : `${lead}.`;
}
