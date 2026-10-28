// Drum generation: turns the beat grid, the section plans and the style's grooves into timed drum notes. Pure: no audio and no store.
// Every bar is placed on the real beats, so a part follows tempo drift. Humanising is not done here; that is a later layer.
//
// Random draws are kept independent of the musical choices where it matters. A fill is always drawn, whether it is on or not, and
// the optional-note drops of each bar use their own generator. So turning one fill on changes only that bar, and the rest of the
// song keeps its notes.

import type { BandSettings, SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { CRASH, DRUM_DURATION, KICK, type NoteEvent } from "./note";
import { createRandom } from "./random";
import { findStyle } from "./styles";
import type { DrumHit, Style } from "./styles/types";

/** The kick and crash that end the song. */
const ENDING_VELOCITY = 110;
const CRASH_VELOCITY = 110;
/** A section start gets a crash from this energy up, when crashOnSections is on. */
const CRASH_MIN_ENERGY = 3;
/** Up to this energy a fill is a half-bar fill. Above it the whole bar is a fill. */
const HALF_FILL_MAX_ENERGY = 3;
/** A variation lasts this many bars, picked at random each time one ends. */
const VARIATION_BARS: readonly [4, 8] = [4, 8];

/** The variation a plan is playing, and how many bars it has left. */
interface Segment {
  plan: number;
  groove: number;
  barsLeft: number;
}

/** Index of the plan covering `time`, or -1 when no plan does. Plans are in time order and do not overlap. */
export function planIndexAt(plans: readonly SectionPlan[], time: number): number {
  return plans.findIndex((plan) => time >= plan.start && time < plan.end);
}

/** A seed for one bar's own generator, mixed from the song seed and the bar's index. */
function barSeed(seed: number, bar: number): number {
  return (Math.imul(seed, 0x9e3779b1) ^ Math.imul(bar + 1, 0x85ebca6b)) >>> 0;
}

/** Time of a point `fraction` of the way through beat `beat`. The last beat has no following beat, so it uses the interval before it. */
function timeIn(beats: readonly number[], beat: number, fraction: number): number {
  let length = 0.5;
  if (beat + 1 < beats.length) length = beats[beat + 1] - beats[beat];
  else if (beat > 0) length = beats[beat] - beats[beat - 1];
  return beats[beat] + fraction * length;
}

/**
 * How late an off-beat step plays, in beats. The off-beat is the odd step of a sixteenth or eighth grid. At full swing (1) it would
 * sit two thirds of the way through the pair, so swing × half a step is close to a triplet feel at the top of the range. Triplet
 * grids take no swing here: their pattern already places the swing.
 */
function swingDelay(style: Style, fraction: number, swing: number): number {
  const perBeat = style.meter.stepsPerBeat;
  if (swing <= 0 || perBeat === 3) return 0;
  if (Math.round(fraction * perBeat) % 2 === 0) return 0;
  return (swing * 0.5) / perBeat;
}

function clampVelocity(value: number): number {
  return Math.min(127, Math.max(1, Math.round(value)));
}

/** Start beat of every bar in the grid, from the downbeat on. A beat before the downbeat is a pickup and gets no bar. */
function barStarts(grid: BeatGrid): number[] {
  const perBar = Math.max(1, Math.round(grid.beatsPerBar));
  const starts: number[] = [];
  for (let beat = Math.max(0, Math.round(grid.downbeat)); beat < grid.beats.length; beat += perBar) starts.push(beat);
  return starts;
}

/**
 * Drum notes for the whole song, sorted by time. A bar belongs to the plan covering its first beat. Bars of a plan with drums off, and
 * the pickup, are silent. The last bar of the song ends on a crash and a kick on its downbeat, and nothing follows.
 */
export function generateDrums(grid: BeatGrid, plans: readonly SectionPlan[], settings: BandSettings, seed: number): NoteEvent[] {
  const beats = grid.beats;
  const notes: NoteEvent[] = [];
  if (beats.length === 0 || plans.length === 0) return notes;

  const random = createRandom(seed);
  const perBar = Math.max(1, Math.round(grid.beatsPerBar));
  const starts = barStarts(grid);
  const planOf = starts.map((beat) => planIndexAt(plans, beats[beat]));
  const emit = (time: number, pitch: number, velocity: number) => notes.push({ time, pitch, velocity: clampVelocity(velocity), duration: DRUM_DURATION });

  let segment: Segment | null = null;
  let previousPlan = -2;
  let afterFill = false;

  for (let k = 0; k < starts.length; k++) {
    const start = starts[k];
    const planIndex = planOf[k];
    const newPlan = planIndex !== previousPlan;
    const crashAfterFill = afterFill;
    previousPlan = planIndex;
    afterFill = false;

    const plan = planIndex >= 0 ? plans[planIndex] : undefined;
    const style = plan && plan.play.drums ? findStyle(plan.style) : undefined;
    if (!plan || !style) {
      segment = null;
      continue;
    }

    if (k === starts.length - 1) {
      emit(beats[start], KICK, ENDING_VELOCITY);
      emit(beats[start], CRASH, CRASH_VELOCITY);
      continue;
    }

    if (!segment || segment.plan !== planIndex || segment.barsLeft === 0) {
      segment = { plan: planIndex, groove: random.int(style.grooves[plan.energy].length), barsLeft: random.pick(VARIATION_BARS) };
    }
    segment.barsLeft -= 1;
    const groove = style.grooves[plan.energy][segment.groove];

    let hits: DrumHit[] = groove.hits;
    let filled = false;
    const endsPlan = planOf[k + 1] !== planIndex;
    const halfChoice = random.int(style.fills.half.length);
    const barChoice = random.int(style.fills.bar.length);
    if (endsPlan && plan.fill) {
      if (plan.energy <= HALF_FILL_MAX_ENERGY) {
        const middle = groove.steps / 2;
        hits = [...groove.hits.filter((hit) => hit.step < middle), ...style.fills.half[halfChoice].hits.filter((hit) => hit.step >= middle)];
      } else {
        hits = style.fills.bar[barChoice].hits;
      }
      filled = true;
    }

    const sectionCrash = newPlan && settings.crashOnSections && plan.energy >= CRASH_MIN_ENERGY;
    if ((sectionCrash || crashAfterFill) && !hits.some((hit) => hit.step === 0 && hit.pitch === CRASH)) {
      hits = [...hits, { step: 0, pitch: CRASH, velocity: CRASH_VELOCITY }];
    }
    afterFill = filled;

    const hitRandom = createRandom(barSeed(seed, k));
    for (const hit of hits) {
      if (hit.ghost && !settings.ghostNotes) continue;
      if (hit.optional && settings.complexity < 0.5 && hitRandom.next() >= settings.complexity * 2) continue;

      const scaled = hit.step * perBar;
      const beatOffset = Math.floor(scaled / groove.steps);
      const beat = start + beatOffset;
      if (beat >= beats.length) continue;
      const fraction = (scaled - beatOffset * groove.steps) / groove.steps;
      emit(timeIn(beats, beat, fraction + swingDelay(style, fraction, settings.swing)), hit.pitch, hit.velocity);
    }
  }

  return notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
}
