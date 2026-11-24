import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inspectRc10rRhythmMemory, patchRc10rMemory, rc10rMemoryXml, readRc10rMemoryPair } from "./rc10r-memory";
import { testRc10rMemory, testRc10rXml } from "./rc10r-test-data";
const xml = testRc10rXml();

describe("native RC-10R memory preservation", () => {
  it("supports all 99 phrase memories and preserves every unrelated byte, including current selection and tracks", () => {
    for (let memory = 1; memory <= 99; memory++) {
      const [one, two] = patchRc10rMemory(xml, memory, 50, 15, 350);
      const expected = xml.replace(
        new RegExp(`(<mem id="${memory - 1}">[\\s\\S]*?<CONTENT399>)<Kit>0</Kit><Tempo>1200</Tempo>`),
        "$1<Kit>15</Kit><Tempo>3500</Tempo>",
      );
      expect(new TextDecoder().decode(one.subarray(0, -4))).toBe(expected);
      expect(createHash("sha256").update(one.subarray(0, -4)).digest("hex")).toBe(createHash("sha256").update(two.subarray(0, -4)).digest("hex"));
      expect([...one.subarray(-4)]).toEqual([0, 0, 0, 0]);
      expect([...two.subarray(-4)]).toEqual([1, 0, 0, 0]);
    }
  });
  it("validates both complete copies and refuses divergent or incomplete XML without repairing it", () => {
    expect(readRc10rMemoryPair(testRc10rMemory(xml, 100), testRc10rMemory(xml, 101))).toBe(xml);
    for (const bad of [
      xml.replace('id="98"', 'id="97"'),
      xml.replace("<WavLen>42</WavLen>", "<broken>"),
      xml.replace("<CONTENT399>", "<CONTENT400>"),
      xml.replace("<Kit>0</Kit>", "<Kit>99</Kit>"),
      xml.replace("<TRACK1>", "<!DOCTYPE a><TRACK1>"),
      xml.replace("<Kit>0</Kit>", "<Kit>0</Kit><Kit>1</Kit>"),
    ]) {
      expect(() => rc10rMemoryXml(testRc10rMemory(bad))).toThrow();
    }
    expect(() => readRc10rMemoryPair(testRc10rMemory(xml), testRc10rMemory(xml.replace("<Other>17", "<Other>18")))).toThrow();
    expect(() => rc10rMemoryXml(new Uint8Array([255]))).toThrow();
  });
  it("rejects invalid settings and missing target fields", () => {
    for (const args of [
      [0, 1, 0, 120],
      [100, 1, 0, 120],
      [1, 0, 0, 120],
      [1, 51, 0, 120],
      [1, 1, 16, 120],
      [1, 1, 0, 351],
    ])
      expect(() => patchRc10rMemory(xml, args[0], args[1], args[2], args[3])).toThrow();
    expect(() => patchRc10rMemory(xml.replace(/<CONTENT350>[\s\S]*?<\/CONTENT350>/g, ""), 1, 1, 0, 120)).toThrow();
  });
});

it("reads literal rhythm settings from one phrase in a matching pair", () => {
  const source = xml.replace(
    /(<mem id="4">[\s\S]*?<RHYTHM>)/,
    "$1<Kit>4</Kit><Level>95</Level><ReverbLevel>50</ReverbLevel><Intro>1</Intro><StopMode>3</StopMode><PlayMode>0</PlayMode><FadeOutTime>43</FadeOutTime><TransitionFill>1</TransitionFill>",
  );
  const one = testRc10rMemory(source, 0);
  const two = testRc10rMemory(source, 1);
  expect(inspectRc10rRhythmMemory(one, two, 5)).toEqual({
    Kit: 4, Level: 95, ReverbLevel: 50, Intro: 1, StopMode: 3, PlayMode: 0, FadeOutTime: 43, TransitionFill: 1,
  });
  expect(inspectRc10rRhythmMemory(one, two, 6)).toEqual({});
  expect(new TextDecoder().decode(one.subarray(0, -4))).toBe(source);
  expect(() => inspectRc10rRhythmMemory(one, testRc10rMemory(xml), 5)).toThrow(/disagree/);
  expect(() => inspectRc10rRhythmMemory(one, two, 100)).toThrow(/1–99/);
});
