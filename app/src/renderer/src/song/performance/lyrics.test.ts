import { describe, expect, it } from "vitest";
import { cleanLines, cleanText, keepWordsWithin, lyricsLrc, MAX_LINE_WORDS, songLines, transcriptWords } from "./lyrics";
import type { TimedWord } from "./lyrics-align";

describe("cleanText", () => {
  it("keeps generated text inert in the chart's MIDI-aware syntax", () => {
    expect(cleanText(" {midi:pc 1 0}\nhello ")).toBe("{midi :pc 1 0} hello");
  });
});

describe("transcriptWords", () => {
  it("keeps words with usable timings inside the song", () => {
    const words = transcriptWords(
      [
        { text: " hi", timestamp: [0.5, 0.9] },
        { text: " there", timestamp: [null, 1] },
        { text: " late", timestamp: [12, 12.5] },
        { text: " ", timestamp: [1, 1.2] },
      ],
      10,
    );
    expect(words).toEqual([{ text: "hi", start: 0.5, end: 0.9 }]);
  });

  it("caps a word's end at the end of the vocals", () => {
    expect(transcriptWords([{ text: " end", timestamp: [9, 11] }], 10)).toEqual([{ text: "end", start: 9, end: 10 }]);
  });
});

/** Words one after another, each 0.4 s long with a 0.1 s gap, from `start`. */
function run(text: string, start: number): TimedWord[] {
  return text.split(" ").map((word, i) => ({ text: word, start: start + i * 0.5, end: start + i * 0.5 + 0.4 }));
}

describe("songLines", () => {
  it("starts a new line at a vocal gap and takes each line's first word as its time", () => {
    const words = [...run("hold on", 2), ...run("im coming", 6)];
    expect(lyricsLrc(songLines(words))).toBe("[00:02.00] hold on\n[00:06.00] im coming");
  });

  it("cuts a line at the maximum word count even without a gap", () => {
    const words = run(Array.from({ length: MAX_LINE_WORDS + 1 }, (_, i) => `w${i}`).join(" "), 0);
    const lines = songLines(words);
    expect(lines.map((line) => line.text.split(" ").length)).toEqual([MAX_LINE_WORDS, 1]);
  });
});

describe("cleanLines", () => {
  it("drops lines with no letters or digits and known hallucinations", () => {
    const lines = cleanLines([
      { time: 0, text: "♪" },
      { time: 1, text: "..." },
      { time: 2, text: "Thank you for watching." },
      { time: 3, text: "Subtitles by the Amara.org community" },
      { time: 4, text: "Real words" },
    ]);
    expect(lines).toEqual([{ time: 4, text: "Real words" }]);
  });

  it("drops a line that loops more than three times within ten seconds, and keeps it once the loop has passed", () => {
    const loop = [0, 1, 2, 3, 4].map((time) => ({ time, text: "na na na" }));
    expect(cleanLines(loop).map((line) => line.time)).toEqual([0, 1, 2]);
    expect(cleanLines([...loop.slice(0, 3), { time: 20, text: "na na na" }]).map((line) => line.time)).toEqual([0, 1, 2, 20]);
  });
});

describe("keepWordsWithin", () => {
  it("keeps words that start inside a region, with a little padding on each side", () => {
    const words = [
      { text: "a", start: 1, end: 1.1 },
      { text: "b", start: 5.2, end: 5.3 },
      { text: "c", start: 8, end: 8.1 },
    ];
    expect(keepWordsWithin(words, [{ start: 0.8, end: 5 }]).map((w) => w.text)).toEqual(["a", "b"]);
  });
});
