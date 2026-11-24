import { CLAP, COWBELL, SHAKER, TAMBOURINE } from "./note";
import type { DrumHit, Energy, Meter } from "./styles/types";

export const PERCUSSION_CHOICES = ["auto", "none", "tamb-backbeat", "tamb-eighths", "shaker-eighths", "shaker-sixteenths", "claps", "cowbell"] as const;
export type PercussionChoice = (typeof PERCUSSION_CHOICES)[number];
export type PercussionStroke = "shake" | "back";

export interface PercussionStyle {
  chorus?: PercussionChoice;
  verse?: PercussionChoice;
}

export function percussionHits(choice: PercussionChoice | undefined, meter: Meter, busy: Energy): DrumHit[] {
  if (choice === undefined || choice === "auto" || choice === "none") return [];
  const { stepsPerBeat: steps, beatsPerBar: beats } = meter;
  const offbeat = Math.ceil(steps / 2);
  const hits: DrumHit[] = [];
  for (let beat = 0; beat < beats; beat++) {
    const start = beat * steps;
    if (choice === "tamb-backbeat" || choice === "claps") {
      if (beat % 2 === 1) hits.push({ step: start, pitch: choice === "claps" ? CLAP : TAMBOURINE, velocity: 75 + 3 * busy });
    } else if (choice === "cowbell") {
      hits.push({ step: start, pitch: COWBELL, velocity: 58 + 3 * busy });
      if (busy >= 4 && beat % 2 === 1) hits.push({ step: start + offbeat, pitch: COWBELL, velocity: 54 });
    } else if (choice === "tamb-eighths") {
      hits.push({ step: start, pitch: TAMBOURINE, velocity: 62 + 3 * busy });
      hits.push({ step: start + offbeat, pitch: TAMBOURINE, velocity: 52 + 2 * busy, stroke: "shake" });
    } else {
      const subdivision = choice === "shaker-sixteenths" ? steps : 2;
      for (let step = 0; step < subdivision; step++) {
        const back = step % 2 === 1;
        hits.push({ step: start + Math.ceil(step * steps / subdivision), pitch: SHAKER, velocity: (back ? 43 : 62) + 3 * busy,
          ...(back ? { stroke: "back" as const } : {}) });
      }
    }
  }
  return hits;
}
