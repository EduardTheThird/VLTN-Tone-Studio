/// <reference lib="webworker" />
// Separation worker body, shared by the two onnxruntime-web builds (worker.ts: WebGPU with its WebAssembly
// fallback; worker-cpu.ts: the plain WebAssembly build). One ONNX session at a time runs a model chunk by chunk
// (demucs.ts); loading another file releases the previous session first, so a bag of models never holds more
// than one in memory. Requests run in order, one at a time; a cancel takes effect at the next chunk.
import type * as Ort from "onnxruntime-web";
import { SEGMENT, separate } from "./demucs";
import type { Backend, WorkerReply, WorkerRequest } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

type LoadRequest = Extract<WorkerRequest, { type: "load" }>;
type SplitRequest = Extract<WorkerRequest, { type: "split" }>;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function serveSeparation(ort: typeof Ort): void {
  // Threads need a cross-origin isolated page (SharedArrayBuffer; main/index.ts sends COOP/COEP); else one thread.
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
  const threads = ort.env.wasm.numThreads ?? 1;
  let session: Ort.InferenceSession | null = null;
  let optimize = true;
  /** The loaded model's bytes while its session is WebGPU (any failed run, device loss included, restarts on WebAssembly) */
  let unproven: Uint8Array | null = null;
  const cancelled = new Set<number>();
  let queue = Promise.resolve();
  const post = (msg: WorkerReply, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

  const create = (model: Uint8Array, backend: Backend) =>
    ort.InferenceSession.create(model, { executionProviders: [backend], graphOptimizationLevel: optimize ? "all" : "disabled" });

  async function release() {
    const old = session;
    session = null;
    unproven = null;
    await old?.release().catch(() => {});
  }

  async function load({ file, model, gpu, optimize: opt }: LoadRequest) {
    await release();
    optimize = opt;
    let backend: Backend = "wasm";
    let gpuError: string | undefined;
    try {
      if (gpu) {
        gpuError = "this computer has no WebGPU";
        if ("gpu" in navigator) {
          try {
            session = await create(model, "webgpu");
            backend = "webgpu";
            unproven = model;
            gpuError = undefined;
          } catch (e) {
            // No adapter, or the GPU can't place the graph: fall back to the CPU.
            gpuError = errorText(e);
          }
        }
      }
      session ??= await create(model, "wasm");
      post({ type: "loaded", file, backend, threads, gpuError });
    } catch (e) {
      post({ type: "load-error", file, message: errorText(e) });
    }
  }

  async function runOnce(mix: Float32Array): Promise<Float32Array> {
    if (!session) throw new Error("The separation model isn't loaded.");
    const s = session;
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", mix, [1, 2, SEGMENT]) });
    const stems = out[s.outputNames[0]];
    const data = (await stems.getData()) as Float32Array;
    stems.dispose();
    return data;
  }

  /** One chunk; a WebGPU session that fails a run is replaced by a WebAssembly one and the chunk retried. */
  async function runSegment(id: number, mix: Float32Array): Promise<Float32Array> {
    if (!unproven) return runOnce(mix);
    const bytes = unproven;
    try {
      return await runOnce(mix);
    } catch (e) {
      post({ type: "fallback", id, message: errorText(e) });
      await release();
      session = await create(bytes, "wasm");
      return runOnce(mix);
    }
  }

  async function split({ id, channels, sources, rows, overlap, shifts }: SplitRequest) {
    try {
      const stems = await separate(channels, (mix) => runSegment(id, mix), { sources, rows, overlap, shifts }, {
        onProgress: (fraction) => post({ type: "progress", id, fraction }),
        cancelled: () => cancelled.has(id),
      });
      post({ type: "done", id, stems }, stems.flat().map((c) => c.buffer));
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") post({ type: "cancelled", id });
      else post({ type: "error", id, message: errorText(e) });
    } finally {
      cancelled.delete(id);
    }
  }

  self.onmessage = (e: MessageEvent<WorkerRequest>) => {
    const msg = e.data;
    if (msg.type === "cancel") cancelled.add(msg.id);
    else queue = queue.then(() => (msg.type === "load" ? load(msg) : split(msg)));
  };
}
