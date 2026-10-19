/// <reference lib="webworker" />
// Separation worker for the "webgpu" model files (shared/host/song.ts): onnxruntime-web's WebGPU build, falling
// back to its WebAssembly runtime (worker-core.ts).
import * as ort from "onnxruntime-web/webgpu";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import mjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import { serveSeparation } from "./worker-core";

// The wasm runtime's own file, not the copy bundled into this worker: emscripten starts its thread workers ("em-pthread")
// from the module's URL, and from this file they would run the handlers below instead of the thread loop and hang.
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
serveSeparation(ort);
