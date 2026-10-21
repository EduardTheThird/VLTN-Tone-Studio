/// <reference lib="webworker" />
// Separation worker for the "wasm" model files (shared/host/song.ts): onnxruntime-web's plain WebAssembly build,
// which has the CPU kernels those exports need and the WebGPU build lacks (worker-core.ts).
import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import mjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import { serveSeparation } from "./worker-core";

// The runtime's own files, as in worker.ts: its thread workers start from the module's URL.
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
serveSeparation(ort);
