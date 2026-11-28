import { describe, expect, it } from "vitest";
import { checkRc10rSettings, rc10rCcFromIndex, readRc10rSystemPair } from "./rc10r-system";

// Synthetic settings in the pedal's layout: XML, then a four-byte little-endian save counter.
function systemFile(midi: Record<string, number>, counter: number, memNum = 0): Uint8Array {
  const fields = Object.entries(midi)
    .map(([tag, value]) => `\t<${tag}>${value}</${tag}>`)
    .join("\n");
  const xml =
    '<?xml version="1.0" encoding="utf-8"?>\n<database name="RC-10R" revision="0">\n<sys>\n<SETUP>\n' +
    `\t<MemNum>${memNum}</MemNum>\n</SETUP>\n<MIDI>\n${fields}\n</MIDI>\n</sys>\n</database>\n`;
  const body = new TextEncoder().encode(xml),
    bytes = new Uint8Array(body.length + 4);
  bytes.set(body);
  new DataView(bytes.buffer).setUint32(body.length, counter, true);
  return bytes;
}
const midi = {
  RxCtrlCh: 2,
  RxNoteCh: 0,
  TxCtrlCh: 0,
  PcOut: 1,
  SyncClk: 2,
  ClkOut: 1,
  RhyStrCc: 48,
  RhyDivCc: 49,
  RhyFilCc: 50,
  RhyStpCc: 51,
  RhybrkCc: 0,
  RhyLvlCc: 0,
  LoopStrCc: 38,
  LoopStpCc: 39,
  LoopUnRdCc: 40,
};

describe("RC-10R global settings (spec 174)", () => {
  it("decodes the pedal's CC menu index: OFF, CC#1–31, then CC#64–95", () => {
    expect(rc10rCcFromIndex(0)).toBeNull();
    expect(rc10rCcFromIndex(1)).toBe(1);
    expect(rc10rCcFromIndex(31)).toBe(31);
    expect(rc10rCcFromIndex(32)).toBe(64);
    expect(rc10rCcFromIndex(48)).toBe(80);
    expect(rc10rCcFromIndex(63)).toBe(95);
    expect(() => rc10rCcFromIndex(64)).toThrow();
  });
  it("reads the newer copy of a pair that differs only outside MIDI", () => {
    const settings = readRc10rSystemPair(systemFile(midi, 248, 0), systemFile(midi, 247, 1));
    expect(settings.counter).toBe(248);
    expect(settings.controlChannel).toBe(2);
    expect(settings.noteChannel).toBeNull();
    expect(settings.cc).toMatchObject({ rhythmStart: 80, rhythmDivision: 81, rhythmFill: 82, rhythmStop: 83, rhythmBreak: null, rhythmLevel: null, loopStart: 70 });
    expect(settings.programChangeOut).toBe(true);
    expect(settings.clockOut).toBe(true);
  });
  it("refuses copies that disagree about MIDI or have the wrong layout", () => {
    expect(() => readRc10rSystemPair(systemFile(midi, 2), systemFile({ ...midi, RxCtrlCh: 3 }, 1))).toThrow("disagree");
    const broken = systemFile(midi, 1);
    expect(() => readRc10rSystemPair(broken.subarray(0, 40), broken)).toThrow();
    const { RhyStrCc: _missing, ...partial } = midi;
    expect(() => readRc10rSystemPair(systemFile(partial, 1), systemFile(partial, 0))).toThrow();
  });
  it("checks only what the song uses and reports the pedal's and the app's values", () => {
    const settings = readRc10rSystemPair(systemFile(midi, 1), systemFile(midi, 0));
    const basic = checkRc10rSettings(settings, { channel: 2, rhythmStart: 80, rhythmDivision: 81, rhythmFill: 82, rhythmStop: 83 });
    expect(basic.map((c) => c.id)).toEqual(["channel", "rhythmStart", "rhythmDivision", "rhythmFill", "rhythmStop"]);
    expect(basic.every((c) => c.ok)).toBe(true);
    const full = checkRc10rSettings(settings, { channel: 2, rhythmStart: 80, rhythmDivision: 81, rhythmFill: 82, rhythmStop: 83, rhythmBreak: 84, rhythmLevel: 85, noteChannel: 10 });
    const failed = full.filter((c) => !c.ok);
    expect(failed.map((c) => [c.id, c.pedal, c.app])).toEqual([
      ["rhythmBreak", "OFF", "CC#84"],
      ["rhythmLevel", "OFF", "CC#85"],
      ["noteChannel", "OFF", "channel 10"],
    ]);
  });
});
