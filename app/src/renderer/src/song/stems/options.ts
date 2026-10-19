import { DEFAULT_MODEL_ID, findModel, type SeparationModelId, type SeparationPass, type StemName } from "@shared/host/song";
import { OVERLAP } from "./demucs";

// What a split runs: the model (registry: shared/host/song.ts) and the quality preset (apply_model's overlap and
// shifts), remembered across launches (localStorage); and how a model's passes combine into stems.

export type QualityId = "fast" | "balanced" | "max";

export interface SplitQuality {
  id: QualityId;
  label: string;
  description: string;
  overlap: number;
  shifts: number;
}

export const SPLIT_QUALITIES: readonly SplitQuality[] = [
  { id: "fast", label: "Fast", description: "Demucs' defaults.", overlap: OVERLAP, shifts: 0 },
  { id: "balanced", label: "Balanced", description: "Half-overlapping chunks, two shifted passes averaged.", overlap: 0.5, shifts: 2 },
  { id: "max", label: "Max", description: "Half-overlapping chunks, four shifted passes averaged.", overlap: 0.5, shifts: 4 },
];

export interface SplitChoice {
  model: SeparationModelId;
  quality: QualityId;
}

const CHOICE_KEY = "gp5.song.split.v1";
export const DEFAULT_CHOICE: SplitChoice = { model: DEFAULT_MODEL_ID, quality: "fast" };

export function findQuality(id: string): SplitQuality | undefined {
  return SPLIT_QUALITIES.find((q) => q.id === id);
}

/** Split time relative to Fast: model calls per second of audio (the shifts' padding left out). */
export function relativeTime(q: SplitQuality): number {
  return (Math.max(1, q.shifts) * (1 - OVERLAP)) / (1 - q.overlap);
}

/** The model and quality chosen last; survives missing or corrupt storage and models that no longer exist. */
export function loadSplitChoice(): SplitChoice {
  try {
    const stored = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "null");
    return {
      model: findModel(stored?.model)?.id ?? DEFAULT_CHOICE.model,
      quality: findQuality(stored?.quality)?.id ?? DEFAULT_CHOICE.quality,
    };
  } catch {
    return DEFAULT_CHOICE;
  }
}

export function saveSplitChoice(choice: SplitChoice) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    /* storage unavailable: the defaults come back next launch */
  }
}

/** Run order of `passes`: the one using the file already loaded (`loaded`) first, so it isn't loaded again. */
export function orderPasses(passes: readonly SeparationPass[], loaded: string | null): SeparationPass[] {
  const first = passes.findIndex((p) => p.file.file === loaded);
  return first <= 0 ? [...passes] : [passes[first], ...passes.slice(0, first), ...passes.slice(first + 1)];
}

/** The output rows `pass` keeps, in `take` order. */
export function passRows(pass: SeparationPass): number[] {
  return pass.take.map((name) => {
    const row = pass.file.sources.indexOf(name);
    if (row < 0) throw new Error(`${pass.file.file} has no ${name} stem.`);
    return row;
  });
}

/** Stems by name from each pass's rows (results[k][i]: pass k's `take[i]`, planar channels). */
export function assembleStems(passes: readonly SeparationPass[], results: Float32Array[][][]): Partial<Record<StemName, Float32Array[]>> {
  const stems: Partial<Record<StemName, Float32Array[]>> = {};
  passes.forEach((pass, k) => pass.take.forEach((name, i) => (stems[name] = results[k][i])));
  return stems;
}
