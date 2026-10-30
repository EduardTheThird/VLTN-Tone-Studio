import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LyricsCancelled, transcribeLyrics } from "./lyrics-run";

class FakeWorker {
  static current: FakeWorker;
  onmessage?: (e: { data: unknown }) => void;
  onerror?: (e: { message: string }) => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.current = this;
  }
}

const options = { model: "small" as const, quality: "fast" as const, language: "auto" as const };
/** Eight seconds of voice-level tone, so the singing detector finds one region to transcribe. */
const voice = Float32Array.from({ length: 16000 * 8 }, (_, i) => 0.3 * Math.sin(i / 3));
const silence = new Float32Array(16000 * 8);
const audio = (samples: Float32Array) => ({ sampleRate: 16000, channels: [samples] });

beforeEach(() => {
  FakeWorker.current = undefined!;
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal(
    "OfflineAudioContext",
    class {
      destination = {};
      samples: Float32Array = voice;
      createBuffer() {
        return { copyToChannel: () => {} };
      }
      createBufferSource() {
        return { buffer: null, connect() {}, start() {} };
      }
      async startRendering() {
        return { getChannelData: () => this.samples };
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("transcribeLyrics", () => {
  it("starts no transcriber when the vocals have no singing", async () => {
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        destination = {};
        createBuffer() {
          return { copyToChannel: () => {} };
        }
        createBufferSource() {
          return { buffer: null, connect() {}, start() {} };
        }
        async startRendering() {
          return { getChannelData: () => silence };
        }
      },
    );
    expect(await transcribeLyrics({ audio: audio(silence), options })).toEqual({ text: "", placed: 0 });
    expect(FakeWorker.current).toBeUndefined();
  });

  it("builds lines from the heard words, in song time", async () => {
    const result = transcribeLyrics({ audio: audio(voice), options });
    await vi.waitFor(() => expect(FakeWorker.current).toBeDefined());
    FakeWorker.current.onmessage?.({
      data: {
        words: [
          { text: "hold", start: 1, end: 1.4 },
          { text: "still", start: 1.5, end: 1.8 },
          { text: "im", start: 4, end: 4.2 },
        ],
      },
    });
    expect(await result).toEqual({ text: "[00:01.00] hold still\n[00:04.00] im", placed: 0 });
    expect(FakeWorker.current.terminate).toHaveBeenCalled();
  });

  it("times pasted lines against the heard words", async () => {
    const result = transcribeLyrics({ audio: audio(voice), options, pasted: ["Hold on", "I'm coming"] });
    await vi.waitFor(() => expect(FakeWorker.current).toBeDefined());
    FakeWorker.current.onmessage?.({
      data: {
        words: [
          { text: "hold", start: 1, end: 1.4 },
          { text: "on", start: 1.5, end: 1.8 },
          { text: "coming", start: 4, end: 4.5 },
        ],
      },
    });
    // "I'm" was not heard, so "coming" is stepped back over it by the average heard word (0.4 s).
    expect((await result).text).toBe("[00:01.00] Hold on\n[00:03.60] I'm coming");
  });

  it("stops at once when the signal aborts: the worker is ended and nothing is returned", async () => {
    const controller = new AbortController();
    const result = transcribeLyrics({ audio: audio(voice), options, signal: controller.signal });
    await vi.waitFor(() => expect(FakeWorker.current).toBeDefined());
    controller.abort("cancel");
    await expect(result).rejects.toBeInstanceOf(LyricsCancelled);
    expect(FakeWorker.current.terminate).toHaveBeenCalled();
  });
});
