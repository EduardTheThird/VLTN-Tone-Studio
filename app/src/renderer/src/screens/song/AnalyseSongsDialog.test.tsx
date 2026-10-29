import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AnalyseSongsDialog } from "./AnalyseSongsDialog";
import { runLibraryAnalysis } from "@/song/analysis/library-batch";
import { setSongPlaying } from "@/song/performance/playing-state";
import { useSongLibrary } from "@/song/library";
import { ANALYSIS_VERSION } from "@/song/analysis/song-analysis";
import type { BatchSong } from "@/song/analysis/batch";

vi.mock("@/host", () => ({ host: { song: {} } }));
vi.mock("@/song/stems/engine", () => ({ separateStems: vi.fn() }));
vi.mock("@/song/analysis/library-batch", () => ({ runLibraryAnalysis: vi.fn() }));
const run = vi.mocked(runLibraryAnalysis);

// Alpha has no tempo of its own, so it needs analysing. Bravo's tempo was set by hand and its analysis is current, so it does not.
const alpha: BatchSong = { id: "a", title: "Alpha", settings: { ":bpm": "120", ":options": "{}" } };
const bravo: BatchSong = {
  id: "b",
  title: "Bravo",
  settings: { ":bpm": "95", ":options": JSON.stringify({ tempoSource: "manual", analysis: { audioId: "x", version: ANALYSIS_VERSION } }) },
};

beforeEach(() => {
  vi.clearAllMocks();
  useSongLibrary.setState({ playlistPlaying: false });
});
afterEach(() => {
  setSongPlaying(false);
  cleanup();
});

const open = (songs: BatchSong[]) => render(<AnalyseSongsDialog open songs={songs} onOpenChange={vi.fn()} />);

it("says how many songs will run, leaving out the ones that are already analysed", () => {
  open([alpha, bravo]);
  expect(screen.getByText(/2 songs in the selection\. 1 will be analysed\./)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Analyse 1 song" })).toBeTruthy();
});

it("refuses to start while a song plays, and does not run the batch", () => {
  setSongPlaying(true);
  open([alpha]);
  fireEvent.click(screen.getByRole("button", { name: "Analyse 1 song" }));
  expect(run).not.toHaveBeenCalled();
  expect(screen.getByText(/Stop playback before analysing songs/)).toBeTruthy();
});

it("runs the batch with the choices as they are, and shows the tempos it changed", async () => {
  run.mockResolvedValue([{ id: "a", title: "Alpha", status: "analysed", tempoChange: { from: 120, to: 98 }, noBeat: false, lyrics: null }]);
  open([alpha, bravo]);
  fireEvent.click(screen.getByRole("button", { name: "Analyse 1 song" }));
  expect(run).toHaveBeenCalledWith(
    [alpha, bravo],
    expect.objectContaining({ onlyNeeded: true, replaceManual: false, openSongId: null }),
    expect.any(AbortSignal),
    expect.any(Function),
  );
  expect(await screen.findByText("Analysed 1 song. Tempo changed on 1 (Alpha: 120 → 98).")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
});

it("can leave a step out of the batch", () => {
  run.mockResolvedValue([]);
  open([alpha]);
  fireEvent.click(screen.getByText("Key").closest("label")!.querySelector("button")!);
  fireEvent.click(screen.getByRole("button", { name: "Analyse 1 song" }));
  expect(run).toHaveBeenCalledWith(
    [alpha],
    expect.objectContaining({ choice: expect.objectContaining({ key: false }) }),
    expect.any(AbortSignal),
    expect.any(Function),
  );
});
