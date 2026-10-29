import { DEFAULT_LYRICS_MODEL_ID, findLyricsModel, type LyricsModelId } from "./lyrics-models";
import { readOptions, setSetting } from "./settings";

// What a transcription runs: the model and quality, chosen once for all songs and remembered across launches
// (localStorage, like the split's choice), and the language, kept per song in its `:options`.

export const LYRIC_LANGUAGES = ["auto", "english", "afrikaans", "dutch", "french", "german", "italian", "portuguese", "spanish"] as const;
export type LyricsLanguage = (typeof LYRIC_LANGUAGES)[number];

export type LyricsQualityId = "fast" | "balanced" | "max";

export interface LyricsQuality {
  id: LyricsQualityId;
  label: string;
  description: string;
  /** Beam search width. 1 is greedy decoding. */
  beams: number;
}

export const LYRICS_QUALITIES: readonly LyricsQuality[] = [
  { id: "fast", label: "Fast", description: "Greedy decoding. Quickest.", beams: 1 },
  { id: "balanced", label: "Balanced", description: "Three beams. Slower, with fewer wrong words.", beams: 3 },
  { id: "max", label: "Max", description: "Five beams. Slowest, and the most careful.", beams: 5 },
];

export function findLyricsQuality(id: unknown): LyricsQuality | undefined {
  return LYRICS_QUALITIES.find((q) => q.id === id);
}

export interface LyricsChoice {
  model: LyricsModelId;
  quality: LyricsQualityId;
}

const CHOICE_KEY = "gp5.song.lyrics.v1";
export const DEFAULT_LYRICS_CHOICE: LyricsChoice = { model: DEFAULT_LYRICS_MODEL_ID, quality: "fast" };

/** The model and quality chosen last. Survives missing or corrupt storage, models that no longer exist, and the old `{ language }` shape. */
export function loadLyricsChoice(): LyricsChoice {
  try {
    const stored = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "null");
    return {
      model: findLyricsModel(stored?.model)?.id ?? DEFAULT_LYRICS_CHOICE.model,
      quality: findLyricsQuality(stored?.quality)?.id ?? DEFAULT_LYRICS_CHOICE.quality,
    };
  } catch {
    return DEFAULT_LYRICS_CHOICE;
  }
}

export function saveLyricsChoice(choice: LyricsChoice) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    /* storage unavailable: the defaults come back next launch */
  }
}

export interface LyricsOptions extends LyricsChoice {
  language: LyricsLanguage;
}

export function lyricsOptions(key: string): LyricsOptions {
  const { lyricsLanguage } = readOptions<{ lyricsLanguage?: unknown }>(key, {});
  const language = LYRIC_LANGUAGES.find((value) => value === lyricsLanguage) ?? "auto";
  return { ...loadLyricsChoice(), language };
}

/** Where the model runs: WebGPU when the browser has it (fp16 files), otherwise WASM (q8 files). */
export function runtimeFor(webgpu: boolean): { device: "webgpu" | "wasm"; dtype: "fp16" | "q8" } {
  return webgpu ? { device: "webgpu", dtype: "fp16" } : { device: "wasm", dtype: "q8" };
}

/** WASM threads: more only when the page is cross-origin isolated (SharedArrayBuffer), capped at four. */
export function wasmThreads(isolated: boolean, cores: number): number {
  return isolated ? Math.max(1, Math.min(4, cores)) : 1;
}

/** Records on the song what made its lyrics, so a later run knows which model made them. */
export function recordLyricsMade(key: string, options: LyricsOptions) {
  const made = { model: options.model, quality: options.quality, language: options.language, at: new Date().toISOString() };
  setSetting(key, ":options", JSON.stringify({ ...readOptions(key, {}), lyricsMade: made }));
}
