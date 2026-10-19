import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToneRecord } from "@shared/host/tones";
// vi.mock below is hoisted above these imports: no worker, no converter, no pedal.
import { startSendDraft } from "@/screens/tones/store";
import { convertToClone } from "@/snaptone/convert";
import type { CaptureFit } from "./capture-match";
import { capturesFrom, MATCHED_IR_NAME, rankedCaptures, useCaptureMatch, type CaptureResult } from "./capture-store";
import { useToneMatch } from "./store";

const fake = vi.hoisted(() => ({
  records: [] as unknown[],
  device: "gp5" as string,
  /** Fits by NAM text; a missing one never resolves (a render still running) */
  fits: {} as Record<string, unknown>,
  rankers: [] as { closed: boolean; evaluated: string[] }[],
  signal: new Uint8Array([1]) as Uint8Array | null,
}));

/** The Tone Match store as far as the capture store uses it: the analysis and its change notifications. */
const toneMatch = vi.hoisted(() => {
  type State = { analysis: unknown };
  let state: State = { analysis: null };
  const listeners: ((s: State, prev: State) => void)[] = [];
  return {
    getState: () => state,
    setState: (patch: Partial<State>) => {
      const prev = state;
      state = { ...state, ...patch };
      listeners.forEach((l) => l(state, prev));
    },
    subscribe: (l: (s: State, prev: State) => void) => {
      listeners.push(l);
      return () => {};
    },
  };
});

vi.mock("@/host", () => ({
  host: {
    tones: {
      local: async () => fake.records,
      readNam: async (toneId: number, modelId: number) => `nam-${toneId}-${modelId}`,
    },
    snaptone: { signal: async () => fake.signal },
  },
}));
vi.mock("./capture-run", () => ({
  CaptureRanker: class {
    state = { closed: false, evaluated: [] as string[] };
    failure: Error | null = null;
    #reject: ((e: Error) => void) | null = null;
    constructor() {
      fake.rankers.push(this.state);
    }
    evaluate(namText: string) {
      this.state.evaluated.push(namText);
      const fit = fake.fits[namText];
      if (fit === "fail") return Promise.reject(new Error("Not a NAM WaveNet model"));
      if (fit) return Promise.resolve(fit);
      const { promise, reject } = Promise.withResolvers();
      this.#reject = reject;
      return promise;
    }
    close() {
      this.state.closed = true;
      this.failure = new DOMException("Ranking cancelled", "AbortError");
      this.#reject?.(this.failure);
    }
  },
}));
vi.mock("./store", () => ({ useToneMatch: toneMatch, targetDevice: (d: { device: string | null }) => d.device ?? "gp5" }));
vi.mock("@/state/device", () => ({ useDevice: { getState: () => ({ device: fake.device, preset: null }) } }));
vi.mock("@/screens/tones/store", () => ({ browse: vi.fn(), loadRecords: vi.fn(), startSendDraft: vi.fn(() => true) }));
vi.mock("@/snaptone/convert", () => ({ convertToClone: vi.fn(async () => new Uint8Array(8840)) }));
vi.mock("@shared/nam", () => ({ prepareNam: (text: string) => ({ json: text, check: { version: "0.5.4", reshaped: false, arch: "A1", size: "standard" } }) }));

const model = (id: number, name: string, architecture: "1" | "2" | "custom", size: "standard" | "nano" | "custom" = "standard") => ({ id, name, size, architecture, file: `${id}.nam`, bytes: 1 });

function record(toneId: number, title: string, gear: ToneRecord["gear"], models: ToneRecord["models"], format: ToneRecord["format"] = "nam"): ToneRecord {
  return {
    tone_id: toneId,
    title,
    gear,
    format,
    creator: { username: "someone", avatar_url: null },
    image_url: null,
    license: "t3k",
    url: "",
    models,
    gp5: { verdict: "ready" },
    savedAt: "2026-10-15T00:00:00.000Z",
  };
}

const fit = (distance: number, withIr: boolean): CaptureFit =>
  ({
    includesCab: !withIr,
    distance,
    score: 50,
    gainDelta: 0,
    residualDb: 1,
    arch: "A1",
    rate: 48000,
    ir: withIr ? { curve: { centers: [], db: new Float64Array() }, ir: new Float32Array(1024).fill(0.01) } : null,
  }) as unknown as CaptureFit;

const analysis = { ltas: {}, gain: { score: 0.6 }, tone: {} };

beforeEach(() => {
  fake.records = [];
  fake.fits = {};
  fake.rankers = [];
  fake.device = "gp5";
  fake.signal = new Uint8Array([1]);
  vi.mocked(convertToClone).mockClear();
  vi.mocked(startSendDraft).mockClear();
  useToneMatch.setState({ analysis: null });
  useCaptureMatch.getState().reset();
  useCaptureMatch.setState({ captures: null });
  useToneMatch.setState({ analysis: analysis as never });
});

describe("capturesFrom", () => {
  it("keeps amp and pedal NAM captures, one per model name, A2 over A1, and drops what can't become a SnapTone", () => {
    const captures = capturesFrom([
      record(1, "Plexi", "amp", [model(10, "Gain 5", "1"), model(11, "Gain 5", "2"), model(12, "Gain 9", "1"), model(13, "Odd", "custom", "custom")]),
      record(2, "Celestion V30", "cab", [model(20, "V30", "1")]),
      record(3, "Room IR", "cab", [model(30, "IR", "1")], "ir"),
      record(4, "Klon", "pedal", [model(40, "Klon", "1", "nano")]),
    ]);
    expect(captures.map((c) => c.key)).toEqual(["4:40", "1:11", "1:12"]);
  });
});

describe("rankedCaptures", () => {
  it("orders by distance, keeps unranked after the ranked and failures last", () => {
    const captures = capturesFrom([record(1, "A", "amp", [model(1, "a", "1"), model(2, "b", "1"), model(3, "c", "1"), model(4, "d", "1")])]);
    const results: Record<string, CaptureResult> = { "1:1": { kind: "failed", message: "x" }, "1:2": { kind: "done", fit: fit(3, true) }, "1:4": { kind: "done", fit: fit(1, true) } };
    expect(rankedCaptures(captures, results).map((c) => c.key)).toEqual(["1:4", "1:2", "1:3", "1:1"]);
  });
});

describe("ranking", () => {
  it("finishes at once without a worker when there are no captures", async () => {
    await useCaptureMatch.getState().rank();
    expect(useCaptureMatch.getState()).toMatchObject({ captures: [], status: { kind: "done" } });
    expect(fake.rankers).toHaveLength(0);
  });

  it("asks for Valeton's test signal before rendering anything", async () => {
    fake.records = [record(1, "Plexi", "amp", [model(10, "Gain 5", "1")])];
    fake.signal = null;
    await useCaptureMatch.getState().rank();
    expect(useCaptureMatch.getState().status).toMatchObject({ kind: "error", needsSignal: true });
    expect(fake.rankers).toHaveLength(0);
  });

  it("ranks every capture, keeps a failing one as failed, and selects the closest", async () => {
    fake.records = [record(1, "Plexi", "amp", [model(10, "Gain 5", "1"), model(11, "Gain 9", "1")]), record(2, "Broken", "amp", [model(20, "x", "1")])];
    fake.fits = { "nam-1-10": fit(2, true), "nam-1-11": fit(0.5, true), "nam-2-20": "fail" };
    await useCaptureMatch.getState().rank();
    const s = useCaptureMatch.getState();
    expect(s.status.kind).toBe("done");
    expect(s.selected).toBe("1:11");
    expect(s.results["2:20"]).toEqual({ kind: "failed", message: "Not a NAM WaveNet model" });
    expect(fake.rankers[0].closed).toBe(true);
  });

  it("cancels mid-render, closes the worker, and later ranks only what is left", async () => {
    fake.records = [record(1, "Plexi", "amp", [model(10, "Gain 5", "1"), model(11, "Gain 9", "1")])];
    fake.fits = { "nam-1-11": fit(1, true) }; // Gain 5 (first by name) never finishes on its own
    const first = useCaptureMatch.getState().rank();
    await vi.waitFor(() => expect(useCaptureMatch.getState().results["1:10"]?.kind).toBe("running"));
    useCaptureMatch.getState().cancel();
    await first;
    expect(useCaptureMatch.getState().status.kind).toBe("cancelled");
    expect(useCaptureMatch.getState().results["1:10"]).toBeUndefined();
    expect(fake.rankers[0].closed).toBe(true);

    fake.fits["nam-1-10"] = fit(2, true);
    await useCaptureMatch.getState().rank();
    expect(useCaptureMatch.getState().status.kind).toBe("done");
    expect(fake.rankers[1].evaluated).toEqual(["nam-1-10", "nam-1-11"]);
    await useCaptureMatch.getState().rank();
    expect(fake.rankers).toHaveLength(2); // nothing left to rank
  });

  it("drops the ranking when the song is analysed again", async () => {
    fake.records = [record(1, "Plexi", "amp", [model(10, "Gain 5", "1")])];
    fake.fits = { "nam-1-10": fit(1, true) };
    await useCaptureMatch.getState().rank();
    useToneMatch.setState({ analysis: { ...analysis } as never });
    expect(useCaptureMatch.getState()).toMatchObject({ results: {}, status: { kind: "idle" }, selected: null });
  });
});

describe("building the SnapTone", () => {
  async function rankOne(gear: ToneRecord["gear"], withIr: boolean) {
    fake.records = [record(1, "Plexi 1959", gear, [model(10, "Gain 5", "1")])];
    fake.fits = { "nam-1-10": fit(1, withIr) };
    await useCaptureMatch.getState().rank();
    await useCaptureMatch.getState().buildSnapTone();
  }

  it("bakes the matched IR into a GP-5 SnapTone and hands it to the send flow at the write step", async () => {
    await rankOne("amp", true);
    const wav = vi.mocked(convertToClone).mock.calls[0][3];
    expect(String.fromCharCode(...(wav ?? []).slice(0, 4))).toBe("RIFF");
    const [toneId, modelId, , kind, opts] = vi.mocked(startSendDraft).mock.calls[0];
    expect([toneId, modelId, kind]).toEqual([1, 10, "snaptone"]);
    expect(opts?.cabIr).toEqual({ kind: "file", name: MATCHED_IR_NAME, wav });
    expect(opts?.built?.clone).toHaveLength(8840);
    expect(useCaptureMatch.getState().build).toEqual({ kind: "built", key: "1:10", toneId: 1, withIr: true });
  });

  it("adds no IR to a capture that includes its cab", async () => {
    await rankOne("amp-cab", false);
    expect(vi.mocked(convertToClone).mock.calls[0][3]).toBeUndefined();
    expect(vi.mocked(startSendDraft).mock.calls[0][4]?.cabIr).toBeNull();
  });

  it("leaves the IR out of the SnapTone on the GP-200 family, where CAB plays after it", async () => {
    fake.device = "gp200";
    await rankOne("amp", true);
    expect(vi.mocked(convertToClone).mock.calls[0][3]).toBeUndefined();
    expect(useCaptureMatch.getState().build).toMatchObject({ kind: "built", withIr: false });
  });

  it("reports a send of the same tone already running in Tones", async () => {
    vi.mocked(startSendDraft).mockReturnValueOnce(false);
    await rankOne("amp", true);
    expect(useCaptureMatch.getState().build).toEqual({ kind: "error", key: "1:10", message: "Plexi 1959 is being sent from Tones right now. Build again when that has finished." });
  });
});
