import { windowWords } from "./lyrics";
import { fallbackRuntime, findLyricsQuality, hasWebGpuAdapter, runtimeFor, wasmThreads, type LyricsOptions, type LyricsRuntime } from "./lyrics-options";
import { findLyricsModel } from "./lyrics-models";
import type { TimedWord } from "./lyrics-align";
import type { Region } from "./vocal-activity";

// `pieces` are the singing windows (16 kHz mono), `starts` their song times in seconds, and `spans` the song time each window
// is responsible for (windows overlap, so each word is kept by one of them). The worker returns every word with a song time;
// the lines are built on the main thread, where the cleaning rules live.
self.onmessage = async (event: MessageEvent<{ pieces: Float32Array[]; starts: number[]; spans: Region[]; options: LyricsOptions }>) => {
  const { pieces, starts, spans, options } = event.data;
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
    env.allowLocalModels = false;
    env.backends.onnx.wasm!.wasmPaths = { wasm, mjs };
    env.backends.onnx.wasm!.numThreads = wasmThreads(self.crossOriginIsolated, navigator.hardwareConcurrency);
    env.backends.onnx.wasm!.proxy = false;

    // One full pass on one runtime. Pipelines are disposed on the way out, so a retry starts clean.
    const transcribeWith = async (runtime: LyricsRuntime): Promise<TimedWord[]> => {
      const transcribe = await pipeline("automatic-speech-recognition", model.repo, {
        device: runtime.device,
        dtype: runtime.dtype,
        progress_callback: (p) => {
          if (p.status === "progress") self.postMessage({ status: `Downloading lyrics model: ${Math.round(p.progress)}% (${p.file})` });
        },
      });
      try {
        const heard: TimedWord[] = [];
        for (let i = 0; i < pieces.length; i++) {
          const partStatus = `Transcribing vocals locally, part ${i + 1} of ${pieces.length}…`;
          const status = pieces.length > 1 ? partStatus : "Transcribing vocals locally… This may take several minutes.";
          self.postMessage({ status });
          const output = await transcribe(pieces[i], {
            return_timestamps: "word",
            chunk_length_s: 30,
            stride_length_s: 5,
            task: "transcribe",
            num_beams: findLyricsQuality(options.quality)?.beams ?? 1,
            ...(options.language !== "auto" ? { language: options.language } : {}),
          });
          const result = Array.isArray(output) ? output[0] : output;
          const duration = pieces[i].length / 16000;
          // Times from a window are relative to it; windowWords moves them to song time and keeps the words it owns.
          heard.push(...windowWords(result.chunks ?? [], duration, starts[i], spans[i]));
        }
        return heard;
      } finally {
        await transcribe.dispose();
      }
    };

    // WebGPU is tried when an adapter exists. If it fails at any point, the whole run retries once on the CPU.
    const preferred = runtimeFor(await hasWebGpuAdapter(navigator.gpu));
    let heard: TimedWord[];
    try {
      heard = await transcribeWith(preferred);
    } catch (e) {
      const fallback = fallbackRuntime(preferred);
      if (!fallback) throw e;
      self.postMessage({ status: "Graphics acceleration unavailable, using the CPU" });
      heard = await transcribeWith(fallback);
    }
    self.postMessage({ words: heard });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
