import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LYRICS_CHOICE,
  findLyricsQuality,
  loadLyricsChoice,
  lyricsOptions,
  recordLyricsMade,
  runtimeFor,
  saveLyricsChoice,
  wasmThreads,
} from "./lyrics-options";
import { clearSettingsCache } from "./settings";

beforeEach(() => {
  localStorage.clear();
  clearSettingsCache();
});

describe("lyrics choice", () => {
  it("starts from the defaults and remembers what was saved", () => {
    expect(loadLyricsChoice()).toEqual({ model: "small", quality: "fast" });
    saveLyricsChoice({ model: "turbo", quality: "max" });
    expect(loadLyricsChoice()).toEqual({ model: "turbo", quality: "max" });
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("gp5.song.lyrics.v1", "{not json");
    expect(loadLyricsChoice()).toEqual(DEFAULT_LYRICS_CHOICE);
  });

  it("falls back per field when a model was removed or the stored value is the old shape", () => {
    localStorage.setItem("gp5.song.lyrics.v1", JSON.stringify({ model: "distil-en", quality: "balanced" }));
    expect(loadLyricsChoice()).toEqual({ model: "small", quality: "balanced" });
    localStorage.setItem("gp5.song.lyrics.v1", JSON.stringify({ language: "english" }));
    expect(loadLyricsChoice()).toEqual(DEFAULT_LYRICS_CHOICE);
  });
});

describe("lyricsOptions", () => {
  it("combines the remembered choice with the song's own language", () => {
    saveLyricsChoice({ model: "base", quality: "balanced" });
    localStorage.setItem("song:options", JSON.stringify({ lyricsLanguage: "dutch", shift: 2 }));
    expect(lyricsOptions("song")).toEqual({ model: "base", quality: "balanced", language: "dutch" });
  });

  it("uses automatic language for unknown or corrupt song options", () => {
    localStorage.setItem("song:options", JSON.stringify({ lyricsLanguage: "klingon" }));
    expect(lyricsOptions("song").language).toBe("auto");
    localStorage.setItem("song:options", "{bad");
    expect(lyricsOptions("song").language).toBe("auto");
  });
});

describe("quality, device and threads", () => {
  it("maps each quality to a beam width", () => {
    expect(findLyricsQuality("fast")?.beams).toBe(1);
    expect(findLyricsQuality("balanced")?.beams).toBe(3);
    expect(findLyricsQuality("max")?.beams).toBe(5);
    expect(findLyricsQuality("turbo")).toBeUndefined();
  });

  it("uses WebGPU with fp16 files when available, otherwise WASM with q8", () => {
    expect(runtimeFor(true)).toEqual({ device: "webgpu", dtype: "fp16" });
    expect(runtimeFor(false)).toEqual({ device: "wasm", dtype: "q8" });
  });

  it("uses more WASM threads only when cross-origin isolated, capped at four", () => {
    expect(wasmThreads(false, 12)).toBe(1);
    expect(wasmThreads(true, 12)).toBe(4);
    expect(wasmThreads(true, 2)).toBe(2);
    expect(wasmThreads(true, 0)).toBe(1);
  });
});

describe("recordLyricsMade", () => {
  it("records what made the lyrics and keeps the song's other options", () => {
    localStorage.setItem("song:options", JSON.stringify({ shift: 3 }));
    recordLyricsMade("song", { model: "small", quality: "max", language: "auto" });
    const stored = JSON.parse(localStorage.getItem("song:options")!);
    expect(stored.shift).toBe(3);
    expect(stored.lyricsMade).toMatchObject({ model: "small", quality: "max", language: "auto" });
    expect(Number.isNaN(Date.parse(stored.lyricsMade.at))).toBe(false);
  });
});
