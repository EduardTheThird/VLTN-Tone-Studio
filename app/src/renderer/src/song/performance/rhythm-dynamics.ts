import { parseBandSettings, planSections } from "../band/arrangement";
import { parseBeatGrid } from "../band/beat-grid";
import { marksByBar } from "../band/marks";
import { parseBandNotes } from "../band/stored-notes";
import { barSpans } from "../band/timing";
import type { BandVariant } from "../band/live-variants";
import type { Section } from "./sections";

const LEVELS = [60, 75, 90, 100, 110] as const;
export const DEFAULT_RHYTHM_LEVEL = LEVELS[2];
export const RHYTHM_BREAK_CC = 84;
export const RHYTHM_LEVEL_CC = 85;
export const RHYTHM_BREAK_LEAD_S = 0.15;

export interface RhythmBreak {
  /** Bar index relative to the pedal's start. */
  id: number;
  at: number;
}

export function rhythmBreaks(options: Record<string, unknown>, start: number, barSeconds: number, ending: number): RhythmBreak[] {
  const grid = parseBeatGrid(options.beatGrid);
  const marks = parseBandSettings(options.band).marks.filter((mark) => mark.kind === "stop" || mark.kind === "drums-out");
  const stops = new Set(parseBandNotes(options.bandNotes)?.detectedStops ?? []);
  const times: number[] = [];
  if (grid) {
    const marked = marksByBar(grid, marks).byBar;
    barSpans(grid).forEach(({ start, beats }, index) => {
      const timesInBar = grid.beats.slice(start, start + beats);
      if (marked.has(index) || (timesInBar.length === beats && timesInBar.every((at) => stops.has(at)))) times.push(grid.beats[start]);
    });
  } else {
    times.push(...marks.map((mark) => mark.time));
  }
  const bars = new Set(times.map((time) => Math.round((time - start) / barSeconds)));
  return [...bars].sort((a, b) => a - b).flatMap((id) => {
    const at = start + id * barSeconds;
    return id > 0 && at < ending - 0.001 ? [{ id, at }] : [];
  });
}

export function rhythmLevels(sections: readonly Section[], duration: number, options: Record<string, unknown>, start: number, end: number): { at: number; value: number; section: string }[] {
  const plans = planSections(sections, duration, parseBandSettings(options.band));
  let last: number | undefined;
  return plans.flatMap((plan) => {
    if (plan.end <= start || plan.start >= end) return [];
    const value = LEVELS[plan.loud - 1] ?? DEFAULT_RHYTHM_LEVEL;
    if (last === value) return [];
    last = value;
    return [{ at: Math.max(start, plan.start), value, section: plan.name }];
  });
}

export function liveRhythmLevel(base: number, variant: BandVariant): number {
  const offset = variant === "soft" ? -15 : variant === "lift" ? 10 : 0;
  return Math.max(0, Math.min(127, base + offset));
}
