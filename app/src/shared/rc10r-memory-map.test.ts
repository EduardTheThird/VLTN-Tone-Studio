import { describe, expect, it } from "vitest";
import { freeRc10rMemories, hasLoops, rc10rMemoryMap } from "./rc10r-memory-map";

// Synthetic memories in the pedal's layout (only the fields the map reads).
function memoryXml(edit: (memory: number) => { genre?: number; pattern?: number; tempo?: number; loop?: [number, number] } = () => ({})): string {
  const mem = Array.from({ length: 99 }, (_, id) => {
    const { genre = 6, pattern = 0, tempo = 1200, loop = [0, 0] } = edit(id + 1);
    const trackXml = (n: 1 | 2, len: number) =>
      `<TRACK${n}><PlyLvl>100</PlyLvl><RecTmp>1200</RecTmp><WavStat>${len ? 1 : 0}</WavStat><WavLen>${len}</WavLen></TRACK${n}>`;
    return (
      `<mem id="${id}">${trackXml(1, loop[0])}${trackXml(2, loop[1])}<MASTER><Sync>0</Sync></MASTER>` +
      `<RHYTHM><Genre>${genre}</Genre><Pattern>${pattern}</Pattern><Kit>0</Kit><Tempo>${tempo}</Tempo><Level>100</Level><Intro>1</Intro>` +
      `<PlayMode>0</PlayMode><StopMode>3</StopMode></RHYTHM></mem>`
    );
  }).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>\n<database name="RC-10R" revision="0">\n${mem}\n</database>\n`;
}

describe("RC-10R memory map (spec 177)", () => {
  it("summarises all 99 memories: User rhythms, tempo and looper tracks", () => {
    const map = rc10rMemoryMap(
      memoryXml((m) => (m <= 6 ? { genre: 20, pattern: m - 1, tempo: 1400 } : m === 20 ? { loop: [705600, 352800] } : {})),
    );
    expect(map).toHaveLength(99);
    expect(map[0]).toMatchObject({ memory: 1, userRhythm: 1, tempo: 140, intro: true, stopMode: 3 });
    expect(map[5].userRhythm).toBe(6);
    expect(map[6].userRhythm).toBeNull();
    expect(map[19].tracks.map((t) => [t.recorded, t.seconds])).toEqual([
      [true, 16],
      [true, 8],
    ]);
    expect(hasLoops(map[19])).toBe(true);
    expect(hasLoops(map[0])).toBe(false);
  });
  it("lists free memories: no loops and no song", () => {
    const map = rc10rMemoryMap(memoryXml((m) => (m === 2 ? { loop: [44100, 0] } : {})));
    expect(freeRc10rMemories(map, new Set([1, 3])).slice(0, 3)).toEqual([4, 5, 6]);
  });
  it("refuses a file without all 99 memories", () => {
    expect(() => rc10rMemoryMap(memoryXml().replace(/<mem id="98">[\s\S]*?<\/mem>/, ""))).toThrow();
  });
});
