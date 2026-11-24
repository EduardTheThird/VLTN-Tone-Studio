import { expect, it } from "vitest";
import { emptyPedalSettings } from "@shared/pedal-settings";
import { computeChaseState } from "./midi-chase";
import { midiPreflight } from "./midi-preflight";
import { songCues } from "./song-cues";
import type { Section } from "./sections";
import { buildRig, importRigCues, parseSongRig, rigChartChanged, rigExtras, rigProfiles, rigRowsFromBlock, rigSetupWarnings, rigSummaries } from "./rig";

const library = {
  ...emptyPedalSettings(),
  owned: ["valeton-gp180", "strymon-timeline", "boss-sy200", "boss-ir200", "boss-rc10r"],
  channels: { "valeton-gp180": 16 },
  assignments: { "boss-sy200:switch": 70, "boss-ir200:solo": 72 },
  presets: { "strymon-timeline": [{ slot: 24, name: "Dotted eighth" }] },
};
const names = { "valeton-gp180": ["Clean", "Crunch Lead"] };
const sections: Section[] = [
  { id: "verse", name: "Verse", start: 2, end: 12, mode: "continue" },
  { id: "chorus", name: "Chorus", start: 12, end: 22, mode: "continue" },
];

const rig = parseSongRig({ rows: [
  { id: "load", cells: { "valeton-gp180": { preset: 0 } } },
  { id: "section:chorus", cells: {
    "valeton-gp180": { preset: 1 },
    "strymon-timeline": { preset: 24 },
    "boss-sy200": { preset: 6, extras: [{ action: "switch" }] },
  } },
] });

it("writes named, early section cues with one managed span and round-trips the table rows", () => {
  const handwritten = "[00:00] {midi:cc 12 9 1}";
  const built = buildRig(rig, handwritten, library, names, sections, 120, 4);
  expect(built.chart.startsWith(handwritten + "\n// Rig: begin")).toBe(true);
  expect(built.chart).toContain("GP-180 002 Crunch Lead");
  expect(built.chart).toContain("TimeLine 12A Dotted eighth");
  expect(rigRowsFromBlock(built.chart)).toEqual(rig.rows);
  const cues = songCues(built.chart, [], null).cues;
  expect(cues.filter((cue) => cue.rig && cue.trigger === "load").flatMap((cue) => cue.messages)).toEqual([[0xbf, 0, 0], [0xcf, 0]]);
  const chorus = cues.filter((cue) => cue.rig && !cue.trigger);
  expect(chorus.map((cue) => cue.time)).toEqual([11.5, 11.5]);
  expect(chorus[0].messages).toContainEqual([0xcf, 1]);
  expect(chorus[0].messages).toContainEqual([0xc0, 24]);
  expect(chorus[1].chase).toBe(false);
  expect(chorus[1].messages).toEqual([[0xb3, 70, 127], [0xb3, 70, 0]]);
  const chase = computeChaseState(cues, 13).map((message) => message.bytes);
  expect(chase).toContainEqual([0xcf, 1]);
  expect(chase).toContainEqual([0xc0, 24]);
  expect(chase).toContainEqual([0xc3, 6]);
  expect(chase.some((message) => message[0] === 0xb3 && message[1] === 70)).toBe(false);

  expect(rigChartChanged({ ...rig, block: built.block }, built.chart)).toBe(false);
  expect(rigChartChanged({ ...rig, block: built.block }, built.chart.replace("{midi:pc 16 1}", "{midi:pc 16 3}"))).toBe(true);
  expect(buildRig(rig, built.chart.replace("{midi:pc 16 1}", "{midi:pc 16 3}"), library, names, sections, 120, 4).chart).toBe(built.chart);
});

it("imports three known recalls and leaves the RC-10R column read-only", () => {
  const chart = [
    "{label:GP-180: Clean} {midi@load:pc 16 0}",
    "[00:02.00] {midi:cc 1 0 0} {midi:pc 1 24}",
    "[00:12.00] {midi:pc 4 6}",
  ].join("\n");
  const imported = importRigCues(parseSongRig(null), chart, library, sections);
  expect(imported.imported).toBe(3);
  expect(imported.unmatched).toEqual([]);
  expect(imported.rig.rows).toEqual([
    { id: "load", cells: { "valeton-gp180": { preset: 0 } } },
    { id: "section:verse", cells: { "strymon-timeline": { preset: 24 } } },
    { id: "section:chorus", cells: { "boss-sy200": { preset: 6 } } },
  ]);
  expect(rigExtras(rigProfiles(library).find((profile) => profile.id === "boss-rc10r")!)).toEqual([]);
  expect(parseSongRig({ rows: [{ id: "load", cells: { "boss-rc10r": { preset: 9 } } }] }).rows[0].cells).toEqual({});
});

it("summarises the next row and preflights handwritten collisions and unassigned controls", () => {
  expect(rigSummaries(rig, sections, library, names)).toEqual([
    { at: 2, label: "" },
    { at: 12, label: "GP-180 002 Crunch Lead · TimeLine 12A Dotted eighth · SY-200 007, Press ON/OFF switch" },
  ]);
  const built = buildRig(rig, "[00:11.50] {midi:pc 16 29}", library, names, sections, 120, 4);
  const result = midiPreflight(songCues(built.chart, [], null).cues, { duration: 30, pedals: [], clock: false });
  expect(result.warnings.map(({ code }) => code)).toContain("rig-hand-cue");
  expect(rigSetupWarnings(rig, { ...library, assignments: {} }, sections)).toContain("Rig pedal BOSS SY-200 needs ON/OFF SW CC assigned.");
});
