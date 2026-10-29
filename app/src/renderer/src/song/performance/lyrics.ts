import { lrcTime } from "./chart";
import type { TimedWord } from "./lyrics-align";
import { WINDOW_PAD_SECONDS, type Region } from "./vocal-activity";
export interface LyricSegment {
  time: number;
  text: string;
}
type Chunk = { text: string; timestamp: [number | null, number | null] };

/** A gap this long between words starts a new line. */
export const LINE_GAP_SECONDS = 0.6;
/** Lines are cut at this many words, even with no gap. */
export const MAX_LINE_WORDS = 12;
/** A line that repeats more than this many times within REPEAT_WINDOW_SECONDS is a loop, not the song. */
export const MAX_REPEATS = 3;
export const REPEAT_WINDOW_SECONDS = 10;
/** Phrases Whisper writes over silence. Compared on normalised text (lower case, letters and digits only). */
export const HALLUCINATIONS: readonly string[] = [
  "thank you for watching",
  "thanks for watching",
  "subtitles by the amara org community",
  "subscribe to my channel",
  "like and subscribe",
  "music",
];

/** Keep generated text inert when copied into the chart's MIDI-aware syntax. */
export function cleanText(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/\{midi:/gi, "{midi :")
    .trim();
}

/** Word chunks from a word-timestamp run, in song time. Chunks without a usable start or end are dropped. */
export function transcriptWords(chunks: Chunk[], duration: number): TimedWord[] {
  return chunks.flatMap((chunk) => {
    const [start, end] = chunk.timestamp;
    const text = cleanText(chunk.text);
    return start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start < duration && text
      ? [{ text, start, end: Math.min(end, duration) }]
      : [];
  });
}

/** Words that start inside a singing region (padded, since the transcriber's word starts can land just before one). */
export function keepWordsWithin(words: readonly TimedWord[], regions: readonly Region[], pad = WINDOW_PAD_SECONDS): TimedWord[] {
  return words.filter((word) => regions.some((region) => word.start >= region.start - pad && word.start <= region.end + pad));
}

/** Words grouped into lines at gaps and at MAX_LINE_WORDS, then cleaned. Each line takes its first word's time. */
export function songLines(words: readonly TimedWord[]): LyricSegment[] {
  const groups: TimedWord[][] = [];
  let line: TimedWord[] = [];
  for (const word of [...words].sort((a, b) => a.start - b.start)) {
    const last = line[line.length - 1];
    if (last && (word.start - last.end > LINE_GAP_SECONDS || line.length >= MAX_LINE_WORDS)) {
      groups.push(line);
      line = [];
    }
    line.push(word);
  }
  if (line.length) groups.push(line);
  return cleanLines(groups.map((group) => ({ time: group[0].start, text: group.map((word) => cleanText(word.text)).filter(Boolean).join(" ") })));
}

/** Drops lines with no letters or digits, known hallucinations, and loops of a line repeated too often. */
export function cleanLines(segments: readonly LyricSegment[]): LyricSegment[] {
  const kept: LyricSegment[] = [];
  const recent: { key: string; time: number }[] = [];
  for (const segment of segments) {
    const key = segment.text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (!key || HALLUCINATIONS.includes(key)) continue;
    const repeats = recent.filter((r) => r.key === key && segment.time - r.time < REPEAT_WINDOW_SECONDS).length;
    if (repeats >= MAX_REPEATS) continue;
    recent.push({ key, time: segment.time });
    kept.push(segment);
  }
  return kept;
}

export function lyricsLrc(segments: readonly LyricSegment[]): string {
  return segments.map((s) => `${lrcTime(s.time)} ${s.text}`).join("\n");
}
