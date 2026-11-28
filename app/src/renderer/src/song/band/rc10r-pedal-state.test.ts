import { describe, expect, it } from "vitest";
import type { Rc10rMemorySummary } from "@shared/rc10r-memory-map";
import type { Rc10rSystemSettings } from "@shared/rc10r-system";
import { friendlyRc10rError, loopSeconds, memoryNotes, memoryUsers, rc10rExpectations, rc10rSettingChecks, useRc10rPedalReading } from "./rc10r-pedal-state";

const system: Rc10rSystemSettings = {
  controlChannel: 2,
  noteChannel: null,
  transmitChannel: null,
  programChangeOut: true,
  clockOut: true,
  syncClock: 2,
  cc: { rhythmStart: 80, rhythmDivision: 81, rhythmFill: 82, rhythmStop: 83, rhythmBreak: null, rhythmLevel: null, loopStart: 70, loopStop: 71, loopUndoRedo: 72 },
  counter: 1,
};
const controls = { channel: 2, start: 80, division: 81, fill: 82, stop: 83, break: 84, level: 85 };
const memory = (n: number, loops: [number, number] = [0, 0]): Rc10rMemorySummary => ({
  memory: n,
  genre: 6,
  pattern: 0,
  userRhythm: null,
  kit: 0,
  tempo: 120,
  intro: true,
  stopMode: 3,
  playMode: 0,
  tracks: [
    { recorded: loops[0] > 0, seconds: loops[0], tempo: 120 },
    { recorded: loops[1] > 0, seconds: loops[1], tempo: 120 },
  ],
});
const song = (id: string, title: string, memoryNumber?: number) => ({
  id,
  title,
  settings: { ":options": JSON.stringify(memoryNumber ? { rhythmAutomation: { memory: memoryNumber } } : {}) },
});

describe("RC-10R pedal reading helpers (specs 174, 177, 179)", () => {
  it("checks break and level only when the song uses them", () => {
    const saved = { readAt: "2026-11-28T10:00:00Z", reading: { system, storageBytes: 0, loopBytes: 0, backupCopyBytes: 0 } };
    expect(rc10rSettingChecks(saved, rc10rExpectations(controls, { break: false, level: false }))!.every((c) => c.ok)).toBe(true);
    const failed = rc10rSettingChecks(saved, rc10rExpectations(controls, { break: true, level: false }))!.filter((c) => !c.ok);
    expect(failed.map((c) => `${c.label}: ${c.pedal} → ${c.app}`)).toEqual(["Rhythm break: OFF → CC#84"]);
    expect(rc10rSettingChecks(null, rc10rExpectations(controls, { break: true, level: true }))).toBeNull();
  });
  it("names memories with loops and memories other songs use", () => {
    const users = memoryUsers([song("a", "Burn", 5), song("b", "Silence", 2), song("c", "Copy of Burn", 5), song("d", "No cues")]);
    expect(users.get(5)?.map((u) => u.title)).toEqual(["Burn", "Copy of Burn"]);
    expect(memoryNotes([memory(5), memory(7, [16, 8])], users, 5, "a")).toEqual(["Memory 5 is also used by Copy of Burn."]);
    expect(memoryNotes([memory(7, [16, 8])], users, 7)).toEqual(["Memory 7 holds loops (16 s, 8.0 s). The cues only recall it; the loops stay."]);
    expect(memoryNotes(undefined, users, 9)).toEqual([]);
  });
  it("saves the last reading and keeps it after a reload", () => {
    useRc10rPedalReading.getState().save({ system, storageBytes: 5, loopBytes: 4, backupCopyBytes: 1 }, "2026-11-28T10:00:00Z");
    expect(useRc10rPedalReading.getState().saved?.reading.system?.controlChannel).toBe(2);
    expect(JSON.parse(localStorage.getItem("vltn.rc10r.pedal.v1")!).readAt).toBe("2026-11-28T10:00:00Z");
  });
  it("turns known storage errors into plain sentences and measures loops", () => {
    expect(friendlyRc10rError("Command failed: diskutil eject: Unmount of disk8 failed: at least one volume could not be unmounted")).toMatch(/Eject BOSS RC-10R in Finder/);
    expect(friendlyRc10rError("Something else")).toBe("Something else");
    expect(loopSeconds(44 + 44100 * 8 * 16)).toBe(16);
  });
});
