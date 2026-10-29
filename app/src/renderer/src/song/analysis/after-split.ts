// What runs on a new song once its audio is known (spec 80): the steps the Stems tab ticks under "After the split". They are kept for
// every song, as the split's own model and quality are, so the choice is made before the split and then needs no attention. Lyrics is
// the step that used to be an option on the analysis ("Transcribe lyrics when analysing"); its old value is read once, when no choice has
// been saved yet.

import { loadLyricsOnAnalysis } from "../performance/lyrics-options";

export const AFTER_SPLIT_STEPS = [
  { id: "tempo", label: "Tempo and beat" },
  { id: "key", label: "Key" },
  { id: "chords", label: "Chords" },
  { id: "sections", label: "Sections" },
  { id: "loudness", label: "Loudness and silence" },
  { id: "parts", label: "Drums and bass check" },
  { id: "lyrics", label: "Lyrics" },
] as const;

export type AfterSplitStep = (typeof AFTER_SPLIT_STEPS)[number]["id"];
export type AfterSplitChoice = Record<AfterSplitStep, boolean>;

const STORAGE_KEY = "gp5.song.afterSplit.v1";

/** Every step is on, as the Stems tab starts with them. */
export function defaultAfterSplit(): AfterSplitChoice {
  return Object.fromEntries(AFTER_SPLIT_STEPS.map((step) => [step.id, true])) as AfterSplitChoice;
}

/**
 * Reads a saved choice. Anything missing or damaged is on, so a step is never silently dropped. With no saved choice, the lyrics step
 * takes the value of the old "Transcribe lyrics when analysing" option (`legacyLyrics`), when it was saved.
 */
export function parseAfterSplit(stored: string | null, legacyLyrics: boolean | null): AfterSplitChoice {
  const choice = defaultAfterSplit();
  if (stored === null) {
    if (legacyLyrics !== null) choice.lyrics = legacyLyrics;
    return choice;
  }
  try {
    const value: unknown = JSON.parse(stored);
    if (!value || typeof value !== "object") return choice;
    for (const step of AFTER_SPLIT_STEPS) {
      const on = (value as Record<string, unknown>)[step.id];
      if (typeof on === "boolean") choice[step.id] = on;
    }
  } catch {
    /* a damaged choice reads as the defaults */
  }
  return choice;
}

/** The choice saved last, or the defaults. Storage that is unavailable reads as the defaults. */
export function loadAfterSplit(): AfterSplitChoice {
  let stored: string | null = null;
  let legacy: boolean | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
    legacy = localStorage.getItem("vltn.song.analysis-lyrics.v1") === null ? null : loadLyricsOnAnalysis();
  } catch {
    /* read as the defaults */
  }
  return parseAfterSplit(stored, legacy);
}

export function saveAfterSplit(choice: AfterSplitChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    /* storage unavailable: the choice is the defaults next launch */
  }
}
