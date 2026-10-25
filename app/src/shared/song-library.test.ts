import { describe, expect, it } from "vitest";
import {
  flacName,
  isTrackFileName,
  trackKey,
  upgradeIndex,
  userFileName,
  validateSong,
  type LibraryAudio,
  type LibrarySong,
  type SongLibrary,
} from "./song-library";

const ID = "11111111-2222-3333-4444-555555555555";
const HASH = "a".repeat(64);

/** A saved track as v2 wrote it: a FLAC file with a digest, and no per-track settings. */
function flacTrack(name: string, frames = 44100): LibraryAudio {
  return { name, sampleRate: 44100, frames, channels: 2, file: flacName(name), codec: "flac", bytes: 1000, sha256: HASH };
}

function song(audio: LibraryAudio[]): LibrarySong {
  return { id: ID, title: "Song", artist: "", sourceName: "song.wav", duration: 1, audio, settings: {}, updated: "2026-01-01T00:00:00.000Z" };
}

const legacySix = () => ["source", "drums", "bass", "other", "vocals", "guitar", "piano"].map((name) => flacTrack(name));

describe("v2 to v3 migration", () => {
  it("writes the kind of each saved track and keeps every file, name and digest", () => {
    const v2: SongLibrary = { version: 2, songs: [song(legacySix())], playlists: [] };
    const v3 = upgradeIndex(v2);
    expect(v3.version).toBe(3);
    const before = v2.songs[0].audio;
    const after = v3.songs[0].audio;
    expect(after.map((t) => t.name)).toEqual(before.map((t) => t.name));
    expect(after.map((t) => t.file)).toEqual(before.map((t) => t.file));
    expect(after.map((t) => [t.bytes, t.sha256, t.frames, t.sampleRate, t.channels])).toEqual(before.map((t) => [t.bytes, t.sha256, t.frames, t.sampleRate, t.channels]));
    expect(after.map((t) => t.kind)).toEqual(["source", "stem", "stem", "stem", "stem", "stem", "stem"]);
  });

  it("adds no colour, bus, pitch or mute setting that was not saved", () => {
    const [upgraded] = upgradeIndex({ version: 2, songs: [song([flacTrack("source"), flacTrack("vocals")])], playlists: [] }).songs[0].audio.slice(1);
    expect(upgraded).not.toHaveProperty("color");
    expect(upgraded).not.toHaveProperty("bus");
    expect(upgraded).not.toHaveProperty("transpose");
    expect(upgraded).not.toHaveProperty("muteGroups");
  });

  it("leaves a v3 index as it is", () => {
    const index: SongLibrary = { version: 3, songs: [song([flacTrack("source")])], playlists: [] };
    expect(upgradeIndex(index)).toBe(index);
  });

  it("reads a legacy save without a kind as a stem, and still validates it", () => {
    const legacy = song(legacySix());
    expect(() => validateSong(upgradeIndex({ version: 2, songs: [legacy], playlists: [] }).songs[0])).not.toThrow();
    expect(() => validateSong(legacy)).not.toThrow();
  });

  it("gives a v1 raw track no file, so its key is its name", () => {
    const raw: LibraryAudio = { name: "drums", sampleRate: 44100, frames: 10, channels: 2 };
    expect(trackKey(raw)).toBe("drums");
    expect(trackKey(flacTrack("drums"))).toBe("drums");
  });
});

describe("track keys and file names", () => {
  it("keys an imported track by its fixed file name, not its label", () => {
    const imported: LibraryAudio = { ...flacTrack("Keys L"), name: "Keys L", kind: "user", file: userFileName(3) };
    expect(trackKey(imported)).toBe("track3");
  });

  it("accepts the legacy names and track0 to track31, and nothing else", () => {
    expect(isTrackFileName("drums.flac")).toBe(true);
    expect(isTrackFileName("track0.flac")).toBe(true);
    expect(isTrackFileName("track31.flac")).toBe(true);
    expect(isTrackFileName("track32.flac")).toBe(false);
    expect(isTrackFileName("../track1.flac")).toBe(false);
    expect(isTrackFileName("unknown.flac")).toBe(false);
  });
});

describe("validateSong with imported tracks", () => {
  const imported = (index: number, extra: Partial<LibraryAudio> = {}): LibraryAudio => ({
    ...flacTrack(`Track ${index}`),
    kind: "user",
    file: userFileName(index),
    ...extra,
  });

  it("accepts a song with a mixdown source and imported tracks with settings", () => {
    const audio = [flacTrack("source"), imported(0, { color: "#3b82f6", bus: "click", transpose: false, gain: 0.8, pan: -0.3, muteGroups: [1, 2] })];
    expect(() => validateSong(song(audio))).not.toThrow();
  });

  it("accepts two imported tracks with the same label", () => {
    const audio = [flacTrack("source"), imported(0, { name: "Click" }), imported(1, { name: "Click" })];
    expect(() => validateSong(song(audio))).not.toThrow();
  });

  it("refuses an imported track whose file is not a track file", () => {
    const audio = [flacTrack("source"), imported(0, { file: "../escape.flac" })];
    expect(() => validateSong(song(audio))).toThrow("Invalid song audio file.");
  });

  it("refuses more than 32 imported tracks", () => {
    const tracks = Array.from({ length: 33 }, (_, i) => imported(i));
    expect(() => validateSong(song([flacTrack("source"), ...tracks.slice(0, 32)]))).not.toThrow();
    expect(() => validateSong(song([flacTrack("source"), ...tracks]))).toThrow("Invalid song tracks.");
  });

  it("refuses a bus, colour, volume, pan or mute group out of range", () => {
    const bad: Partial<LibraryAudio>[] = [
      { bus: "aux9" as LibraryAudio["bus"] },
      { color: "blue" },
      { gain: 3 },
      { pan: 1.5 },
      { muteGroups: [7] },
      { muteGroups: [1, 1] },
    ];
    for (const extra of bad) expect(() => validateSong(song([flacTrack("source"), imported(0, extra)]))).toThrow();
  });

  it("refuses a song whose keys collide", () => {
    expect(() => validateSong(song([flacTrack("source"), imported(0), imported(0)]))).toThrow("Invalid song tracks.");
  });
});
