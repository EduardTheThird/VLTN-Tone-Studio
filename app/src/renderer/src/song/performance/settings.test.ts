import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  SETTINGS_DEBOUNCE_MS,
  clearSettingsCache,
  flushSettings,
  getSetting,
  migrateLocalSettings,
  readSettings,
  seedSettings,
  setSetting,
  writeSettings,
} from "./settings";

const api = vi.hoisted(() => ({ updateSettings: vi.fn() }));
vi.mock("@/host", () => ({ host: { song: { library: api } } }));
const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  key = `vltn.song:${id}`;
const localKeys = () => Object.keys(localStorage).filter((k) => k.startsWith("vltn.song:"));
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  api.updateSettings.mockResolvedValue(undefined);
  localStorage.clear();
  clearSettingsCache();
});
afterEach(() => vi.useRealTimers());

it("keeps a saved song's edits out of localStorage, sends one patch after typing stops, and reads them back after a restart", async () => {
  seedSettings(id, { ":bpm": "100" });
  setSetting(key, ":lyrics", "[00:00] a");
  await vi.advanceTimersByTimeAsync(SETTINGS_DEBOUNCE_MS - 100);
  setSetting(key, ":lyrics", "[00:00] ab");
  await vi.advanceTimersByTimeAsync(SETTINGS_DEBOUNCE_MS - 100);
  expect(api.updateSettings).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(100);
  expect(api.updateSettings).toHaveBeenCalledTimes(1);
  expect(api.updateSettings).toHaveBeenCalledWith(id, { ":lyrics": "[00:00] ab" });
  expect(localKeys()).toEqual([]);
  // A restart empties the cache; loading the song fills it again from the library.
  clearSettingsCache();
  expect(getSetting(key, ":lyrics")).toBe("");
  seedSettings(id, { ":bpm": "100", ":lyrics": "[00:00] ab" });
  expect(readSettings(key)).toEqual({ "": "", ":bpm": "100", ":lyrics": "[00:00] ab", ":options": "" });
});

it("flushes pending edits at once and keeps them when the library write fails", async () => {
  setSetting(key, ":bpm", "90");
  api.updateSettings.mockRejectedValueOnce(new Error("disk full"));
  await expect(flushSettings()).rejects.toThrow("disk full");
  api.updateSettings.mockClear();
  await flushSettings();
  expect(api.updateSettings).toHaveBeenCalledWith(id, { ":bpm": "90" });
  api.updateSettings.mockClear();
  await flushSettings();
  expect(api.updateSettings).not.toHaveBeenCalled();
});

it("does not send values that did not change", async () => {
  seedSettings(id, { ":bpm": "100" });
  writeSettings(key, { ":bpm": "100" });
  await flushSettings();
  expect(api.updateSettings).not.toHaveBeenCalled();
});

it("keeps an unsaved song's settings in localStorage", async () => {
  setSetting("vltn.performance.v1:demo.wav:10:44100", ":bpm", "88");
  expect(localStorage.getItem("vltn.performance.v1:demo.wav:10:44100:bpm")).toBe("88");
  await vi.advanceTimersByTimeAsync(SETTINGS_DEBOUNCE_MS * 2);
  expect(api.updateSettings).not.toHaveBeenCalled();
});

it("moves localStorage copies into the library once and removes the keys, including those of deleted songs", async () => {
  const gone = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  localStorage.setItem(key, "[00:00] [C] newer chart");
  localStorage.setItem(key + ":bpm", "100");
  localStorage.setItem(key + ":options", "");
  localStorage.setItem(`vltn.song:${gone}:bpm`, "70");
  localStorage.setItem("vltn.performance.metronome", "true");
  const song = { id, settings: { "": "old chart", ":bpm": "100" } };
  await migrateLocalSettings([song]);
  expect(api.updateSettings).toHaveBeenCalledTimes(1);
  expect(api.updateSettings).toHaveBeenCalledWith(id, { "": "[00:00] [C] newer chart" });
  expect(localKeys()).toEqual([]);
  expect(localStorage.getItem("vltn.performance.metronome")).toBe("true");
  api.updateSettings.mockClear();
  await migrateLocalSettings([song]);
  expect(api.updateSettings).not.toHaveBeenCalled();
});

it("leaves the localStorage copies in place when the library cannot take them", async () => {
  localStorage.setItem(key + ":bpm", "100");
  api.updateSettings.mockRejectedValueOnce(new Error("offline"));
  await expect(migrateLocalSettings([{ id, settings: {} }])).rejects.toThrow("offline");
  expect(localStorage.getItem(key + ":bpm")).toBe("100");
});
