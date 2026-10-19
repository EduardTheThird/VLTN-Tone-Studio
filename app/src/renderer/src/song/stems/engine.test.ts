import { beforeEach, describe, expect, it, vi } from "vitest";
import { findModel, type SeparationModel } from "@shared/host/song";
import type { WorkerReply, WorkerRequest } from "./protocol";
import { SPLIT_QUALITIES } from "./options";

vi.mock("@/host", () => ({
  host: { song: { onModelProgress: () => () => {}, downloadModel: async () => {}, modelFile: async () => new Uint8Array(4) } },
}));
vi.mock("@/state/session-log", () => ({ sessionLog: () => {} }));

/** A worker that answers load with WebGPU (or WebAssembly when `gpu` is false) and each split with the next scripted reply. */
class FakeWorker {
  static all: FakeWorker[] = [];
  static loads: { gpu: boolean }[] = [];
  static splitReply: "done" | "error" | "fallback-done" | "hold" = "done";
  terminated = false;
  private listeners = new Set<(e: MessageEvent<WorkerReply>) => void>();
  constructor() {
    FakeWorker.all.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent<WorkerReply>) => void) {
    if (type === "message") this.listeners.add(fn);
  }
  removeEventListener(_type: string, fn: (e: MessageEvent<WorkerReply>) => void) {
    this.listeners.delete(fn);
  }
  terminate() {
    this.terminated = true;
  }
  lastSplit = 0;
  emit(data: WorkerReply) {
    this.listeners.forEach((fn) => fn({ data } as MessageEvent<WorkerReply>));
  }
  postMessage(msg: WorkerRequest) {
    if (msg.type === "split") this.lastSplit = msg.id;
    if (msg.type === "split" && FakeWorker.splitReply === "hold") return;
    let reply: WorkerReply | null = null;
    if (msg.type === "load") {
      FakeWorker.loads.push({ gpu: msg.gpu });
      reply = { type: "loaded", file: msg.file, backend: msg.gpu ? "webgpu" : "wasm", threads: 1 };
    } else if (msg.type === "split" && FakeWorker.splitReply === "fallback-done") {
      queueMicrotask(() => this.listeners.forEach((fn) => fn({ data: { type: "fallback", id: msg.id, message: "device lost" } } as MessageEvent<WorkerReply>)));
      reply = { type: "done", id: msg.id, stems: [[new Float32Array(1), new Float32Array(1)]] };
    } else if (msg.type === "split") {
      reply = FakeWorker.splitReply === "done" ? { type: "done", id: msg.id, stems: [[new Float32Array(1), new Float32Array(1)]] } : { type: "error", id: msg.id, message: "device lost" };
    }
    if (reply) queueMicrotask(() => this.listeners.forEach((fn) => fn({ data: reply } as MessageEvent<WorkerReply>)));
  }
}

const audio = { sampleRate: 44100, channels: [new Float32Array(1000), new Float32Array(1000)] };
const model = findModel("htdemucs_6s") as SeparationModel;
const settings = { model, quality: SPLIT_QUALITIES[0] };

describe("separation engine", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.all = [];
    FakeWorker.loads = [];
    FakeWorker.splitReply = "done";
  });

  it("starts a fresh WebAssembly worker for the retry after a WebGPU pass fails with an error", async () => {
    const { separateStems } = await import("./engine");
    FakeWorker.splitReply = "error";
    await expect(separateStems(audio, settings, () => {}, new AbortController().signal)).rejects.toThrow("device lost");
    expect(FakeWorker.all[0].terminated).toBe(true);

    FakeWorker.splitReply = "done";
    await separateStems(audio, settings, () => {}, new AbortController().signal);
    expect(FakeWorker.all).toHaveLength(2);
    expect(FakeWorker.loads).toEqual([{ gpu: true }, { gpu: false }]);
  });

  it("reuses the loaded worker after a successful split", async () => {
    const { separateStems } = await import("./engine");
    await separateStems(audio, settings, () => {}, new AbortController().signal);
    await separateStems(audio, settings, () => {}, new AbortController().signal);
    expect(FakeWorker.all).toHaveLength(1);
    expect(FakeWorker.loads).toEqual([{ gpu: true }]);
  });

  it("marks the file as failed on WebGPU and reports WebAssembly when the worker falls back mid-split", async () => {
    const { separateStems } = await import("./engine");
    FakeWorker.splitReply = "fallback-done";
    const res = await separateStems(audio, settings, () => {}, new AbortController().signal);
    expect(res.backends).toEqual(["wasm"]);

    FakeWorker.splitReply = "done";
    await separateStems(audio, settings, () => {}, new AbortController().signal);
    expect(FakeWorker.all).toHaveLength(1); // same worker, now known to be on WebAssembly
  });

  it("still records a fallback that arrives after the split was cancelled", async () => {
    const { separateStems } = await import("./engine");
    FakeWorker.splitReply = "hold";
    const abort = new AbortController();
    const p = separateStems(audio, settings, () => {}, abort.signal);
    const rejected = expect(p).rejects.toThrow();
    await vi.waitFor(() => expect(FakeWorker.all[0]?.lastSplit).toBeGreaterThan(0));
    abort.abort();
    await rejected;
    const w = FakeWorker.all[0];
    w.emit({ type: "fallback", id: w.lastSplit, message: "device lost" });
    w.emit({ type: "cancelled", id: w.lastSplit });

    FakeWorker.splitReply = "done";
    const res = await separateStems(audio, settings, () => {}, new AbortController().signal);
    expect(FakeWorker.all).toHaveLength(1); // the cancelled worker is reused...
    expect(w.terminated).toBe(false);
    expect(res.backends).toEqual(["wasm"]); // ...and known to be on WebAssembly now
  });
});
