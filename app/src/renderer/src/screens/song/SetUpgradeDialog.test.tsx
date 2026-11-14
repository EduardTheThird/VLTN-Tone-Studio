import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyLibrary, type LibrarySong } from "@shared/song-library";
import { DEFAULT_BAND_SETTINGS } from "@/song/band/arrangement";
import { resetStageActivity, useStageActivity } from "@/state/stage-activity";
import { useBandPanel } from "./band-panel-state";

const mocks = vi.hoisted(() => ({ backup: vi.fn(), index: vi.fn(), upgrade: vi.fn(), preflight: vi.fn(), log: vi.fn(), load: vi.fn() }));
vi.mock("@/host", () => ({ host: { song: { library: { exportBackup: mocks.backup, index: mocks.index } } } }));
vi.mock("@/state/session-log", () => ({ sessionLog: mocks.log }));
vi.mock("./use-preset-names", () => ({ useKnownPresetNames: () => undefined }));
vi.mock("@/song/performance/run-set-upgrade", async (original) => ({
  ...(await original<typeof import("@/song/performance/run-set-upgrade")>()),
  upgradeSavedSong: mocks.upgrade,
}));
vi.mock("@/song/library", async () => {
  const { create } = await import("zustand");
  return {
    useSongLibrary: create(() => ({
      index: emptyLibrary(),
      busy: false,
      playlistPlaying: false,
      error: "",
      refresh: vi.fn(),
      saveBeforePlayback: vi.fn(),
      load: mocks.load,
    })),
    loadSongAudio: vi.fn(),
    acceptUpgradedSong: vi.fn(),
  };
});
vi.mock("@/song/store", () => ({ useSong: { getState: () => ({ source: { libraryId: "1" } }) } }));
vi.mock("@/song/performance/settings", () => ({ flushSettings: vi.fn() }));
vi.mock("@/song/band/bass-chain", () => ({ renderPartChain: vi.fn() }));
vi.mock("./PlaylistPreflight", () => ({
  PlaylistPreflight: (props: unknown) => {
    mocks.preflight(props);
    return <p>Playlist check summary</p>;
  },
}));
const { useSongLibrary } = await import("@/song/library");
const { SetUpgradeDialog } = await import("./SetUpgradeDialog");
const songs: LibrarySong[] = [1, 2, 3, 4].map((id) => ({
  id: String(id),
  title: `Song ${id}`,
  artist: "",
  sourceName: "Fixture.wav",
  updated: "today",
  duration: 8,
  settings: { ":options": JSON.stringify({ band: { ...DEFAULT_BAND_SETTINGS, engine: 1 }, generatedParts: { bass: "track0" } }) },
  audio: [{ name: "Bass (generated)", file: "track0.flac", kind: "user", sampleRate: 44100, frames: 352800, channels: 2 }],
}));
const row = (song: LibrarySong) => ({ id: song.id, title: song.title, band: "Done", bass: "Skipped", cues: "Skipped", save: "Done" });
function open() {
  return render(<SetUpgradeDialog ids={songs.map((song) => song.id)} name="Fixture set" onClose={vi.fn()} />);
}
function start() {
  fireEvent.click(screen.getByRole("checkbox", { name: "I have a backup" }));
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  resetStageActivity();
  const index = { ...emptyLibrary(), songs: structuredClone(songs) };
  useSongLibrary.setState({ index, busy: false, error: "", playlistPlaying: false });
  mocks.index.mockResolvedValue(index);
  mocks.backup.mockResolvedValue(null);
  mocks.upgrade.mockImplementation(async (song) => row(song));
});
afterEach(cleanup);
it("requires a backup or explicit tick; a cancelled backup picker does not unlock Start", async () => {
  open();
  expect(screen.getByRole("button", { name: "Start" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Back up the library first" }));
  await waitFor(() => expect(mocks.backup).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole("button", { name: "Back up the library first" }).hasAttribute("disabled")).toBe(false));
  expect(screen.getByRole("button", { name: "Start" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "I have a backup" }));
  expect(screen.getByRole("button", { name: "Start" }).hasAttribute("disabled")).toBe(false);
});
it("shows the completed backup location and enables Start", async () => {
  mocks.backup.mockResolvedValue({ fileName: "/copies/before-upgrade.vltn", songs: 4, playlists: 1 });
  open();
  fireEvent.click(screen.getByRole("button", { name: "Back up the library first" }));
  await screen.findByText("Backup saved to /copies/before-upgrade.vltn");
  expect(screen.getByRole("button", { name: "Start" }).hasAttribute("disabled")).toBe(false);
});
it("Cancel during song 2 finishes that song and leaves songs 3 and 4 untouched", async () => {
  let finish!: () => void;
  mocks.upgrade.mockImplementation(async (song) => {
    if (song.id === "2")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return row(song);
  });
  open();
  start();
  await waitFor(() => expect(mocks.upgrade).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => finish());
  await screen.findByText("Stopped. Later songs were left unchanged.");
  expect(mocks.upgrade).toHaveBeenCalledTimes(2);
  expect(screen.getAllByText("Skipped: Cancelled before this song")).toHaveLength(8);
  expect(mocks.log).toHaveBeenCalledTimes(2);
});
it("reports a failed song, continues, runs preflight and lists musical decisions with Open Band", async () => {
  mocks.upgrade.mockImplementation(async (song) => {
    if (song.id === "2") throw new Error("Disk unavailable");
    return row(song);
  });
  open();
  start();
  await screen.findByRole("region", { name: "Still yours to choose, per song" });
  expect(mocks.upgrade).toHaveBeenCalledTimes(4);
  expect(screen.getAllByText("Failed: Disk unavailable")).toHaveLength(3);
  expect(mocks.preflight).toHaveBeenCalledWith(expect.objectContaining({ autoStart: true, compact: true, ids: ["1", "2", "3", "4"] }));
  expect(screen.getByText("Count-in on the first song: Off")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Open Band: Song 1, Room and Kit/ }));
  await waitFor(() => expect(useBandPanel.getState().tab).toBe("feel"));
  expect(mocks.load).toHaveBeenCalledWith("1");
});
it("refuses to start or back up while stage activity is busy", () => {
  useStageActivity.setState({ busy: true });
  open();
  fireEvent.click(screen.getByRole("checkbox", { name: "I have a backup" }));
  expect(screen.getByText("Stop playback to update the set")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Back up the library first" }).hasAttribute("disabled")).toBe(true);
  expect(mocks.upgrade).not.toHaveBeenCalled();
});

it("reports a missing playlist entry and continues with later songs", async () => {
  mocks.index.mockResolvedValue({ ...emptyLibrary(), songs: songs.filter((song) => song.id !== "2") });
  open();
  start();
  await screen.findByRole("region", { name: "Still yours to choose, per song" });
  expect(mocks.upgrade).toHaveBeenCalledTimes(3);
  expect(screen.getAllByText("Failed: Song is missing from the library. Restore it from a backup.")).toHaveLength(3);
});
