// Order, footswitch and tempo edits change the preset in the app; they play on the pedal right away only where the
// driver has a live command for them (DeviceFeature), otherwise they reach the pedal with the save.
import { useDevice } from "@/state/device";
import type { DeviceFeature } from "@/state/device-types";
import { joinAnd } from "./order";

export type LiveEdit = "liveOrder" | "liveFootswitches" | "liveBpm";

const WHAT: Record<LiveEdit, string> = { liveOrder: "chain order", liveFootswitches: "footswitches", liveBpm: "tempo" };

/** How an edit reaches the pedal: right away ("live"), with the save ("save"), or with the save until GP-50 extras are on ("locked"). */
export type LiveMode = "live" | "save" | "locked";

export function useLiveMode(feature: LiveEdit): LiveMode {
  return useDevice((s) => (s.features.includes(feature) ? "live" : s.lockedFeatures.includes(feature) ? "locked" : "save"));
}

/** Status bar text while connected: what plays right away and what waits for the save. */
export function liveStatusText(features: readonly DeviceFeature[]): string {
  const later = (Object.keys(WHAT) as LiveEdit[]).filter((f) => !features.includes(f)).map((f) => WHAT[f]);
  if (!later.length) return "Live: every change plays on the pedal, nothing is stored until you save";
  return `Live: sound changes play on the pedal; ${joinAnd(later)} reach it when you save`;
}

/** Note for an edit that doesn't play right away ("" when it does). `what` is the subject, e.g. "The new order". */
export function saveOnlyNote(mode: LiveMode, what: string, pedal: string): string {
  if (mode === "live") return "";
  const base = `${what} reaches the ${pedal} when you save.`;
  return mode === "locked" ? `${base} Turn on GP-50 extras in Settings to hear it right away.` : base;
}
