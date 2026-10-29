import { lrcTime } from "./chart";
import type { TimedWord } from "./lyrics-align";
export interface LyricSegment {
  time: number;
  text: string;
}
type Chunk = { text: string; timestamp: [number | null, number | null] };

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

export function transcriptSegments(chunks: Chunk[], duration: number): LyricSegment[] {
  const segments = chunks
    .flatMap((chunk) => {
      const time = chunk.timestamp[0];
      const text = cleanText(chunk.text);
      return time !== null && Number.isFinite(time) && time >= 0 && time < duration && text ? [{ time, text }] : [];
    })
    .sort((a, b) => a.time - b.time);
  // Remove duplicate overlapping-window output, while preserving repeated lyrics in later verses.
  return segments.filter(
    (segment, i) => !segments.slice(Math.max(0, i - 3), i).some((previous) => previous.text === segment.text && Math.abs(previous.time - segment.time) < 0.5),
  );
}
export function lyricsLrc(segments: LyricSegment[]): string {
  return segments.map((s) => `${lrcTime(s.time)} ${s.text}`).join("\n");
}
