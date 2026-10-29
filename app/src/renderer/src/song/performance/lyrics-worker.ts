import { transcriptSegments, transcriptWords } from "./lyrics";
import { findLyricsQuality, runtimeFor, wasmThreads, type LyricsOptions } from "./lyrics-options";
import { findLyricsModel } from "./lyrics-models";

// `words` asks for word timings (used to time pasted lyrics); otherwise the worker returns line-level segments.
self.onmessage = async (event: MessageEvent<{ pcm: Float32Array; options: LyricsOptions; words: boolean }>) => {
  const { pcm, options, words } = event.data;
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
    self.postMessage({ status: "Transcribing vocals locally… This may take several minutes." });
    const output = await transcribe(pcm, {
      return_timestamps: words ? "word" : true,
      chunk_length_s: 30,
      stride_length_s: 5,
      task: "transcribe",
      num_beams: findLyricsQuality(options.quality)?.beams ?? 1,
      ...(options.language !== "auto" ? { language: options.language } : {}),
    });
    const result = Array.isArray(output) ? output[0] : output;
    const duration = pcm.length / 16000;
    if (words) self.postMessage({ words: transcriptWords(result.chunks ?? [], duration) });
    else self.postMessage({ segments: transcriptSegments(result.chunks ?? [], duration) });
    await transcribe.dispose();
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
