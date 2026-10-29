import { transcriptWords } from "./lyrics";
import { findLyricsQuality, runtimeFor, wasmThreads, type LyricsOptions } from "./lyrics-options";
import { findLyricsModel } from "./lyrics-models";
import type { TimedWord } from "./lyrics-align";

// `pieces` are the singing windows (16 kHz mono) and `starts` their song times in seconds. The worker returns every
// word with a song time; the lines are built on the main thread, where the cleaning rules live.
self.onmessage = async (event: MessageEvent<{ pieces: Float32Array[]; starts: number[]; options: LyricsOptions }>) => {
  const { pieces, starts, options } = event.data;
  try {
    // Load inside the handler so module/asset failures reach the UI instead of
    // terminating worker startup with an opaque error event.
    const [{ env, pipeline }, { default: wasm }, { default: mjs }] = await Promise.all([
      import("@huggingface/transformers"),
      import("onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url"),
      import("onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url"),
    ]);
    const model = findLyricsModel(options.model);
    if (!model) throw new Error(`Unknown lyrics model: ${String(options.model)}`);
    const runtime = runtimeFor("gpu" in navigator);
    env.allowLocalModels = false;
    env.backends.onnx.wasm!.wasmPaths = { wasm, mjs };
    env.backends.onnx.wasm!.numThreads = wasmThreads(self.crossOriginIsolated, navigator.hardwareConcurrency);
    env.backends.onnx.wasm!.proxy = false;
    const transcribe = await pipeline("automatic-speech-recognition", model.repo, {
      device: runtime.device,
      dtype: runtime.dtype,
      progress_callback: (p) => {
        if (p.status === "progress") self.postMessage({ status: `Downloading lyrics model: ${Math.round(p.progress)}% (${p.file})` });
      },
    });
    const heard: TimedWord[] = [];
    for (let i = 0; i < pieces.length; i++) {
      self.postMessage({
        status: pieces.length > 1 ? `Transcribing vocals locally, part ${i + 1} of ${pieces.length}…` : "Transcribing vocals locally… This may take several minutes.",
      });
      const output = await transcribe(pieces[i], {
        return_timestamps: "word",
        chunk_length_s: 30,
        stride_length_s: 5,
        task: "transcribe",
        num_beams: findLyricsQuality(options.quality)?.beams ?? 1,
        // Stops the decoder looping on one phrase, which Whisper does over quiet or repetitive audio.
        no_repeat_ngram_size: 3,
        ...(options.language !== "auto" ? { language: options.language } : {}),
      });
      const result = Array.isArray(output) ? output[0] : output;
      const duration = pieces[i].length / 16000;
      const offset = starts[i];
      // Times from a window are relative to it; move them back to song time.
      heard.push(...transcriptWords(result.chunks ?? [], duration).map((w) => ({ ...w, start: w.start + offset, end: w.end + offset })));
    }
    self.postMessage({ words: heard });
    await transcribe.dispose();
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
