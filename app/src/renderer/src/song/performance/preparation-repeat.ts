import type { Cue } from "./chart";

export const PREPARATION_REPEATS = ["always", "beginning", "once"] as const;
export type PreparationRepeat = (typeof PREPARATION_REPEATS)[number];
export const PREPARATION_REPEAT_LABELS: Record<PreparationRepeat, string> = {
  always: "Every start",
  beginning: "Only from beginning",
  once: "Once per song load",
};
export function preparationTrigger(repeat: PreparationRepeat): string {
  return repeat === "always" ? "prepare" : `prepare-${repeat}`;
}
export interface PreparationCommand {
  bytes: number[];
  /** A complete once command line shares one key, including bank/PC pairs and macros. */
  onceKey?: string;
}

/** Records sending attempts, not hardware delivery. It never resets just because preparation was cancelled. */
export class PreparationHistory {
  private used = new Set<string>();
  get size(): number {
    return this.used.size;
  }
  reset(): void {
    this.used.clear();
  }
  started(key: string | undefined): boolean {
    if (!key || this.used.has(key)) return false;
    this.used.add(key);
    return true;
  }
  commands(cues: readonly Cue[], atBeginning: boolean): PreparationCommand[] {
    const explicit = cues.filter((cue) => cue.trigger === "prepare");
    const groups = new Map<number, Cue[]>();
    explicit.forEach((cue, index) => {
      if (cue.prepareRepeat !== "once") return;
      const line = cue.source?.line ?? -(index + 1);
      groups.set(line, [...(groups.get(line) ?? []), cue]);
    });
    const occurrences = new Map<string, number>(),
      keys = new Map<Cue, string>();
    for (const group of groups.values()) {
      // Labels, whitespace and line order do not re-enable an already attempted action.
      // A changed command or macro expansion is a different action; identical lines retain their occurrence count.
      const signature = JSON.stringify(group.flatMap((cue) => cue.messages));
      const occurrence = occurrences.get(signature) ?? 0;
      occurrences.set(signature, occurrence + 1);
      const key = `${signature}:${occurrence}`;
      for (const cue of group) keys.set(cue, key);
    }
    return explicit.flatMap((cue) => {
      if (cue.prepareRepeat === "beginning" && !atBeginning) return [];
      const onceKey = keys.get(cue);
      if (onceKey && this.used.has(onceKey)) return [];
      return cue.messages.map((bytes) => ({ bytes, ...(onceKey ? { onceKey } : {}) }));
    });
  }
}

// The original decoded audio identifies one load, including a first save that gives the song a library id.
// Rebuilding generated tracks or remounting the performance view does not load that original audio again.
const histories = new WeakMap<object, PreparationHistory>();
export function preparationHistoryFor(source: object): PreparationHistory {
  let history = histories.get(source);
  if (!history) {
    history = new PreparationHistory();
    histories.set(source, history);
  }
  return history;
}
