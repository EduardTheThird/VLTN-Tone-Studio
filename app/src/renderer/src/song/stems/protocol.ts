// Messages between the stem engine (engine.ts, UI thread) and a separation worker (worker.ts, worker-cpu.ts).

/** WebGPU when the browser has a GPU adapter that runs the model, else WebAssembly on the CPU. */
export type Backend = "webgpu" | "wasm";

export type WorkerRequest =
  /**
   * Replace the loaded ONNX session with one for `file` (bytes transferred). `gpu`: try WebGPU first;
   * `optimize`: onnxruntime's full graph optimisation (else none).
   */
  | { type: "load"; file: string; model: Uint8Array; gpu: boolean; optimize: boolean }
  /** Split planar stereo 44.1 kHz audio (transferred), keeping output `rows` of a `sources`-row model */
  | { type: "split"; id: number; channels: Float32Array[]; sources: number; rows: number[]; overlap: number; shifts: number }
  | { type: "cancel"; id: number };

export type WorkerReply =
  /** `threads`: the CPU path's thread count; `gpuError`: why WebGPU wasn't used (backend "wasm") */
  | { type: "loaded"; file: string; backend: Backend; threads: number; gpuError?: string }
  | { type: "load-error"; file: string; message: string }
  /** WebGPU failed on a run (first or later, e.g. device lost): the split goes on with WebAssembly */
  | { type: "fallback"; id: number; message: string }
  | { type: "progress"; id: number; fraction: number }
  /** stems[row][channel], in the requested rows' order */
  | { type: "done"; id: number; stems: Float32Array[][] }
  | { type: "cancelled"; id: number }
  | { type: "error"; id: number; message: string };
