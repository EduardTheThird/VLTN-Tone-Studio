// The speech models that can transcribe lyrics. transformers.js downloads a model from its Hugging Face repo on first
// use and caches it, so this registry holds only what the UI shows: the repo, the download sizes and the licence.
// Sizes are the sum of the files each device loads (the q8 encoder and decoder on WASM, fp16 on WebGPU), as listed
// in each repo on 29 Oct 2026. Candidates that failed the check (no transformers.js ONNX repo found, or an unreadable
// repo) are left out; see spec 75's Status.

export type LyricsModelId = "base" | "small" | "turbo";

export interface LyricsModel {
  id: LyricsModelId;
  label: string;
  description: string;
  repo: string;
  licence: string;
  /** Bytes downloaded once, by runtime: "wasm" uses q8 files, "webgpu" uses fp16 files. */
  bytes: { wasm: number; webgpu: number };
}

export const LYRICS_MODELS: readonly LyricsModel[] = [
  {
    id: "base",
    label: "Fast",
    description: "Smallest download and quickest to start. Misses more sung words.",
    repo: "Xenova/whisper-base",
    licence: "Apache-2.0",
    bytes: { wasm: 76_908_389, webgpu: 146_076_166 },
  },
  {
    id: "small",
    label: "Better",
    description: "A good balance for sung vocals on this computer.",
    repo: "Xenova/whisper-small",
    licence: "Apache-2.0",
    bytes: { wasm: 249_105_759, webgpu: 485_223_415 },
  },
  {
    id: "turbo",
    label: "Best",
    description: "Most accurate on singing. Largest download and the slowest.",
    repo: "onnx-community/whisper-large-v3-turbo",
    // The ONNX repo carries no licence tag; the weights are OpenAI's whisper-large-v3-turbo, MIT-licensed.
    licence: "MIT (weights; repo has no tag)",
    bytes: { wasm: 1_084_758_911, webgpu: 1_618_569_942 },
  },
];

export const DEFAULT_LYRICS_MODEL_ID: LyricsModelId = "small";

export function findLyricsModel(id: unknown): LyricsModel | undefined {
  return LYRICS_MODELS.find((m) => m.id === id);
}

/** Megabytes to show in the UI, rounded to the nearest MB. */
export function downloadMegabytes(model: LyricsModel, webgpu: boolean): number {
  return Math.round((webgpu ? model.bytes.webgpu : model.bytes.wasm) / 1e6);
}
