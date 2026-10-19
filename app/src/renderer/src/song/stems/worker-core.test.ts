import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEGMENT } from "./demucs";
import type { WorkerReply, WorkerRequest } from "./protocol";
import { serveSeparation } from "./worker-core";

// A mocked onnxruntime: each created session runs `behaviour[backend]` per chunk; the worker body talks to a fake `self`.
type Run = (call: number) => void;
let posted: WorkerReply[];
let created: string[];
let behaviour: { webgpu: Run; wasm: Run };
let createWasm: () => void;
let send: (msg: WorkerRequest) => void;

function boot() {
  const ort = {
    env: { wasm: {} as Record<string, unknown> },
    Tensor: class {},
    InferenceSession: {
      create: async (_bytes: Uint8Array, o: { executionProviders: ("webgpu" | "wasm")[] }) => {
        const backend = o.executionProviders[0];
        created.push(backend);
        if (backend === "wasm") createWasm();
        let calls = 0;
        return {
          inputNames: ["in"],
          outputNames: ["out"],
          run: async () => {
            behaviour[backend](++calls);
            return { out: { getData: async () => new Float32Array(2 * SEGMENT), dispose() {} } };
          },
          release: async () => {},
        };
      },
    },
  };
  const fake = { crossOriginIsolated: false, postMessage: (m: WorkerReply) => posted.push(m), onmessage: null as ((e: MessageEvent) => void) | null };
  vi.stubGlobal("self", fake);
  vi.stubGlobal("navigator", { gpu: {}, hardwareConcurrency: 2 });
  serveSeparation(ort as never);
  send = (msg) => fake.onmessage?.({ data: msg } as MessageEvent);
}

const settle = () => vi.waitFor(() => expect(posted.some((m) => m.type === "done" || m.type === "error")).toBe(true));
const split = (id: number) => send({ type: "split", id, channels: [new Float32Array(2 * SEGMENT), new Float32Array(2 * SEGMENT)], sources: 1, rows: [0], overlap: 0.25, shifts: 0 });
const load = () => send({ type: "load", file: "m.onnx", model: new Uint8Array(4), gpu: true, optimize: true });
const last = (type: string) => posted.filter((m) => m.type === type);

describe("separation worker", () => {
  beforeEach(() => {
    posted = [];
    created = [];
    behaviour = { webgpu: () => {}, wasm: () => {} };
    createWasm = () => {};
    boot();
  });

  it("rebuilds a WebAssembly session when WebGPU is lost mid-split and finishes the split", async () => {
    behaviour.webgpu = (call) => {
      if (call === 3) throw new Error("device lost");
    };
    load();
    split(1);
    await settle();
    expect(last("fallback")).toEqual([{ type: "fallback", id: 1, message: "device lost" }]);
    expect(last("done")).toHaveLength(1);
    expect(last("error")).toHaveLength(0);
    expect(created).toEqual(["webgpu", "wasm"]);
  });

  it("retries the lost chunk exactly once and keeps reporting progress on WebAssembly", async () => {
    let webgpuCalls = 0;
    let wasmCalls = 0;
    behaviour.webgpu = (call) => {
      webgpuCalls = call;
      if (call === 3) throw new Error("device lost");
    };
    behaviour.wasm = (call) => {
      wasmCalls = call;
    };
    load();
    split(1);
    await settle();
    expect(webgpuCalls).toBe(3); // no further WebGPU attempt after the loss
    expect(wasmCalls).toBeGreaterThanOrEqual(1); // the lost chunk was redone on the CPU
    const progress = last("progress").map((m) => (m as { fraction: number }).fraction);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("does not retry a WebAssembly session's failure", async () => {
    behaviour.wasm = () => {
      throw new Error("oom");
    };
    send({ type: "load", file: "m.onnx", model: new Uint8Array(4), gpu: false, optimize: true });
    split(1);
    await settle();
    expect(last("error")).toEqual([{ type: "error", id: 1, message: "oom" }]);
    expect(created).toEqual(["wasm"]);
  });

  it("reports an error when the WebAssembly rebuild itself fails", async () => {
    behaviour.webgpu = () => {
      throw new Error("device lost");
    };
    load();
    await vi.waitFor(() => expect(last("loaded")).toHaveLength(1));
    createWasm = () => {
      throw new Error("no memory");
    };
    split(1);
    await settle();
    expect(last("error")).toEqual([{ type: "error", id: 1, message: "no memory" }]);
  });
});
