import { describe, expect, it } from "vitest";
import type { LibrarySong } from "@shared/song-library";
import { CURRENT_ENGINE, DEFAULT_BAND_SETTINGS } from "../band/arrangement";
import { GENERATED_PART_NAMES } from "../band/generated-names";
import { parseChart } from "./chart";
import { DEFAULT_SET_UPGRADE, planSetUpgrade, relabelPresetCues } from "./set-upgrade";

function song(engine: number): LibrarySong {
  return {
    id: "fixture",
    title: "Fixture",
    artist: "",
    sourceName: "Fixture.wav",
    duration: 8,
    updated: "2026-11-14",
    audio: ["drums", "bass"].map((kind, i) => ({
      name: GENERATED_PART_NAMES[kind as "drums" | "bass"],
      kind: "user",
      file: `track${i}.flac`,
      sampleRate: 44100,
      frames: 352800,
      channels: 2,
    })),
    settings: { ":options": JSON.stringify({ generatedParts: { drums: "track0", bass: "track1" }, band: { ...DEFAULT_BAND_SETTINGS, engine } }) },
  };
}
describe("set upgrade plan", () => {
  it.each([1, 2, 3])("plans engine %i without mutating the song", (engine) => {
    const fixture = song(engine);
    const before = structuredClone(fixture);
    const plan = planSetUpgrade(fixture, DEFAULT_SET_UPGRADE);
    expect(plan.render).toBe(engine < CURRENT_ENGINE);
    expect(plan.settings.engine).toBe(CURRENT_ENGINE);
    expect(fixture).toEqual(before);
  });
  it("skips songs with no generated parts or only rendered parts", () => {
    const empty = song(1);
    empty.audio = [];
    expect(planSetUpgrade(empty, DEFAULT_SET_UPGRADE).band).toBe("Skipped: No generated parts");
    const rendered = song(1);
    rendered.settings[":options"] = JSON.stringify({
      generatedParts: { drums: "track0", bass: "track1" },
      band: {
        ...DEFAULT_BAND_SETTINGS,
        engine: 1,
        rendered: {
          drums: { name: "Mine", importedAt: "2026-11-14" },
          bass: { name: "Mine", importedAt: "2026-11-14" },
        },
      },
    });
    expect(planSetUpgrade(rendered, { ...DEFAULT_SET_UPGRADE, warmBass: true }).render).toBe(false);
  });
  it("updates only the generated part beside an owned rendered part", () => {
    const fixture = song(2);
    fixture.settings[":options"] = JSON.stringify({
      generatedParts: { drums: "track0", bass: "track1" },
      band: { ...DEFAULT_BAND_SETTINGS, engine: 2, rendered: { drums: { name: "Mine", importedAt: "today" } } },
    });
    expect(planSetUpgrade(fixture, DEFAULT_SET_UPGRADE).generated).toEqual(["bass"]);
  });
  it("Warm is optional and only touches clean generated bass, even on the current engine", () => {
    const fixture = song(3);
    const options = { ...DEFAULT_SET_UPGRADE, warmBass: true };
    expect(planSetUpgrade(fixture, DEFAULT_SET_UPGRADE).warm).toBe(false);
    expect(planSetUpgrade(fixture, options).settings.bassTone).toEqual({ kind: "builtin", id: "warm" });
    fixture.settings[":options"] = JSON.stringify({ generatedParts: { drums: "track0", bass: "track1" }, band: { ...DEFAULT_BAND_SETTINGS, bassTone: { kind: "builtin", id: "warm" } } });
    expect(planSetUpgrade(fixture, options).warm).toBe(false);
  });
});
describe("cue names", () => {
  it.each(["gp150", "gp180"] as const)("names %s bank-select slots without changing any MIDI bytes", (model) => {
    const chart = "[0:01] {midi:cc 16 0 1} {midi:pc 16 3} {label:Recall memory} // keep me\n[0:03] {midi:cc 16 0 0} {midi:pc 16 4}";
    const names = Array.from({ length: 256 }, (_, i) => `Sound ${i}`);
    const result = relabelPresetCues(chart, [{ names: { model, names, source: "cached" }, channel: 16 }]);
    expect(result.renamed).toBe(2);
    expect(result.chart).toContain(`${model === "gp150" ? "GP-150" : "GP-180"}: 132 Sound 131`);
    expect(result.chart).toContain("// keep me");
    expect(parseChart(result.chart).map((cue) => cue.messages)).toEqual(parseChart(chart).map((cue) => cue.messages));
    expect(relabelPresetCues(result.chart, [{ names: { model, names, source: "live" }, channel: 16 }]).renamed).toBe(0);
  });
  it("leaves named cues, unknown slots and other channels alone", () => {
    const chart =
      "[0:00] {midi:cc 16 0 0} {midi:pc 16 4} {label:GP-180: 005 My Sound}\n[0:01] {midi:cc 16 0 1} {midi:pc 16 4}\n[0:02] {midi:cc 2 0 0} {midi:pc 2 4}";
    const result = relabelPresetCues(chart, [{ names: { model: "gp180", names: [], source: "cached" }, channel: 16 }]);
    expect(result).toEqual({ chart, renamed: 0, unnamed: 1 });
  });
  it("leaves ambiguous multiple commands on one line and labels in comments alone", () => {
    const chart = "[0:00] {midi:cc 16 0 0} {midi:pc 16 0} {midi:cc 2 7 127} // {label:comment}";
    const result = relabelPresetCues(chart, [{ names: { model: "gp180", names: ["Lead"], source: "live" }, channel: 16 }]);
    expect(result.chart).toBe(chart);
  });
});
