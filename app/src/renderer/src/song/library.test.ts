import { beforeEach, expect, it, vi } from "vitest";
import { emptyLibrary, type LibrarySong } from "@shared/song-library";
import { useSong } from "./store";
import { useSongLibrary } from "./library";
import { clearSettingsCache, getSetting, performanceKey, setSetting } from "./performance/settings";
import { useNav } from "@/state/nav";

const api = vi.hoisted(() => ({
  index: vi.fn(),
  save: vi.fn(),
  audioUrls: vi.fn(),
  playlists: vi.fn(),
  remove: vi.fn(),
  updateSettings: vi.fn(),
  exportBackup: vi.fn(),
  inspectBackup: vi.fn(),
  restoreBackup: vi.fn(),
  onTransferProgress: vi.fn(),
}));
vi.mock("@/host", () => ({ host: { song: { library: api } } }));
vi.mock("./stems/engine", () => ({ separateStems: vi.fn() }));
const audio = { sampleRate: 44100, channels: [new Float32Array([0, 0.25, -0.25])] };
const codec = vi.hoisted(() => ({ decodeTrack: vi.fn(), encodeTrack: vi.fn() }));
vi.mock("./codec/flac-client", () => codec);
const fetchFile = vi.fn();
vi.stubGlobal("fetch", fetchFile);
const file = (bytes = 8) => new Response(new Uint8Array(bytes));
const saved: LibrarySong = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  title: "Saved song",
  artist: "",
  sourceName: "same.mp3",
  duration: 3 / 44100,
  audio: [
    { name: "source", sampleRate: 44100, frames: 3, channels: 1, file: "source.flac", codec: "flac", bytes: 8, sha256: "a".repeat(64) },
    { name: "guitar", sampleRate: 44100, frames: 3, channels: 1, file: "guitar.flac", codec: "flac", bytes: 8, sha256: "b".repeat(64) },
  ],
  settings: { ":bpm": "95", "": "[00:00] [Am]", ":lyrics": "[00:00] Words" },
  updated: "",
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  clearSettingsCache();
  api.exportBackup.mockResolvedValue(null);
  api.inspectBackup.mockResolvedValue(null);
  api.onTransferProgress.mockReturnValue(vi.fn());
  api.index.mockResolvedValue({ ...emptyLibrary(), songs: [saved] });
  api.audioUrls.mockResolvedValue({ source: "app://library/rev/source.flac", guitar: "app://library/rev/guitar.flac" });
  fetchFile.mockReset();
  fetchFile.mockImplementation(async () => file());
  codec.decodeTrack.mockReset();
  codec.decodeTrack.mockResolvedValue(audio);
  codec.encodeTrack.mockReset();
  codec.encodeTrack.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
  api.updateSettings.mockResolvedValue(undefined);
  api.save.mockResolvedValue(undefined);
  useSong.setState({ source: null, stems: null, status: { kind: "idle" } });
  useSongLibrary.setState({ index: emptyLibrary(), busy: false, error: "", notice: "", queue: [], position: -1, playlistPlaying: false, midiSession: null });
});
it("loads saved source/stems and preserves queue positions for repeated entries", async () => {
  await useSongLibrary.getState().load(saved.id, [saved.id, saved.id], 1);
  expect(useSong.getState().source?.audio.channels[0]).toEqual(audio.channels[0]);
  expect(useSong.getState().stems?.guitar?.channels[0]).toEqual(audio.channels[0]);
  expect(getSetting(performanceKey(useSong.getState().source), ":lyrics")).toBe("[00:00] Words");
  expect(useSongLibrary.getState().position).toBe(1);
  expect(useNav.getState().param).toBe("performance");
});
it("does not replace the current song when an asset read fails", async () => {
  const source = { name: "Current", audio };
  useSong.setState({ source });
  fetchFile.mockRejectedValueOnce(new Error("Missing audio"));
  await useSongLibrary.getState().load(saved.id);
  expect(useSong.getState().source).toBe(source);
  expect(useSongLibrary.getState().error).toBe("Missing audio");
  expect(useNav.getState().param).toBe("songs");
});
it("saves copied audio and settings under a unique ID instead of the filename", async () => {
  const source = { name: "same.mp3", audio };
  useSong.setState({ source, stems: { guitar: audio } });
  localStorage.setItem(performanceKey(source), "[00:00] [C]");
  await useSongLibrary.getState().save("My song", "Artist");
  const [metadata, assets] = api.save.mock.calls[0];
  expect(metadata.id).not.toBe(saved.id);
  expect(metadata.settings[""]).toBe("[00:00] [C]");
  expect(assets.map((a: { name: string }) => a.name)).toEqual(["source.flac", "guitar.flac"]);
  expect(metadata.audio.map((a: { file: string; codec: string; bytes: number }) => [a.file, a.codec, a.bytes])).toEqual([
    ["source.flac", "flac", 4],
    ["guitar.flac", "flac", 4],
  ]);
  expect(metadata.audio[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(codec.encodeTrack).toHaveBeenCalledTimes(2);
  expect(useSong.getState().source?.libraryId).toBe(metadata.id);
  expect(getSetting(performanceKey(useSong.getState().source), "")).toBe("[00:00] [C]");
});

it("plays every playlist entry including repeats, persists outgoing settings, and stops at the end", async () => {
  const second = { ...saved, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", title: "Second song", settings: { ":bpm": "130" } };
  api.index.mockResolvedValue({ ...emptyLibrary(), songs: [saved, second] });
  const queue = [saved.id, second.id, saved.id];
  await useSongLibrary.getState().playPlaylist(queue);
  expect(useSongLibrary.getState().playlistPlaying).toBe(true);
  expect(useSongLibrary.getState().position).toBe(0);
  setSetting(performanceKey(useSong.getState().source), "", "[00:02] Changed words");
  await useSongLibrary.getState().advancePlaylist();
  expect(api.updateSettings).toHaveBeenCalledWith(saved.id, expect.objectContaining({ "": "[00:02] Changed words" }));
  expect(useSong.getState().source?.libraryId).toBe(second.id);
  expect(getSetting(performanceKey(useSong.getState().source), ":bpm")).toBe("130");
  await useSongLibrary.getState().advancePlaylist();
  expect(useSong.getState().source?.libraryId).toBe(saved.id);
  expect(useSongLibrary.getState().position).toBe(2);
  await useSongLibrary.getState().advancePlaylist();
  expect(useSongLibrary.getState().playlistPlaying).toBe(false);
  expect(useSongLibrary.getState().notice).toBe("Playlist finished.");
});

it("cancels autoplay when Stop is pressed during an audio load", async () => {
  await useSongLibrary.getState().load(saved.id);
  const previous = useSong.getState().source;
  let resolve!: (value: Response) => void;
  fetchFile.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const loading = useSongLibrary.getState().playPlaylist([saved.id, saved.id], 1);
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  useSongLibrary.getState().pausePlaylist();
  resolve(file());
  await loading;
  expect(useSong.getState().source).toBe(previous);
  expect(useSongLibrary.getState().playlistPlaying).toBe(false);
  expect(useSongLibrary.getState().position).toBe(0);
});

it("stops the playlist on missing audio instead of silently skipping songs", async () => {
  await useSongLibrary.getState().playPlaylist([saved.id, saved.id]);
  fetchFile.mockRejectedValueOnce(new Error("Missing audio"));
  await useSongLibrary.getState().advancePlaylist();
  expect(useSongLibrary.getState().playlistPlaying).toBe(false);
  expect(useSongLibrary.getState().error).toBe("Missing audio");
  expect(useSongLibrary.getState().position).toBe(0);
});

it("keeps lyrics and key updates that finish during the first audio save", async () => {
  const source = { name: "draft.wav", audio };
  useSong.setState({ source, stems: null });
  let finish!: () => void;
  api.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const saving = useSongLibrary.getState().save("Demo", "");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  setSetting(performanceKey(source), ":lyrics", "[00:00] Finished during save");
  setSetting(performanceKey(source), ":options", JSON.stringify({ songKey: "D minor" }));
  finish();
  await saving;
  const key = performanceKey(useSong.getState().source);
  expect(getSetting(key, ":lyrics")).toBe("[00:00] Finished during save");
  expect(JSON.parse(getSetting(key, ":options")).songKey).toBe("D minor");
  expect(api.updateSettings).toHaveBeenCalledWith(useSong.getState().source?.libraryId, expect.objectContaining({ ":lyrics": "[00:00] Finished during save" }));
});

it("flushes current saved-song edits before exporting, reports progress, and cleans up the listener", async () => {
  const source = { name: saved.sourceName, audio, libraryId: saved.id };
  useSong.setState({ source });
  setSetting(performanceKey(source), ":lyrics", "[00:00] Latest lyrics");
  const unsubscribe = vi.fn();
  api.onTransferProgress.mockImplementationOnce((callback) => {
    callback({ phase: "Checking files", completed: 1, total: 4 });
    return unsubscribe;
  });
  api.exportBackup.mockResolvedValueOnce({ songs: 1, playlists: 2, fileName: "demo.tar.gz" });
  await useSongLibrary.getState().exportBackup();
  expect(api.updateSettings).toHaveBeenCalledWith(saved.id, expect.objectContaining({ ":lyrics": "[00:00] Latest lyrics" }));
  expect(api.exportBackup).toHaveBeenCalledTimes(1);
  expect(unsubscribe).toHaveBeenCalled();
  expect(useSongLibrary.getState()).toMatchObject({ busy: false, transfer: "", notice: "Exported 1 songs and 2 playlists to demo.tar.gz." });
});
it("treats a cancelled backup picker as cancellation and preserves the library", async () => {
  const index = { ...emptyLibrary(), songs: [saved] };
  useSongLibrary.setState({ index });
  await useSongLibrary.getState().restoreBackup();
  expect(useSongLibrary.getState().index).toBe(index);
  expect(useSongLibrary.getState().notice).toBe("Backup restore cancelled.");
  expect(useSongLibrary.getState().error).toBe("");
});
it("refreshes restored copies without loading a song or arming MIDI, and reports failures without clearing the index", async () => {
  api.inspectBackup.mockResolvedValue({ fileName: "demo.tar.gz", songs: 1, playlists: 1, duplicates: 0 });
  api.restoreBackup.mockResolvedValueOnce({ songs: 1, playlists: 1, fileName: "demo.tar.gz" });
  await useSongLibrary.getState().restoreBackup();
  expect(api.restoreBackup).toHaveBeenCalledWith("copy");
  expect(useSongLibrary.getState()).toMatchObject({ index: { songs: [saved] }, queue: [], midiSession: null, playlistPlaying: false });
  expect(useSong.getState().source).toBeNull();
  const index = useSongLibrary.getState().index;
  api.restoreBackup.mockRejectedValueOnce(new Error("Checksum mismatch"));
  await useSongLibrary.getState().restoreBackup();
  expect(useSongLibrary.getState().index).toBe(index);
  expect(useSongLibrary.getState()).toMatchObject({ error: "Checksum mismatch", busy: false, transfer: "" });
});

it("refuses a saved track whose file size or decoded shape does not match the library", async () => {
  fetchFile.mockResolvedValueOnce(file(3));
  await useSongLibrary.getState().load(saved.id);
  expect(useSongLibrary.getState().error).toBe("Missing or damaged source audio.");
  expect(useSong.getState().source).toBeNull();
  codec.decodeTrack.mockResolvedValueOnce({ sampleRate: 44100, channels: [new Float32Array(2)] });
  await useSongLibrary.getState().load(saved.id);
  expect(useSongLibrary.getState().error).toMatch(/Missing or damaged/);
  expect(useSong.getState().source).toBeNull();
});
it("reports a clear error for a song that is still being converted", async () => {
  api.audioUrls.mockRejectedValueOnce(new Error("This song is still being converted to the compact library format. Try again in a moment."));
  await useSongLibrary.getState().load(saved.id);
  expect(useSongLibrary.getState().error).toContain("still being converted");
  expect(fetchFile).not.toHaveBeenCalled();
});
it("asks before restoring when the backup holds songs that are already saved, and restores with the chosen mode", async () => {
  const preview = { fileName: "demo.tar.gz", songs: 3, playlists: 1, duplicates: 2 };
  api.inspectBackup.mockResolvedValue(preview);
  await useSongLibrary.getState().restoreBackup();
  expect(useSongLibrary.getState().backupPreview).toEqual(preview);
  expect(api.restoreBackup).not.toHaveBeenCalled();
  api.restoreBackup.mockResolvedValueOnce({ songs: 1, playlists: 0, skipped: 2, fileName: "demo.tar.gz" });
  await useSongLibrary.getState().finishRestore("skip");
  expect(api.restoreBackup).toHaveBeenCalledWith("skip");
  expect(useSongLibrary.getState()).toMatchObject({ backupPreview: null, notice: expect.stringContaining("Skipped 2 songs") });
});
it("cancelling the duplicate prompt restores nothing", async () => {
  api.inspectBackup.mockResolvedValue({ fileName: "demo.tar.gz", songs: 1, playlists: 0, duplicates: 1 });
  await useSongLibrary.getState().restoreBackup();
  await useSongLibrary.getState().finishRestore(null);
  expect(api.restoreBackup).not.toHaveBeenCalled();
  expect(useSongLibrary.getState()).toMatchObject({ backupPreview: null, notice: "Backup restore cancelled." });
});
