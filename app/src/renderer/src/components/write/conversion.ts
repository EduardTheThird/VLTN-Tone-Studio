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
  /** The preset's EXP pedal settings are on and `to` keeps none per preset (GP-50 → GP-5) */
  expDropped: boolean;
  /** Params that follow the tempo here and `to` can't sync (GP-50 → GP-5), e.g. "DLY Time" */
  unsynced: string[];
  /** Why it can't be written at all (another family), else null */
  refused: string | null;
}

/**
 * The conversion writing `s` to a `target` pedal needs; null when both use one file format (the same model, or the
 * GP-200 family, whose files don't name the model) or the pedal model is unknown.
 */
export function conversionFor(s: Pick<PresetSummary, "device" | "gp50Only" | "exp" | "synced">, target: DeviceKey | null): Conversion | null {
  if (!target || profileFor(s.device).prst === profileFor(target).prst) return null;
  const none = { from: s.device, to: target, dropped: [], expDropped: false, unsynced: [] };
  if (profileFor(s.device).family !== profileFor(target).family) return { ...none, refused: crossFamilyNote(s.device, target) };
  if (convertsLosslessly(s.device, target)) return { ...none, refused: null };
  // convertPrst re-wraps the tone block: EXP settings are not carried over, and a synced Time/Rate keeps its raw
  // division index (0-10), which a pedal without Sync presumably reads as a plain ms/Hz value (not checked on hardware).
  return { ...none, dropped: s.gp50Only, expDropped: s.exp?.on === true, unsynced: s.synced, refused: null };
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

/** Everything the preset loses on the way, one sentence each; empty when nothing is lost. */
function lossSentences(c: Conversion): string[] {
  const to = pedalName(c.to);
  const n = c.unsynced.length;
  return [
    droppedSentence(c),
    c.expDropped ? `Its EXP pedal settings are dropped: the ${to} keeps none per preset.` : "",
    n ? `${c.unsynced.join(", ")} ${n === 1 ? "follows" : "follow"} the tempo; the ${to} has no tempo sync, so set ${n === 1 ? "it" : "them"} again after writing.` : "",
  ].filter(Boolean);
}

/** "Made on a GP-50. Converted for your GP-5 when you write it. …" GP-5 → GP-50 says nothing is lost. */
export function conversionNote(c: Conversion): string {
  if (c.refused) return c.refused;
  const lead = `Made on a ${pedalName(c.from)}. Converted for your ${pedalName(c.to)} when you write it`;
  const losses = lossSentences(c);
  if (losses.length) return `${lead}. ${losses.join(" ")}`;
  return convertsLosslessly(c.from, c.to) ? `${lead}; nothing is lost.` : `${lead}.`;
}

/**
 * One note for a list of presets made on `from` (shown once, not per card); null when writing them to `to` loses
 * nothing. Within the GP-5 family only GP-50 → GP-5 loses anything.
 */
export function listConversionNote(from: DeviceKey, to: DeviceKey): string | null {
  if (convertsLosslessly(from, to)) return null;
  const a = pedalName(from);
  const b = pedalName(to);
  if (profileFor(from).family !== profileFor(to).family) return `Presets made on a ${a} can't be converted for a ${b}.`;
  return `Presets made on a ${a} are converted for your ${b} when you write one: their EXP pedal settings are dropped, tempo-synced times and rates need setting again, and ${a}-only models are left empty. Select a preset to see what it loses.`;
}
