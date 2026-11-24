import { expect, it } from "vitest";
import { emptyPedalSettings } from "@shared/pedal-settings";
import { myRig, ownedPedalChannels, rigChannelIssues, rigCheckedAt, rigToggle, gpReceiveChannel } from "./my-rig";
import { midiPreflight } from "./midi-preflight";

const sy = "boss-sy200";
const settings = {
  ...emptyPedalSettings(),
  owned: ["valeton-gp180", sy, "strymon-timeline"],
  channels: { "valeton-gp180": 16 },
  assignments: { [`${sy}:switch`]: 21, [`${sy}:effect`]: 22 },
};

it("derives required SY-200 assignments and clock setup from saved songs, while keeping unchanged checks", () => {
  const song = { title: "Song", duration: 15, settings: { "": "[00:01] {midi:cc 4 21 127} {midi:cc 4 21 0}" } };
  const initial = myRig(settings, [song], []);
  const card = initial.cards.find(({ profile }) => profile.id === sy)!;
  const checked = card.lines.find((line) => line.id === "assign:switch:21")!;
  expect(checked.text).toBe("ON/OFF SW CC → 21.");
  const marks = { [checked.id]: { text: checked.text, at: "2026-11-24T12:00:00Z" } };
  const next = myRig(settings, [{ ...song, settings: { "": song.settings[""] + "\n[00:02] {midi:cc 4 22 110}", ":options": '{"clock":true}' } }], []);
  const lines = next.cards.find(({ profile }) => profile.id === sy)!.lines;
  expect(lines.map((line) => line.text)).toEqual(expect.arrayContaining(["EFFECT CC → 22.", "Set SYNC to AUTO.", "Use a Type A TRS MIDI cable."]));
  expect(lines.map((line) => [line.id, rigCheckedAt(line, marks)])).toEqual(
    expect.arrayContaining([
      ["assign:switch:21", "2026-11-24T12:00:00Z"],
      ["assign:effect:22", undefined],
      ["clock", undefined],
    ]),
  );
  expect(next.chain).toContain("Set GP-180 Send clock (TRS) to On. Check that clock reaches the downstream pedals.");
  expect(rigToggle(card, settings)).toEqual([
    [
      [0xb3, 21, 127],
      [0xb3, 21, 0],
    ],
    [
      [0xb3, 21, 127],
      [0xb3, 21, 0],
    ],
  ]);
});

it("uses banked TimeLine preset numbers and the saved names in the test sequence", () => {
  const library = { ...settings, presets: { "strymon-timeline": [{ slot: 129, name: "Ambient" }] } };
  const song = {
    title: "Song",
    duration: 15,
    settings: {
      "": "[00:00] {label:Strymon TimeLine: recall} {midi:cc 1 0 1} {midi:pc 1 1}\n[00:03] {midi:cc 1 0 0} {midi:pc 1 3}",
    },
  };
  const card = myRig(library, [song], []).cards.find(({ profile }) => profile.id === "strymon-timeline")!;
  expect(card.lines).toContainEqual({ id: "presets", text: "Presets in the library: 64B Ambient, 01B." });
  expect(card.recall.map(({ label }) => label)).toEqual(["64B Ambient", "01B"]);
});

it("reports shared owned channels, the GP-180's real receive channel and Omni in preflight", () => {
  const pedals = ownedPedalChannels({ ...settings, channels: { ...settings.channels, [sy]: 3, "strymon-timeline": 3 } });
  const actual = gpReceiveChannel({
    device: "gp180",
    globals: { midiInChannelUsb: 0, midiInChannelBt: 16 },
    transport: "system",
    pedalChannel: 16,
    downstreamPedals: true,
    appClock: false,
    otherChannels: [3],
    tempoOnStart: false,
  });
  const result = midiPreflight([], { duration: 15, clock: false, pedals: [], rigChannelWarnings: rigChannelIssues(pedals, actual) });
  expect(result.warnings.map((warning) => warning.code)).toEqual(["rig-channel-collision", "rig-gp-omni"]);
  expect(rigChannelIssues(pedals, 3).map((warning) => warning.code)).toEqual(["rig-channel-collision", "rig-gp-shared"]);
});
