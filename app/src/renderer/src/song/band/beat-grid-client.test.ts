import { afterEach, describe, expect, it, vi } from "vitest";
import type { BeatGrid } from "./beat-grid";
import { startBeatGrid } from "./beat-grid-client";

/** Stands in for a Worker, so the test can answer or fail the job by hand. */
class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: unknown = null;
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: unknown) {
    this.posted = message;
  }
  terminate() {
    this.terminated = true;
  }
}

const grid: BeatGrid = { beatsPerBar: 4, beats: [0.5, 1], downbeat: 0, bpm: 120, steady: null };
const request = { sources: [], sampleRate: 44100, beatsPerBar: 4 };

describe("startBeatGrid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves with the worker's grid and ends the worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const job = startBeatGrid(request);
    const worker = FakeWorker.last!;
    expect(worker.posted).toBe(request);
    worker.onmessage!({ data: { grid } } as MessageEvent);
    await expect(job.done).resolves.toEqual(grid);
    expect(worker.terminated).toBe(true);
  });

  it("rejects with the worker's error", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const job = startBeatGrid(request);
    FakeWorker.last!.onmessage!({ data: { error: "boom" } } as MessageEvent);
    await expect(job.done).rejects.toThrow("boom");
  });

  it("cancels at once: the worker is ended and the job rejects as an abort", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const job = startBeatGrid(request);
    const worker = FakeWorker.last!;
    job.cancel();
    expect(worker.terminated).toBe(true);
    const error = await job.done.then(
      () => null,
      (e: Error) => e,
    );
    expect(error?.name).toBe("AbortError");
  });
});
