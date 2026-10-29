import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAnalysisJob, describeTimeLeft, jobFraction, secondsLeft, PLAYING_REFUSAL } from "./analysis-job";
import { defaultChoice, type BatchOptions, type BatchOutcome, type BatchSong } from "./batch";
import { runLibraryAnalysis } from "./library-batch";
import { setSongPlaying } from "../performance/playing-state";

vi.mock("./library-batch", () => ({ runLibraryAnalysis: vi.fn() }));
vi.mock("../library", () => ({ useSongLibrary: { getState: () => ({ playlistPlaying: false }) } }));
const run = vi.mocked(runLibraryAnalysis);

const song = (id: string): BatchSong => ({ id, title: `Song ${id}`, settings: { ":bpm": "120", ":options": "{}" } });
const options: BatchOptions = { onlyNeeded: false, replaceManual: false, choice: defaultChoice(), openSongId: null };
const songs = [song("a"), song("b"), song("c")];

// The batch is a fake here: the test drives its callbacks and decides when it ends.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const callbacks = () => run.mock.calls[0][3]!;
const signal = () => run.mock.calls[0][2];
const analysed = (id: string): BatchOutcome => ({ id, title: `Song ${id}`, status: "analysed", tempoChange: null, noBeat: false, lyrics: null });

let end: ReturnType<typeof deferred<BatchOutcome[]>>;

beforeEach(() => {
  vi.clearAllMocks();
  end = deferred<BatchOutcome[]>();
  run.mockReturnValue(end.promise);
});
// The job is one store for the whole app, so each test ends its run and lets the end be recorded before the next one starts.
afterEach(async () => {
  end.resolve([]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  setSongPlaying(false);
  useAnalysisJob.getState().dismiss();
  useAnalysisJob.setState({ openRequested: false });
});

describe("the job store", () => {
  it("is in the preparing phase at once, before the batch reports anything", () => {
    expect(useAnalysisJob.getState().start(songs, options)).toBeNull();
    expect(useAnalysisJob.getState()).toMatchObject({ phase: "preparing", total: 3, done: 0, current: null });
  });

  it("follows the batch: loading, the step it is on, waiting for playback, and each song as it finishes", () => {
    useAnalysisJob.getState().start(songs, options);
    callbacks().onLoading?.("Song a");
    expect(useAnalysisJob.getState()).toMatchObject({ phase: "loading", current: { title: "Song a", step: null } });
    callbacks().onProgress?.({ index: 0, total: 3, title: "Song a", step: "tempo", stepIndex: 2, steps: 7 });
    expect(useAnalysisJob.getState()).toMatchObject({ phase: "analysing", current: { title: "Song a", step: "tempo", stepIndex: 2, steps: 7 } });
    setSongPlaying(true);
    callbacks().onWaiting?.(true);
    expect(useAnalysisJob.getState()).toMatchObject({ phase: "waiting", waitingFor: "song" });
    setSongPlaying(false);
    callbacks().onWaiting?.(false);
    expect(useAnalysisJob.getState()).toMatchObject({ phase: "analysing", waitingFor: null });
    callbacks().onSongDone?.(analysed("a"));
    expect(useAnalysisJob.getState()).toMatchObject({ done: 1, current: null, outcomes: [analysed("a")] });
  });

  it("refuses a second run while one is going", () => {
    useAnalysisJob.getState().start(songs, options);
    expect(useAnalysisJob.getState().start(songs, options)).toBe("An analysis is already running.");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("refuses to start while a song plays, and does not run the batch", () => {
    setSongPlaying(true);
    expect(useAnalysisJob.getState().start(songs, options)).toBe(PLAYING_REFUSAL);
    expect(run).not.toHaveBeenCalled();
    expect(useAnalysisJob.getState().phase).toBe("idle");
  });

  it("ends as finished with the summary of the batch", async () => {
    useAnalysisJob.getState().start(songs, options);
    end.resolve([analysed("a"), analysed("b")]);
    await end.promise;
    await vi.waitFor(() => expect(useAnalysisJob.getState().phase).toBe("finished"));
    expect(useAnalysisJob.getState().summary).toBe("Analysed 2 songs.");
    expect(useAnalysisJob.getState().endedAt).not.toBeNull();
  });

  it("stop aborts the batch, and the run ends as stopped", async () => {
    useAnalysisJob.getState().start(songs, options);
    useAnalysisJob.getState().stop();
    expect(signal().aborted).toBe(true);
    end.resolve([analysed("a")]);
    await vi.waitFor(() => expect(useAnalysisJob.getState().phase).toBe("stopped"));
    expect(useAnalysisJob.getState().summary).toContain("Stopped");
  });

  it("a batch that throws ends as failed, with the message", async () => {
    useAnalysisJob.getState().start(songs, options);
    end.reject(new Error("Disk full"));
    await vi.waitFor(() => expect(useAnalysisJob.getState().phase).toBe("failed"));
    expect(useAnalysisJob.getState().error).toBe("Disk full");
  });

  it("dismiss clears an ended run, but not a running one", () => {
    useAnalysisJob.getState().start(songs, options);
    useAnalysisJob.getState().dismiss();
    expect(useAnalysisJob.getState().phase).toBe("preparing");
    end.resolve([]);
  });

  it("keeps the run going with no component mounted: the state is outside React", () => {
    useAnalysisJob.getState().start(songs, options);
    callbacks().onSongDone?.(analysed("a"));
    expect(useAnalysisJob.getState().done).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("asks the Library to open the dialog once, and then clears the request", () => {
    useAnalysisJob.getState().requestOpen();
    expect(useAnalysisJob.getState().openRequested).toBe(true);
    useAnalysisJob.getState().consumeOpenRequest();
    expect(useAnalysisJob.getState().openRequested).toBe(false);
  });
});

describe("the progress maths", () => {
  it("counts the finished songs and the share of the current song's steps", () => {
    expect(jobFraction({ total: 4, done: 1, current: { title: "b", step: "key", stepIndex: 2, steps: 4 } })).toBeCloseTo(0.375);
    expect(jobFraction({ total: 4, done: 4, current: null })).toBe(1);
    expect(jobFraction({ total: 0, done: 0, current: null })).toBe(0);
  });

  it("estimates the time left from the average per finished song, and gives none before the first song is done", () => {
    expect(secondsLeft(60_000, 0, 0, 5)).toBeNull();
    // Two songs in 120 s is 60 s each; three are left.
    expect(secondsLeft(120_000, 0, 2, 5)).toBe(180);
  });

  it("describes the time left in words", () => {
    expect(describeTimeLeft(30)).toBe("under a minute");
    expect(describeTimeLeft(240)).toBe("about 4 min");
  });
});
