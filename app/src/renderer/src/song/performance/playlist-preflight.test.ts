import { expect, it } from "vitest";
import { playlistPreflight } from "./playlist-preflight";
import type { LibraryPreflightSong } from "@shared/song-library";
const config = { tempoOnStart: true, tempoChannel: 16, outputName: "GP-180", pedals: [{ name: "TimeLine", channel: 1 }] };
const saved: LibraryPreflightSong = {
  id: "one",
  errors: [],
  song: {
    id: "one",
    title: "Opening",
    artist: "",
    sourceName: "song",
    duration: 10,
    audio: [{ name: "source", sampleRate: 44100, frames: 441000, channels: 1 }],
    settings: { ":bpm": "120", "": "[00:01] {midi:pc 1 2}" },
    updated: "",
  },
};
it("preserves repeated entries and reports missing songs without changing cues", () => {
  const before = JSON.stringify(saved);
  const result = playlistPreflight(["one", "lost", "one"], [saved], config);
  expect(result.map((r) => r.entry)).toEqual([1, 2, 3]);
  expect(result[1].errors.length).toBe(1);
  expect(result[0].warnings).toEqual([]);
  expect(JSON.stringify(saved)).toBe(before);
});
it("reports malformed charts, incompatible BPM and conflicting clock settings per song", () => {
  const song = { ...saved.song!, settings: { ":bpm": "35", ":options": '{"clock":true}', "": "[00:00] {midi:pc 1}" } };
  const [result] = playlistPreflight(["one"], [{ ...saved, song }], config);
  expect(result.errors.join(" ")).toContain("40–300");
  expect(result.errors.join(" ")).toContain("Chart cannot play");
  expect(result.warnings.join(" ")).toContain("alongside automatic tempo");
});
it("reuses cue/channel warnings and checks actual playback track duration", () => {
  const song = {
    ...saved.song!,
    duration: 999,
    settings: { ":bpm": "120", "": "[00:12] {label:TimeLine: Recall} {midi:pc 2 3}\n[00:00] {midi:note 1 60 100}" },
  };
  const [result] = playlistPreflight(["one"], [{ ...saved, song }], config);
  expect(result.warnings.join(" ")).toContain("beyond the 10.00");
  expect(result.warnings.join(" ")).toContain("no later note-off");
});

it("uses the first playback stem in player order, not the longest track or metadata duration", () => {
  const song = {
    ...saved.song!,
    audio: [
      ...saved.song!.audio,
      { name: "vocals", sampleRate: 44100, frames: 882000, channels: 1 },
      { name: "drums", sampleRate: 44100, frames: 220500, channels: 1 },
    ],
    settings: { ":bpm": "120", "": "[00:08] {midi:pc 1 2}" },
  };
  const [result] = playlistPreflight(["one"], [{ ...saved, song }], config);
  expect(result.warnings.join(" ")).toContain("beyond the 5.00");
  expect(result.warnings.join(" ")).toContain("different lengths");
});

it("checks the tempo the song plays at, and whether its speed render is ready", () => {
  const song = { ...saved.song!, settings: { ":bpm": "100", ":options": '{"speed":0.7}', "": "" } };
  const [slow] = playlistPreflight(["one"], [{ ...saved, song }], config);
  // 100 BPM at 70% is 70 BPM, which is inside the pedal range, so only the render warns
  expect(slow.errors).toEqual([]);
  const [warned] = playlistPreflight(["one"], [{ ...saved, song }], { ...config, renderReady: () => false });
  expect(warned.warnings.join(" ")).toContain("not rendered in advance");
  const [ready] = playlistPreflight(["one"], [{ ...saved, song }], { ...config, renderReady: () => true });
  expect(ready.warnings.join(" ")).not.toContain("not rendered in advance");
  // The first two songs are warnings, since the first renders as it loads and the second is prepared next; later songs are noted
  const three = [saved, { ...saved, id: "two" }, { ...saved, id: "three" }].map((e) => ({ ...e, song: { ...song } }));
  const checks = playlistPreflight(["one", "two", "three"], three, { ...config, renderReady: () => false });
  expect(checks[0].warnings.join(" ")).toContain("not rendered in advance");
  expect(checks[1].warnings.join(" ")).toContain("not rendered in advance");
  expect(checks[2].warnings).toEqual([]);
  expect(checks[2].notes.join(" ")).toContain("not rendered in advance");
  const fast = { ...saved.song!, settings: { ":bpm": "250", ":options": '{"speed":1.5}', "": "" } };
  const [result] = playlistPreflight(["one"], [{ ...saved, song: fast }], config);
  expect(result.errors.join(" ")).toContain("375 BPM");
});
