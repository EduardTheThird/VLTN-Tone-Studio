import type { BandNoteSet } from "./band-job";
import type { SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { CRASH, KICK, OPEN_HAT, CLOSED_HAT, PEDAL_HAT, SNARE, type NoteEvent } from "./note";
import { barStarts, clampVelocity } from "./timing";
import type { Energy } from "./styles/types";

export const RENDERED_VARIANTS = ["lift", "soft"] as const;
export type RenderedVariant = (typeof RENDERED_VARIANTS)[number];
export type BandVariant = "normal" | RenderedVariant | "drums" | "out";

export const BAND_VARIANT_LABELS: Record<BandVariant, string> = {
  normal: "Normal", lift: "Lift", soft: "Soft", drums: "Drums only", out: "Band out",
};

const PHRASE_BARS = 8;
const EXTRA_RENDER_COUNT = RENDERED_VARIANTS.length;

export function variantPlans(plans: readonly SectionPlan[], variant: RenderedVariant): SectionPlan[] {
  const step = variant === "lift" ? 1 : -1;
  const change = (energy: Energy): Energy => Math.max(1, Math.min(5, energy + step)) as Energy;
  return plans.map((plan) => ({ ...plan, loud: change(plan.loud), busy: change(plan.busy) }));
}

/** The backbeat and bass figure stay locked to the same times across performances. */
export function variantNotes(variant: RenderedVariant, grid: BeatGrid, plans: readonly SectionPlan[], normal: BandNoteSet, alternative: BandNoteSet): BandNoteSet {
  const gain = variant === "lift" ? 1.12 : 0.84;
  const scale = (note: NoteEvent): NoteEvent => ({ ...note, velocity: clampVelocity(note.velocity * gain) });
  const backbeat = (note: NoteEvent) => note.pitch === KICK || note.pitch === SNARE;
  // Deliberately leave space in the quieter take, including styles whose core hat line is always on.
  let beat = 0;
  let lastHat = -1;
  const decoration = alternative.drums.flatMap((note): NoteEvent[] => {
    if (backbeat(note)) return [];
    if (variant !== "soft" || (note.pitch !== CLOSED_HAT && note.pitch !== OPEN_HAT && note.pitch !== PEDAL_HAT)) return [note];
    while (grid.beats[beat + 1] !== undefined && grid.beats[beat + 1] <= note.time + 0.035) beat++;
    if (lastHat === beat) return [];
    lastHat = beat;
    return [{ ...note, pitch: CLOSED_HAT }];
  });
  const drums = [...normal.drums.filter(backbeat).map(scale), ...decoration];
  if (variant === "lift" && normal.drums.length) {
    const starts = barStarts(grid).map((index) => grid.beats[index]);
    for (const plan of plans) {
      if (!plan.play.drums) continue;
      const own = starts.filter((at) => at >= plan.start && at < plan.end);
      own.forEach((time, i) => {
        if (i % PHRASE_BARS !== 0 || (i === 0 && plan.vamp)) return;
        if (!drums.some((note) => note.pitch === CRASH && Math.abs(note.time - time) < 0.03)) {
          drums.push({ time, pitch: CRASH, velocity: 108, duration: 0.1 });
        }
      });
    }
  }
  return {
    drums: drums.sort((a, b) => a.time - b.time || a.pitch - b.pitch),
    bass: normal.bass.map(scale),
    ...(normal.keys ? { keys: (alternative.keys ?? normal.keys).map(scale) } : {}),
  };
}

/** Extra Float32 PCM for two stereo versions of every selected generated part. */
export function variantExtraBytes(seconds: number, generatedParts: number, rate = 44100): number {
  return Math.ceil(Math.max(0, seconds) * rate) * 2 * Float32Array.BYTES_PER_ELEMENT * generatedParts * EXTRA_RENDER_COUNT;
}

export interface BandChange {
  variant: BandVariant;
  at: number;
}

export function nextBandBar(grid: BeatGrid, position: number): { at: number; precedingBar: number } | null {
  const starts = barStarts(grid).map((index) => grid.beats[index]);
  const index = starts.findIndex((at) => at > position + 1e-6);
  if (index < 0) return null;
  return { at: starts[index], precedingBar: starts[index - 1] ?? position };
}
