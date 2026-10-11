// What writing a preset made on one pedal model to the other (GP-5 ⇄ GP-50) does, in plain words.
import { pedalName } from "@/state/device-model";
import type { DeviceKey } from "@/state/device-types";
import type { PresetSummary } from "./preset-summary";

export interface Conversion {
  from: DeviceKey;
  to: DeviceKey;
  /** Blocks left empty because their model doesn't exist on `to`, e.g. "PRE (PRE C-Wah)" */
  dropped: string[];
}

/** The conversion writing `s` to a `target` pedal needs; null when the models match or the pedal model is unknown. */
export function conversionFor(s: Pick<PresetSummary, "device" | "gp50Only">, target: DeviceKey | null): Conversion | null {
  if (!target || s.device === target) return null;
  return { from: s.device, to: target, dropped: target === "gp5" ? s.gp50Only : [] };
}

/** "PRE (PRE C-Wah) has no GP-5 equivalent, so that block is left empty." Empty when nothing is dropped. */
export function droppedSentence(c: Conversion): string {
  const n = c.dropped.length;
  if (!n) return "";
  return `${c.dropped.join(", ")} ${n === 1 ? "has" : "have"} no ${pedalName(c.to)} equivalent, so ${n === 1 ? "that block is" : "those blocks are"} left empty.`;
}

/** "Made on a GP-50. Converted for your GP-5 when you write it; …" GP-5 → GP-50 says nothing is lost. */
export function conversionNote(c: Conversion): string {
  const lead = `Made on a ${pedalName(c.from)}. Converted for your ${pedalName(c.to)} when you write it`;
  if (c.dropped.length) return `${lead}. ${droppedSentence(c)}`;
  return c.to === "gp50" ? `${lead}; nothing is lost.` : `${lead}.`;
}
