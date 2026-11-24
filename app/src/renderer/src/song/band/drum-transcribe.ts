import type { SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { barRoles } from "./drum-phrases";
import { SNAP_REACH_SECONDS, type DrumBand, type DrumHits, type DrumOnset } from "./drummer-timing";
import { CLOSED_HAT, KICK, SIDE_STICK, SNARE } from "./note";
import { findStyle, type Style } from "./styles";
import type { DrumHit } from "./styles/types";
import { barBeats, barSpans, beatSpan, patternBeats, planOfBar, stepAt, stepsForBar, stretchesToBar } from "./timing";

export const LEARN_MIN_CONFIDENCE = 0.6;
export const STICK_BELOW_DB = 8;
const STICK_MAX_DECAY = 0.025;
const MIN_PAIR_GAIN = 0.035;
const MIN_VARIANT_DISTANCE = 0.02;
const BASIC_QUARTER_SHARE = 0.95;
const BASIC_LEARNED_SHARE = 0.7;
const BASIC_VELOCITY_SPREAD = 28;

export interface LearnedSection {
  confidence: number;
  groove: DrumHit[] | null;
  /** The second bar of a repeating two-bar pattern. */
  alternate?: DrumHit[];
  fills: DrumHit[][];
  turnarounds: { bar: number; hits: DrumHit[] }[];
}

export interface LearnedDrumsReport {
  start: number;
  confidence: number;
  learned: boolean;
}

interface Step {
  time: number;
  step: number;
  bar: number;
  spacing: number;
}
type Quantised = DrumOnset & { step: number; band: DrumBand };

function stepsIn(style: Style, grid: BeatGrid, start: number, beats: number, bar: number): Step[] {
  const whole = patternBeats(style, barBeats(grid));
  const patternSteps = stepsForBar(style, style.meter.beatsPerBar);
  const count = stretchesToBar(style) ? patternSteps : stepsForBar(style, beats);
  const spacing = whole / patternSteps;
  const steps: Step[] = [];
  for (let step = 0; step < count; step++) {
    const point = stepAt(grid.beats, style, start, step, whole, 0);
    if (point.beat >= grid.beats.length || point.beat >= start + beats) break;
    steps.push({ time: point.time, step: step % patternSteps, bar, spacing: beatSpan(grid.beats, point.beat) * spacing });
  }
  return steps;
}

function nearestStep(steps: Step[], time: number): Step | undefined {
  let from = 0;
  let to = steps.length;
  while (from < to) {
    const middle = (from + to) >> 1;
    if (steps[middle].time < time) from = middle + 1;
    else to = middle;
  }
  const before = steps[from - 1];
  const after = steps[from];
  return !before || (after && after.time - time < time - before.time) ? after : before;
}

function pieces(hits: Quantised[]) {
  const mids = hits
    .filter((hit) => hit.band === "mid")
    .map((hit) => hit.peak)
    .sort((a, b) => a - b);
  const median = mids[Math.floor(mids.length / 2)];
  const quiet = median * 10 ** (-STICK_BELOW_DB / 20);
  return hits.map((hit) => ({
    ...hit,
    pitch: hit.band === "kick" ? KICK : hit.band === "high" ? CLOSED_HAT : hit.peak < quiet && hit.decay <= STICK_MAX_DECAY ? SIDE_STICK : SNARE,
  }));
}

function similarity(a: Set<number>, b: Set<number>): number {
  let overlap = 0;
  for (const step of a) if (b.has(step)) overlap++;
  const union = a.size + b.size - overlap;
  return union === 0 ? 0 : overlap / union;
}

function representative(shapes: Set<number>[], bars: number[]): number {
  let best = bars[0];
  let score = -1;
  for (const bar of bars) {
    if (!shapes[bar].size) continue;
    const total = bars.reduce((sum, other) => sum + similarity(shapes[bar], shapes[other]), 0);
    if (total > score) {
      best = bar;
      score = total;
    }
  }
  return best;
}

function learn(bars: Quantised[][]): LearnedSection {
  const unavailable: LearnedSection = { confidence: 0, groove: null, fills: [], turnarounds: [] };
  if (bars.length < 2) return unavailable;
  const voiced = bars.map(pieces);
  const peak = new Map<number, number>();
  for (const bar of voiced) for (const hit of bar) peak.set(hit.pitch, Math.max(peak.get(hit.pitch) ?? 0, hit.peak));
  const notes = voiced.map((bar) =>
    bar
      .map(({ step, pitch, peak: level }): DrumHit => {
        const dB = Math.max(-18, Math.min(0, 20 * Math.log10(level / peak.get(pitch)!)));
        return { step, pitch, velocity: Math.round(115 + (75 * dB) / 18) };
      })
      .sort((a, b) => a.step - b.step || a.pitch - b.pitch),
  );
  const shapes = notes.map((bar) => new Set(bar.map((hit) => hit.step * 128 + hit.pitch)));
  const indices = bars.map((_, i) => i);
  const first = representative(shapes, indices);
  const score = (repeats: number[]) => shapes.reduce((total, shape, i) => total + similarity(shape, shapes[repeats[i % repeats.length]]), 0) / bars.length;
  let repeats = [first];
  let confidence = score(repeats);
  // A repeating kick figure may take two bars. Require two complete periods and a clear improvement over the one-bar groove.
  if (bars.length >= 4) {
    const pair = [0, 1].map((phase) =>
      representative(
        shapes,
        indices.filter((i) => i % 2 === phase),
      ),
    );
    const pairScore = score(pair);
    if (pairScore > confidence + MIN_PAIR_GAIN) {
      repeats = pair;
      confidence = pairScore;
    }
  }
  if (confidence < LEARN_MIN_CONFIDENCE) return { ...unavailable, confidence };
  const result: LearnedSection = { groove: notes[repeats[0]], confidence, fills: [], turnarounds: [] };
  if (repeats.length === 2) result.alternate = notes[repeats[1]];
  for (const role of barRoles(bars.length)) {
    const expected = shapes[repeats[role.bar % repeats.length]];
    if (!notes[role.bar].length || similarity(shapes[role.bar], expected) >= 1 - MIN_VARIANT_DISTANCE) continue;
    if (role.sectionEnd) result.fills.push(notes[role.bar]);
    else if (role.phraseEnd) result.turnarounds.push({ bar: role.bar, hits: notes[role.bar] });
  }
  return result;
}

/** Snaps original drum attacks to the generated band's grid, then learns a recurring groove per section. */
export function transcribeDrums(onsets: DrumHits, grid: BeatGrid, plans: readonly SectionPlan[]): LearnedSection[] {
  const spans = barSpans(grid);
  const membership = spans.map((span) => planOfBar(plans, grid.beats, span));
  const steps = spans.flatMap((span, bar) => {
    const style = findStyle(plans[membership[bar]]?.style ?? "rock");
    return style ? stepsIn(style, grid, span.start, span.beats, bar) : [];
  });
  const hits = spans.map(() => new Map<string, Quantised>());
  for (const band of ["kick", "mid", "high"] as const) {
    for (const hit of onsets[band]) {
      const point = nearestStep(steps, hit.time);
      if (!point || Math.abs(point.time - hit.time) > Math.min(point.spacing / 2, SNAP_REACH_SECONDS)) continue;
      const key = `${point.step}:${band}`;
      const previous = hits[point.bar].get(key);
      if (hit.peak > (previous?.peak ?? 0)) hits[point.bar].set(key, { ...hit, step: point.step, band });
    }
  }
  return plans.map((_, plan) => learn(hits.flatMap((bar, i) => (membership[i] === plan ? [[...bar.values()]] : []))));
}

/** A click or kick can show up in several filter bands on the same step. Count that as one attack. */
function drumAttacks(bar: readonly DrumHit[]): Map<number, { pitches: number[]; velocity: number }> {
  const attacks = new Map<number, { pitches: number[]; velocity: number }>();
  for (const { step, pitch, velocity } of bar) {
    const attack = attacks.get(step);
    if (!attack) attacks.set(step, { pitches: [pitch], velocity });
    else {
      attack.pitches.push(pitch);
      attack.velocity = Math.max(attack.velocity, velocity);
    }
  }
  return attacks;
}

/** A phrase changes when an attack moves or gains a piece. Losing one filter band of the same attack is common on a split click. */
function hasDifferentAttacks(bar: readonly DrumHit[], groove: ReturnType<typeof drumAttacks>): boolean {
  const attacks = drumAttacks(bar);
  return attacks.size !== groove.size || [...attacks].some(([step, attack]) =>
    attack.pitches.some((pitch) => !groove.get(step)?.pitches.includes(pitch)));
}

/** Identifies a repeated, nearly quarter-note-only beat with at most two attack signatures and flat dynamics. */
export function isBasicDrumPattern(onsets: DrumHits, grid: BeatGrid, plans: readonly SectionPlan[]): boolean {
  const learned = transcribeDrums(onsets, grid, plans);
  const spans = barSpans(grid);
  const covered = spans.filter((span) => learned[planOfBar(plans, grid.beats, span)]?.groove).length;
  if (!spans.length || covered / spans.length < BASIC_LEARNED_SHARE) return false;
  let total = 0;
  let onBeat = 0;
  let pattern: string | undefined;
  const signatures = new Set<string>();
  const velocities: number[] = [];
  for (const [index, section] of learned.entries()) {
    if (!section.groove) continue;
    const style = findStyle(plans[index].style);
    if (!style) return false;
    const groove = drumAttacks(section.groove);
    const variants = [...section.fills, ...section.turnarounds.map(({ hits }) => hits), ...(section.alternate ? [section.alternate] : [])];
    if (variants.some((bar) => hasDifferentAttacks(bar, groove))) return false;
    const steps = stepsForBar(style, style.meter.beatsPerBar);
    const beats = patternBeats(style, barBeats(grid));
    const shape: string[] = [];
    for (const [step, attack] of groove) {
      const signature = attack.pitches.join(",");
      signatures.add(signature);
      total++;
      if ((step * beats) % steps === 0) onBeat++;
      velocities.push(attack.velocity);
      shape.push(`${(step * beats) / steps}:${signature}`);
    }
    const next = shape.join("|");
    if (pattern !== undefined && next !== pattern) return false;
    pattern = next;
  }
  if (!total || onBeat / total < BASIC_QUARTER_SHARE || signatures.size > 2) return false;
  velocities.sort((a, b) => a - b);
  const percentile = (fraction: number) => velocities[Math.round((velocities.length - 1) * fraction)];
  return percentile(0.9) - percentile(0.1) <= BASIC_VELOCITY_SPREAD;
}
