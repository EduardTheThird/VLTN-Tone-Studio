import { transcriptSegments, transcriptWords } from "./lyrics";
import type { LyricsOptions } from "./lyrics-options";

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
    env.allowLocalModels = false;
    env.backends.onnx.wasm!.wasmPaths = { wasm, mjs };
    env.backends.onnx.wasm!.numThreads = 1;
    env.backends.onnx.wasm!.proxy = false;
    const transcribe = await pipeline("automatic-speech-recognition", "Xenova/whisper-base", {
      device: "wasm",
      dtype: "q8",
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
