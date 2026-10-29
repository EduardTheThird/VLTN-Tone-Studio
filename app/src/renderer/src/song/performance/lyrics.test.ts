import { describe, expect, it } from "vitest";
import { cleanText, transcriptWords } from "./lyrics";

describe("cleanText", () => {
  it("keeps generated text inert in the chart's MIDI syntax", () => {
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
