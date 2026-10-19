// Runs the capture ranking (capture-match.ts) in one Web Worker: the test signal and the stem's features go in once,
// then captures one at a time, so each NAM file is read only when its turn comes. close() stops it mid-render.
import type { CaptureFit, StemTarget } from "./capture-match";

export type CaptureWorkerRequest = { type: "init"; signalWav: Uint8Array; target: StemTarget } | { type: "evaluate"; id: number; namText: string; gear: string | null };

export type CaptureWorkerReply =
  | { type: "progress"; id: number; fraction: number }
  | { type: "fit"; id: number; fit: CaptureFit }
  | { type: "failed"; id: number; message: string }
  /** The init failed (not the test signal); nothing can be evaluated */
  | { type: "error"; message: string };

interface Pending {
  id: number;
  resolve: (fit: CaptureFit) => void;
  reject: (e: Error) => void;
  onProgress?: (fraction: number) => void;
}

export class CaptureRanker {
  #worker: Worker;
  #pending: Pending | null = null;
  #failure: Error | null = null;
  #next = 0;

  constructor(signalWav: Uint8Array, target: StemTarget) {
    this.#worker = new Worker(new URL("./capture-worker.ts", import.meta.url), { type: "module" });
    this.#worker.onmessage = (e: MessageEvent<CaptureWorkerReply>) => this.#reply(e.data);
    this.#worker.onerror = (e) => this.#fail(new Error(e.message || "The capture ranking stopped"));
    // The signal is copied: the caller may reuse its bytes.
    const wav = signalWav.slice();
    this.#worker.postMessage({ type: "init", signalWav: wav, target } satisfies CaptureWorkerRequest, [wav.buffer]);
  }

  /** Why the ranker stopped for good (the setup failed, the worker died, or close()); null while it works */
  get failure(): Error | null {
    return this.#failure;
  }

  #reply(msg: CaptureWorkerReply) {
    if (msg.type === "error") return this.#fail(new Error(msg.message));
    const p = this.#pending;
    if (!p || p.id !== msg.id) return;
    if (msg.type === "progress") return p.onProgress?.(msg.fraction);
    this.#pending = null;
    if (msg.type === "fit") p.resolve(msg.fit);
    else p.reject(new Error(msg.message));
  }

  #fail(e: Error) {
    this.#failure = e;
    const p = this.#pending;
    this.#pending = null;
    p?.reject(e);
  }

  /** Render and compare one capture. One at a time; rejects with the capture's own error, or AbortError after close(). */
  evaluate(namText: string, gear: string | null, onProgress?: (fraction: number) => void): Promise<CaptureFit> {
    if (this.#failure) return Promise.reject(this.#failure);
    if (this.#pending) return Promise.reject(new Error("A capture is already being ranked"));
    const id = ++this.#next;
    const { promise, resolve, reject } = Promise.withResolvers<CaptureFit>();
    this.#pending = { id, resolve, reject, onProgress };
    this.#worker.postMessage({ type: "evaluate", id, namText, gear } satisfies CaptureWorkerRequest);
    return promise;
  }

  close() {
    this.#worker.terminate();
    this.#fail(new DOMException("Ranking cancelled", "AbortError"));
  }
}
