// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { SongLibraryStore } from "../src/main/ipc/song-library-store";
import { decodeFlac, encodeFlac } from "@shared/flac";
import { trackKey, type LibrarySong } from "@shared/song-library";
import { DEFAULT_BAND_SETTINGS } from "@/song/band/arrangement";
import { fixedBeatGrid } from "@/song/band/beat-grid";
import { DRUM_PITCHES } from "@/song/band/note";
import { runBandJob, type BandRequest } from "@/song/band/band-job";
import type { SampleSet } from "@/song/band/samples";
import { DEFAULT_SET_UPGRADE } from "@/song/performance/set-upgrade";
import { resetStageActivity, useStageActivity } from "@/state/stage-activity";

const mocks = vi.hoisted(() => ({ index: vi.fn(), save: vi.fn(), load: vi.fn(), render: vi.fn(), accept: vi.fn(), read: vi.fn() }));
vi.mock("@/host", () => ({ host: { song: { library: { index: mocks.index, save: mocks.save } }, tones: { readLocalNam: mocks.read } } }));
vi.mock("@/song/library", () => ({ loadSongAudio: mocks.load, acceptUpgradedSong: mocks.accept }));
vi.mock("@/song/codec/flac-client", () => ({ encodeTrack: encodeFlac }));
vi.mock("@/song/band/band-client", () => ({ startBandRender: mocks.render, bandSampleUrls: () => ({}) }));
vi.mock("@/song/band/bass-chain", () => ({ renderPartChain: vi.fn() }));
vi.mock("@/state/session-log", () => ({ sessionLog: vi.fn() }));
const { upgradeSavedSong } = await import("@/song/performance/run-set-upgrade");
let root: string, copy: string, store: SongLibraryStore, original: SongLibraryStore;
const pcm = { sampleRate: 44100, channels: [new Float32Array(44100 * 8).fill(0.1)] };
const sample = { sampleRate: 44100, channels: [new Float32Array(4410).fill(0.1)] };
const samples: SampleSet = {
  drums: new Map(DRUM_PITCHES.map((pitch) => [pitch, [{ velocity: [1, 127], nominal: 100, transpose: 0, takes: [sample] }]])),
  bass: [36, 48, 60].map((root) => ({ root, layer: "p", velocity: [1, 127], audio: sample })),
};
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function fileBytes(storeRoot: string, id: string, file: string) {
  const index = JSON.parse(await readFile(join(storeRoot, "library.json"), "utf8"));
  return readFile(join(storeRoot, index.revisions[id], file));
}
async function add(engine: number, patch: Record<string, unknown> = {}) {
  const bytes = await encodeFlac(pcm);
  const song: LibrarySong = {
    id: randomUUID(),
    title: `Engine ${engine}`,
    artist: "Fixture",
    key: "C major",
    sourceName: "Fixture.wav",
    duration: 8,
    updated: "2026-11-14T00:00:00.000Z",
    audio: [
      { name: "source", kind: "source", file: "source.flac" },
      { name: "Drums (generated)", kind: "user", file: "track0.flac" },
      { name: "Bass (generated)", kind: "user", file: "track1.flac" },
    ].map(
      (entry) =>
        ({ ...entry, codec: "flac", bytes: bytes.length, sha256: sha(bytes), sampleRate: 44100, frames: 352800, channels: 1 }) as LibrarySong["audio"][number],
    ),
    settings: {
      "": "[0:00] [C] {midi:cc 16 0 1} {midi:pc 16 3}",
      ":bpm": "120",
      ":options": JSON.stringify({
        band: { ...DEFAULT_BAND_SETTINGS, engine, bassOverrides: [{ start: 0, end: 0.5, pc: 0 }], marks: [{ time: 2, kind: "stop", beats: 1 }], ...patch },
        beatGrid: fixedBeatGrid(120, 0, 4, 8),
        generatedParts: { drums: "track0", bass: "track1" },
        untouched: "keep me",
      }),
    },
  };
  const token = await original.begin(song);
  for (const track of song.audio) await original.write(token, track.file!, bytes);
  await original.commit(token);
  return song.id;
}
async function copyLibrary() {
  await cp(root, copy, { recursive: true });
  store = new SongLibraryStore(copy);
}
beforeEach(async () => {
  vi.clearAllMocks();
  resetStageActivity();
  root = await mkdtemp(join(tmpdir(), "vltn-upgrade-original-fixture-"));
  copy = root + "-copy";
  original = new SongLibraryStore(root);
  mocks.index.mockImplementation(() => store.index());
  mocks.save.mockImplementation(async (song, assets) => {
    const token = await store.begin(song);
    try {
      for (const asset of assets) await store.write(token, asset.name, asset.bytes);
      await store.commit(token);
    } catch (error) {
      await store.abort(token);
      throw error;
    }
  });
  mocks.load.mockImplementation(async (id) => {
    const song = (await store.index()).songs.find((song) => song.id === id)!;
    const tracks = await Promise.all(song.audio.map(async (track) => [trackKey(track), await decodeFlac(await fileBytes(copy, id, track.file!))] as const));
    const all = Object.fromEntries(tracks);
    return { source: all.source, stems: Object.fromEntries(tracks.filter(([key]) => key !== "source")) };
  });
  mocks.render.mockImplementation((request: BandRequest) => ({ done: Promise.resolve(runBandJob(request, samples)), onProgress: vi.fn(), cancel: vi.fn() }));
});
afterEach(async () => {
  resetStageActivity();
  await rm(root, { recursive: true, force: true });
  await rm(copy, { recursive: true, force: true });
});
it("updates engines 1/2 on a copied library, skips engine 3 and missing tones, and preserves original audio and musical edits", async () => {
  const ids = [
    await add(1),
    await add(2),
    await add(3),
    await add(1, {
      bassTone: {
        kind: "chain",
        blocks: [{ type: "capture", role: "amp", on: true, inputDb: 0, outputDb: 0, mix: 1, file: { source: "file", path: "/missing.nam", name: "Lost" } }],
        fast: false,
        dryWet: 1,
      },
    }),
  ];
  const baseline = await readFile(join(root, "library.json"));
  await copyLibrary();
  const before = await store.index();
  mocks.read.mockRejectedValue(new Error("missing"));
  for (const [index, id] of ids.entries()) {
    const song = before.songs.find((song) => song.id === id)!;
    const result = await upgradeSavedSong(song, DEFAULT_SET_UPGRADE, [], []);
    expect(result.band).toBe(
      index < 2
        ? "Done"
        : index === 2
          ? "Skipped: Already current"
          : "Skipped: Not updated: the bass tone's amp capture is missing. Download it or switch to Clean, then Generate.",
    );
    const after = (await store.index()).songs.find((song) => song.id === id)!;
    if (index >= 2) expect(after).toEqual(song);
    else {
      const saved = JSON.parse(after.settings[":options"]);
      const previous = JSON.parse(song.settings[":options"]);
      expect(saved.band.engine).toBe(3);
      expect(saved.band.bassOverrides).toEqual(previous.band.bassOverrides);
      expect(saved.band.marks).toEqual(previous.band.marks);
      expect(saved.untouched).toBe("keep me");
      expect(after.settings[""]).toBe(song.settings[""]);
      expect(await fileBytes(copy, id, "source.flac")).toEqual(await fileBytes(root, id, "source.flac"));
    }
  }
  expect(mocks.render).toHaveBeenCalledTimes(2);
  expect(await readFile(join(root, "library.json"))).toEqual(baseline);
});
it("keeps owned rendered audio intact and renders clean bass Warm once, including cue names", async () => {
  const id = await add(2, { rendered: { drums: { name: "My own drums", importedAt: "today" } } });
  await copyLibrary();
  const song = (await store.index()).songs[0];
  const names = Array.from({ length: 256 }, (_, index) => `Preset ${index}`);
  await upgradeSavedSong(
    song,
    { ...DEFAULT_SET_UPGRADE, warmBass: true, nameCues: true },
    [{ names: { model: "gp180", names, source: "cached" }, channel: 16 }],
    [],
  );
  const after = (await store.index()).songs[0];
  expect(await fileBytes(copy, id, "track0.flac")).toEqual(await fileBytes(root, id, "track0.flac"));
  expect(JSON.parse(after.settings[":options"]).band.rendered.drums.name).toBe("My own drums");
  expect(JSON.parse(after.settings[":options"]).band.bassTone).toEqual({ kind: "builtin", id: "warm" });
  expect(after.settings[""]).toContain("GP-180: 132 Preset 131");
  expect(mocks.render).toHaveBeenCalledTimes(1);
});
it("a rejected save leaves both the saved song and live settings exactly unchanged", async () => {
  await add(1);
  await copyLibrary();
  const song = (await store.index()).songs[0];
  const before = await readFile(join(copy, "library.json"));
  mocks.save.mockRejectedValueOnce(new Error("Disk full"));
  await expect(upgradeSavedSong(song, DEFAULT_SET_UPGRADE, [], [])).rejects.toThrow("Disk full");
  expect(await readFile(join(copy, "library.json"))).toEqual(before);
  expect(mocks.accept).not.toHaveBeenCalled();
});
it("playback starting during render refuses the commit", async () => {
  await add(1);
  await copyLibrary();
  const song = (await store.index()).songs[0];
  mocks.render.mockImplementation((request) => {
    useStageActivity.setState({ busy: true });
    return { done: Promise.resolve(runBandJob(request, samples)), onProgress: vi.fn(), cancel: vi.fn() };
  });
  await expect(upgradeSavedSong(song, DEFAULT_SET_UPGRADE, [], [])).rejects.toThrow("Stop playback");
  expect(mocks.save).not.toHaveBeenCalled();
  expect((await store.index()).songs[0]).toEqual(song);
});

it("preserves a chosen extended ending and saves the complete generated tail", async () => {
  await add(1, { ending: { kind: "hold" } });
  await copyLibrary();
  const song = (await store.index()).songs[0];
  const result = await upgradeSavedSong(song, DEFAULT_SET_UPGRADE, [], []);
  expect(result.save).toBe("Done");
  const saved = (await store.index()).songs[0];
  expect(JSON.parse(saved.settings[":options"]).band.ending).toEqual({ kind: "hold" });
  expect(saved.audio.find((track) => track.file === "track0.flac")!.frames).toBeGreaterThan(352800);
});
