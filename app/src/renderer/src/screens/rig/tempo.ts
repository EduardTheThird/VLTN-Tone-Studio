// Tap tempo for the Rig header: computed in the app (every model stores a tempo per preset; some also take it live).

/** A pause longer than this starts a new tap sequence (the pedal's own tap tempo uses the same 2 s). */
export const TAP_RESET_MS = 2000;
/** Intervals averaged: the most recent ones, so the tempo follows a player who speeds up. */
export const TAP_WINDOW = 4;

/**
 * Add a tap at `now` (ms) to `taps` (earlier tap times, oldest first). Returns the taps to keep and the tempo they give:
 * the average of the last TAP_WINDOW intervals, clamped to `range` (the model's, profileFor(device).tempo); null until
 * there are two taps.
 */
export function tap(taps: readonly number[], now: number, range: { min: number; max: number }): { taps: number[]; bpm: number | null } {
  const last = taps[taps.length - 1];
  const kept = last !== undefined && now - last <= TAP_RESET_MS && now > last ? [...taps, now].slice(-(TAP_WINDOW + 1)) : [now];
  if (kept.length < 2) return { taps: kept, bpm: null };
  const avg = (kept[kept.length - 1] - kept[0]) / (kept.length - 1);
  return { taps: kept, bpm: Math.max(range.min, Math.min(range.max, Math.round(60_000 / avg))) };
}
