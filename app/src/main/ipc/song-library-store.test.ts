// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { decodeFlac, quantize } from "@shared/flac";
import { isLegacySong } from "@shared/song-library";
import { SongLibraryStore, libraryFilePath } from "./song-library-store";
import { flacSong, legacySong, readSaved, saveFlacSong, writeLegacyLibrary, type FixtureSong } from "./song-library-fixtures";

let root: string, store: SongLibraryStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vltn-song-library-test-"));
  store = new SongLibraryStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
/** The decoded track must equal the stored float32 audio quantized to 24 bits. */
async function expectAudio(fixture: FixtureSong, name: string) {
  const decoded = await decodeFlac(await readSaved(root, fixture.song.id, `${name}.flac`));
  expect(decoded.channels).toHaveLength(fixture.audio[name].length);
  decoded.channels.forEach((channel, c) => {
    expect(Array.from(channel.map((v) => Math.round(v * (2 ** 23 - 1))))).toEqual(Array.from(fixture.audio[name][c].map(quantize)));
  });
}
it("round-trips audio, charts and duplicate playlist entries across restart", async () => {
  const first = await flacSong(1),
    second = await flacSong(2);
  await saveFlacSong(store, first);
  await saveFlacSong(store, second);
  const playlist = { id: randomUUID(), name: "Gig", songs: [second.song.id, first.song.id, second.song.id] };
  await store.playlists([playlist]);
  store = new SongLibraryStore(root);
  expect((await store.index()).playlists).toEqual([playlist]);
  expect((await store.index()).songs[0]).toEqual(first.song);
  await expectAudio(first, "source");
  await expectAudio(first, "guitar");
  await store.updateSettings(first.song.id, { ":bpm": "90" });
  expect((await new SongLibraryStore(root).index()).songs[0].settings).toEqual({ ...first.song.settings, ":bpm": "90" });
});
it("writes a v2 index and hands out protocol URLs instead of audio bytes", async () => {
  const fixture = await flacSong();
  await saveFlacSong(store, fixture);
  const index = JSON.parse(await readFile(join(root, "library.json"), "utf8"));
  expect(index.version).toBe(2);
  const urls = await store.audioUrls(fixture.song.id);
  expect(Object.keys(urls).sort()).toEqual(["guitar", "source"]);
  expect(urls.source).toBe(`app://library/${index.revisions[fixture.song.id]}/source.flac`);
  expect(libraryFilePath(root, urls.source)).toBe(join(root, index.revisions[fixture.song.id], "source.flac"));
});
it("keeps the last complete revision after an incomplete replacement", async () => {
  const original = await flacSong();
  await saveFlacSong(store, original);
  const token = await store.begin({ ...original.song, title: "Replacement" });
  await expect(store.commit(token)).rejects.toThrow();
  await store.abort(token);
  expect((await store.index()).songs[0].title).toBe(original.song.title);
  await expectAudio(original, "source");
});
it("rejects path traversal, wrong lengths, wrong digests, raw PCM saves and dangling playlist references", async () => {
  const { song, files } = await flacSong(),
    token = await store.begin(song);
  await expect(store.write(token, "../escape", files["source.flac"])).rejects.toThrow();
  await expect(store.write(token, "source-0.f32", files["source.flac"])).rejects.toThrow();
  await expect(store.write(token, "source.flac", new Uint8Array(3))).rejects.toThrow();
  await expect(
    store.write(
      token,
      "source.flac",
      files["source.flac"].map((b) => b ^ 1),
    ),
  ).rejects.toThrow();
  await expect(store.begin({ ...song, id: "../escape" })).rejects.toThrow();
  await expect(store.begin(legacySong().song)).rejects.toThrow();
  await expect(store.begin({ ...song, audio: [{ ...song.audio[0], file: "../x.flac" }] })).rejects.toThrow();
  await expect(store.playlists([{ id: randomUUID(), name: "Missing", songs: [song.id] }])).rejects.toThrow();
  await store.abort(token);
});
it("serves only exact revision/track.flac URLs", () => {
  const rev = randomUUID();
  expect(libraryFilePath(root, `app://library/${rev}/vocals.flac`)).toBe(join(root, rev, "vocals.flac"));
  for (const bad of [
    `app://library/${rev}/..%2Flibrary.json`,
    `app://library/${rev}/vocals-0.f32`,
    `app://library/${rev}/other.flac/extra`,
    `app://library/${rev}/notatrack.flac`,
    `app://library/not-a-uuid/vocals.flac`,
    `app://bundle/${rev}/vocals.flac`,
  ])
    expect(libraryFilePath(root, bad)).toBeNull();
});
it("deletes a playlist without deleting songs and removes deleted songs from every playlist", async () => {
  const s = await flacSong();
  await saveFlacSong(store, s);
  await store.playlists([{ id: randomUUID(), name: "Set", songs: [s.song.id, s.song.id] }]);
  await store.playlists([]);
  expect((await store.index()).songs).toHaveLength(1);
  await store.playlists([{ id: randomUUID(), name: "Set", songs: [s.song.id, s.song.id] }]);
  await store.remove(s.song.id);
  expect((await store.index()).songs).toEqual([]);
  expect((await store.index()).playlists[0].songs).toEqual([]);
  await expect(store.audioUrls(s.song.id)).rejects.toThrow();
});

it("preflights saved files without loading them, deduplicates IDs and reports missing or truncated audio", async () => {
  const first = await flacSong(1),
    second = await flacSong(2);
  await saveFlacSong(store, first);
  await saveFlacSong(store, second);
  const index = JSON.parse(await readFile(join(root, "library.json"), "utf8"));
  await writeFile(join(root, index.revisions[first.song.id], "source.flac"), new Uint8Array(1));
  await rm(join(root, index.revisions[second.song.id], "source.flac"));
  const missing = randomUUID();
  const result = await store.preflight([first.song.id, second.song.id, first.song.id, missing]);
  expect(result).toHaveLength(3);
  expect(result[0].errors[0]).toContain("invalid size");
  expect(result[1].errors[0]).toContain("missing or inaccessible");
  expect(result[2].errors).toEqual(["Song is missing from the library."]);
  await expect(store.preflight(["../outside"])).rejects.toThrow("Invalid playlist");
});
it("returns a clean saved snapshot for intact audio", async () => {
  const s = await flacSong();
  await saveFlacSong(store, s);
  expect(await store.preflight([s.song.id])).toEqual([{ id: s.song.id, song: s.song, errors: [] }]);
});

it("migrates a v1 library to FLAC with the same audio and settings, then removes the v1 files", async () => {
  const first = legacySong(1),
    second = legacySong(2);
  await writeLegacyLibrary(root, [first, second]);
  const before = JSON.parse(await readFile(join(root, "library.json"), "utf8"));
  expect((await store.index()).songs.every(isLegacySong)).toBe(true);
  await expect(store.audioUrls(first.song.id)).rejects.toThrow(/converted/);
  const progress: string[] = [];
  expect(await store.migrate((p) => progress.push(`${p.phase} ${p.completed}/${p.total}`))).toEqual({ converted: 2, failed: 0 });
  expect(progress[0]).toBe("Converting saved songs 0/2");
  const index = await new SongLibraryStore(root).index();
  expect(index.version).toBe(2);
  for (const fixture of [first, second]) {
    const song = index.songs.find((s) => s.id === fixture.song.id)!;
    expect(isLegacySong(song)).toBe(false);
    expect(song.settings).toEqual(fixture.song.settings);
    expect(song.title).toBe(fixture.song.title);
    await expectAudio(fixture, "source");
    await expectAudio(fixture, "guitar");
    expect((await store.preflight([song.id]))[0].errors).toEqual([]);
  }
  for (const revision of Object.values(before.revisions) as string[]) expect(await readdir(root)).not.toContain(revision);
  expect(await store.migrate()).toEqual({ converted: 0, failed: 0 });
});
it("leaves a v1 song untouched when its audio is damaged and still converts the others", async () => {
  const bad = legacySong(1),
    good = legacySong(2);
  await writeLegacyLibrary(root, [bad, good]);
  const before = JSON.parse(await readFile(join(root, "library.json"), "utf8"));
  await writeFile(join(root, before.revisions[bad.song.id], "guitar-1.f32"), new Uint8Array(5));
  expect(await store.migrate()).toEqual({ converted: 1, failed: 1 });
  const index = await store.index();
  expect(isLegacySong(index.songs.find((s) => s.id === bad.song.id)!)).toBe(true);
  expect(isLegacySong(index.songs.find((s) => s.id === good.song.id)!)).toBe(false);
  expect(await readdir(root)).toContain(before.revisions[bad.song.id]);
  expect((await readdir(root)).filter((p) => p.length === 36)).toHaveLength(2);
});
it("keeps settings edited while a song is being converted", async () => {
  const fixture = legacySong();
  await writeLegacyLibrary(root, [fixture]);
  const running = store.migrate();
  await store.updateSettings(fixture.song.id, { ":bpm": "77" });
  await running;
  expect((await store.index()).songs[0].settings[":bpm"]).toBe("77");
});
it("sweeps only true orphans and expired save sessions", async () => {
  let clock = Date.now();
  store = new SongLibraryStore(root, () => clock);
  const kept = await flacSong(1);
  await saveFlacSong(store, kept);
  const revision = JSON.parse(await readFile(join(root, "library.json"), "utf8")).revisions[kept.song.id];
  const old = new Date(clock - 2 * 60 * 60 * 1000),
    orphan = join(root, randomUUID()),
    fresh = join(root, randomUUID()),
    stage = join(root, ".restore-" + randomUUID());
  for (const dir of [orphan, fresh, stage, join(root, revision)]) await mkdir(dir, { recursive: true });
  for (const dir of [orphan, stage, join(root, revision)]) await utimes(dir, old, old);
  // An abandoned save: begun, never committed.
  const abandoned = await flacSong(2),
    token = await store.begin(abandoned.song);
  clock += 2 * 60 * 60 * 1000;
  await utimes(join(root, token), old, old);
  await utimes(fresh, new Date(clock), new Date(clock));
  await store.sweep();
  const names = await readdir(root);
  expect(names).toContain(revision);
  expect(names).toContain(fresh.slice(root.length + 1));
  expect(names).not.toContain(orphan.slice(root.length + 1));
  expect(names).not.toContain(stage.slice(root.length + 1));
  expect(names).not.toContain(token);
  await expect(store.commit(token)).rejects.toThrow("Save session expired.");
});
it("keeps a save session that is still young", async () => {
  const clock = Date.now();
  store = new SongLibraryStore(root, () => clock);
  const fixture = await flacSong(1);
  const token = await store.begin(fixture.song);
  await store.sweep();
  expect(await readdir(root)).toContain(token);
});
it("merges a settings patch, removes emptied entries, and survives a restart", async () => {
  const fixture = await flacSong(1);
  await saveFlacSong(store, fixture);
  await store.updateSettings(fixture.song.id, { ":lyrics": "[00:01] New words", ":options": "" });
  await store.updateSettings(fixture.song.id, { ":bpm": "98" });
  const settings = (await new SongLibraryStore(root).index()).songs[0].settings;
  expect(settings).toEqual({ "": fixture.song.settings[""], ":lyrics": "[00:01] New words", ":bpm": "98" });
});
it("rejects settings patches for unknown songs, unknown keys and non-string values", async () => {
  const fixture = await flacSong(1);
  await saveFlacSong(store, fixture);
  await expect(store.updateSettings(randomUUID(), { ":bpm": "90" })).rejects.toThrow("Saved song not found.");
  await expect(store.updateSettings(fixture.song.id, { ":other": "x" })).rejects.toThrow("Invalid song settings.");
  await expect(store.updateSettings(fixture.song.id, { ":bpm": 90 as unknown as string })).rejects.toThrow("Invalid song settings.");
  await expect(store.updateSettings("../x", { ":bpm": "90" })).rejects.toThrow("Invalid song settings.");
});
