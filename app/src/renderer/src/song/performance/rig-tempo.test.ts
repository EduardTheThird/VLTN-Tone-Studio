import { describe, expect, it } from "vitest";
import { emptyPedalSettings, parsePedalSettings } from "@shared/pedal-settings";
import { parseChart } from "./chart";
import { midiPreflight } from "./midi-preflight";
import { readRigTempo, rigTempoCues, rigTempoPlan } from "./rig-tempo";

const library = { ...emptyPedalSettings(), owned: ["strymon-timeline", "boss-sy200", "valeton-gp180"], channels: { "strymon-timeline": 5, "valeton-gp180": 16 } };
const load = (cues: ReturnType<typeof parseChart>) => cues.filter((cue) => cue.trigger === "load").flatMap((cue) => cue.messages);

describe("per-song rig tempo", () => {
  it("preserves a legacy song and orders bank, preset, clock reception, and tap division on opt-in", () => {
    const hand = parseChart("{midi@load:cc 5 21 3} {midi@load:cc 5 0 1} {midi@load:pc 5 23}");
    expect(rigTempoCues(hand, rigTempoPlan(readRigTempo(undefined), library))).toBe(hand);
    const plan = rigTempoPlan(readRigTempo({ enabled: true, timelineDivision: 1 }), library);
    expect(plan).toMatchObject({ clock: true, gpTempo: true, gpChannel: 16 });
    expect(load(rigTempoCues(hand, plan))).toEqual([[0xb4, 0, 1], [0xc4, 23], [0xb4, 63, 1], [0xb4, 21, 1]]);
    const noDivision = rigTempoPlan(readRigTempo({ enabled: true }), library);
    expect(load(rigTempoCues(hand, noDivision)).at(-1)).toEqual([0xb4, 21, 3]);
  });

  it("reapplies the division after a timed preset and honours a division specified by that row", () => {
    const cues = parseChart("[00:03] {midi:pc 5 22}\n[00:09] {midi:cc 5 21 2} {midi:pc 5 23}");
    const plan = rigTempoPlan(readRigTempo({ enabled: true, timelineDivision: 1 }), library);
    expect(rigTempoCues(cues, plan).filter((cue) => !cue.trigger).map((cue) => cue.messages)).toEqual([
      [[0xc4, 22], [0xb4, 21, 1]], [[0xc4, 23], [0xb4, 21, 2]],
    ]);
  });

  it("disables TimeLine clock reception independently of the SY-200, and warns on a song clock override", () => {
    const pedals = { ...library, tempoFollow: { "strymon-timeline": false } };
    const plan = rigTempoPlan(readRigTempo({ enabled: true, noClock: true }), pedals);
    expect(plan).toMatchObject({ clock: false, wantsClock: ["boss-sy200"] });
    const cues = rigTempoCues([], plan);
    expect(load(cues)).toEqual([[0xb4, 63, 0]]);
    const report = midiPreflight(cues, { duration: 20, pedals: [], clock: false, rigTempo: plan });
    expect(report.warnings.find(({ code }) => code === "rig-clock-off")?.text).toContain("SY-200");
  });

  it("round-trips the backed-up follow preferences and rejects malformed values", () => {
    const settings = { ...library, tempoFollow: { "strymon-timeline": false, "boss-sy200": true } };
    expect(parsePedalSettings(JSON.stringify(settings)).tempoFollow).toEqual(settings.tempoFollow);
    expect(() => parsePedalSettings(JSON.stringify({ ...settings, tempoFollow: { "boss-sy200": "false" } }))).toThrow();
  });
});
