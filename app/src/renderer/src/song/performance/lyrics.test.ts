import { describe, expect, it } from "vitest";
import { cleanLines, cleanText, keepWordsWithin, lyricsLrc, MAX_LINE_WORDS, songLines, transcriptWords, windowWords } from "./lyrics";
import type { TimedWord } from "./lyrics-align";
import { ownedSpans, transcriptionWindows, type Region } from "./vocal-activity";

type Chunk = { text: string; timestamp: [number | null, number | null] };

describe("cleanText", () => {
  it("keeps generated text inert in the chart's MIDI-aware syntax", () => {
    expect(cleanText(" {midi:pc 1 0}\nhello ")).toBe("{midi :pc 1 0} hello");
  });
});

describe("transcriptWords", () => {
  it("keeps words inside the window, and drops blank words and words that start after it", () => {
    const words = transcriptWords(
      [
        { text: " hi", timestamp: [0.5, 0.9] },
        { text: " there", timestamp: [null, 1] },
        { text: " late", timestamp: [12, 12.5] },
        { text: " ", timestamp: [1, 1.2] },
      ],
      10,
    );
    expect(words).toEqual([
      { text: "hi", start: 0.5, end: 0.9 },
      { text: "there", start: 0.9, end: 1 },
    ]);
  });

  it("caps a word's end at the end of the vocals", () => {
    expect(transcriptWords([{ text: " end", timestamp: [9, 11] }], 10)).toEqual([{ text: "end", start: 9, end: 10 }]);
  });

  it("repairs a missing start from the word before and a missing end from the word after", () => {
    const words = transcriptWords(
      [
        { text: " a", timestamp: [0.2, null] },
        { text: " b", timestamp: [null, 0.9] },
        { text: " c", timestamp: [1, null] },
      ],
      10,
    );
    const rounded = words.map((word) => ({ text: word.text, start: Math.round(word.start * 100) / 100, end: Math.round(word.end * 100) / 100 }));
    expect(rounded).toEqual([
      { text: "a", start: 0.2, end: 0.6 },
      { text: "b", start: 0.6, end: 0.9 },
      { text: "c", start: 1, end: 1.4 },
    ]);
  });

  it("repairs a first word with no start from its end, so an opening word is not lost", () => {
    expect(
      transcriptWords(
        [
          { text: " Fire", timestamp: [null, 0.9] },
          { text: " burn", timestamp: [1, 1.4] },
        ],
        10,
      ),
    ).toEqual([
      { text: "Fire", start: 0.5, end: 0.9 },
      { text: "burn", start: 1, end: 1.4 },
    ]);
  });
});

describe("windowWords across overlapping windows", () => {
  // Words every 0.5 s from 13 s, each 0.3 s long: an opening verse of about 38 s.
  const song: TimedWord[] = Array.from({ length: 76 }, (_, i) => ({ text: `w${i}`, start: 13 + i * 0.5, end: 13.3 + i * 0.5 }));

  /** What the transcriber returns for one window: the words that start in it, relative to its start, with the first start missing. */
  function heardIn(window: Region): Chunk[] {
    const chunks: Chunk[] = song
      .filter((word) => word.start >= window.start && word.start < window.end)
      .map((word) => ({
        text: ` ${word.text}`,
        timestamp: [word.start - window.start, Math.min(word.end, window.end) - window.start],
      }));
    if (chunks.length) chunks[0].timestamp[0] = null;
    return chunks;
  }

  it("keeps every word once across the overlap, and the opening words at their times", () => {
    const windows = transcriptionWindows([{ start: 13, end: 51 }], 60);
    expect(windows).toHaveLength(2);
    const spans = ownedSpans(windows);
    const heard = windows.flatMap((window, i) => windowWords(heardIn(window), window.end - window.start, window.start, spans[i]));
    expect(heard.map((word) => word.text)).toEqual(song.map((word) => word.text));
    heard.forEach((word, i) => expect(Math.abs(word.start - song[i].start)).toBeLessThan(0.3));
    expect(heard[0].start).toBeGreaterThan(12.5);
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
