/**
 * Where a song's tempo came from. Earlier builds saved 120 for every song that was never given a tempo, so a saved 120 with no source is
 * the old default, not a choice. The analysis treats it as unknown and detects the real tempo.
 */
export type TempoSource = "detected" | "manual" | "tap" | "chart";

const SOURCES: readonly TempoSource[] = ["detected", "manual", "tap", "chart"];

/** The tempo source saved in a song's options. Anything else, including a missing field, is no source. */
export function readTempoSource(options: unknown): TempoSource | null {
  const value = options && typeof options === "object" ? (options as { tempoSource?: unknown }).tempoSource : undefined;
  return SOURCES.find((source) => source === value) ?? null;
}

/** True when no source is recorded and the saved tempo is empty or the legacy default of 120. */
export function needsTempoDetection(savedBpm: string, source: TempoSource | null): boolean {
  if (source) return false;
  return savedBpm === "" || savedBpm === "120";
}
