export interface HarmonyChange {
  time: number;
  name: string;
  authored?: true;
}

export const chordPattern = /\[([A-G][#b♭♯]?[^\]\s]*|N(?:\.C\.?)?)\]/g;
export const harmonyPattern = /\[([A-G][#b♭♯]?[^\]\s]*|N(?:\.C\.?)?|auto)\]/g;
export const isNoChord = (name: string): boolean => /^N(?:\.C\.?)?$/i.test(name);

/** Hold the written chord until another chart instruction. Detection resumes at an explicit [auto]. */
export function mergeHarmonyChanges(written: readonly HarmonyChange[], detected: readonly HarmonyChange[]): HarmonyChange[] {
  const changes = [...written].sort((a, b) => a.time - b.time);
  const estimates = [...detected].sort((a, b) => a.time - b.time);
  const result: HarmonyChange[] = [];
  let estimateIndex = 0;
  let automatic = true;
  let previousEstimate: HarmonyChange | undefined;
  for (const change of changes) {
    while (estimateIndex < estimates.length && estimates[estimateIndex].time <= change.time) {
      previousEstimate = estimates[estimateIndex++];
      if (automatic && previousEstimate.time < change.time) result.push(previousEstimate);
    }
    automatic = change.name === "auto";
    result.push(automatic ? { time: change.time, name: previousEstimate?.name ?? "N" } : { ...change, authored: true });
  }
  if (automatic) result.push(...estimates.slice(estimateIndex));
  return result;
}
