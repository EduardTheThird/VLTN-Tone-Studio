import { afterEach, describe, expect, it, vi } from "vitest";
import { stretchInWorker } from "./stretch-client";
import { stretchPcm } from "./stretch";
import type { StretchRequest, StretchReply } from "./stretch-worker";

/** A stand-in worker that runs the stretch on the same thread, as the real worker entry would, and answers through onmessage. */
class FakeWorker {
  static last: FakeWorker | null = null;
  static fail = false;
  onmessage: ((event: MessageEvent<StretchReply>) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(request: StretchRequest) {
    if (FakeWorker.fail) {
      queueMicrotask(() => this.onerror?.());
      return;
    }
    const pcm = stretchPcm(request.pcm, request.settings);
    queueMicrotask(() => this.onmessage?.({ data: { id: request.id, pcm } } as MessageEvent<StretchReply>));
  }
  terminate() {
    this.terminated = true;
  }
}

afterEach(() => {
  FakeWorker.fail = false;
  vi.unstubAllGlobals();
});

describe("stretchInWorker", () => {
  it("resolves with the stretched stem and terminates its worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const channel = new Float32Array(44100).fill(0.25);
    const out = await stretchInWorker({ sampleRate: 44100, channels: [channel] }, { rate: 0.5, semitones: 0, cents: 0 });
    expect(out.channels[0]).toHaveLength(88200);
    expect(FakeWorker.last?.terminated).toBe(true);
  });

  it("leaves the caller's buffers intact, because the copy is what gets transferred", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const channel = new Float32Array(1000).fill(0.5);
    await stretchInWorker({ sampleRate: 44100, channels: [channel] }, { rate: 1, semitones: 0, cents: 0 });
    expect(channel.buffer.byteLength).toBe(4000);
    expect(channel[0]).toBe(0.5);
  });

  it("rejects when the worker fails", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.fail = true;
    await expect(stretchInWorker({ sampleRate: 44100, channels: [new Float32Array(10)] }, { rate: 1, semitones: 0, cents: 0 })).rejects.toThrow(
      /stretch worker failed/,
    );
    expect(FakeWorker.last?.terminated).toBe(true);
  });
});
