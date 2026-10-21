import { env, pipeline } from '@huggingface/transformers';
import wasm from '@whisper-ort/ort-wasm-simd-threaded.jsep.wasm?url';
import mjs from '@whisper-ort/ort-wasm-simd-threaded.jsep.mjs?url';
import { transcriptSegments } from './lyrics';

env.allowLocalModels = false;
env.backends.onnx.wasm!.wasmPaths = { wasm, mjs };
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
self.onmessage = async (event: MessageEvent<Float32Array>) => {
  try {
    const transcribe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
      device: 'wasm', dtype: 'q8',
      progress_callback: p => {
        if (p.status === 'progress') self.postMessage({ status: `Downloading lyrics model: ${Math.round(p.progress)}% (${p.file})` });
      },
    });
    self.postMessage({ status: 'Transcribing vocals locally… This may take several minutes.' });
    const output = await transcribe(event.data, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' });
    const result = Array.isArray(output) ? output[0] : output;
    self.postMessage({ segments: transcriptSegments(result.chunks ?? [], event.data.length / 16000) });
    await transcribe.dispose();
  } catch (e) { self.postMessage({ error: e instanceof Error ? e.message : String(e) }); }
};
