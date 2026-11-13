/** How the Song screen shows times and tempos, so the same value reads the same way everywhere. */

/** Seconds as `m:ss`, for display: `5:30`. A negative or missing value shows as `0:00`. */
export function clock(value: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A tempo with one decimal when it is not a whole number and none when it is: `149.9 BPM`, `150 BPM`. */
export function tempo(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} BPM`;
}
