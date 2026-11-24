import { isChorusName, type BandSettings, type SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { endingBar, endingShape } from "./ending";
import { bassRhythmFromAccents, isAccented, type Feel } from "./feel";
import { parseChordName, type ChordAtBeat, type ParsedChord } from "./harmony";
import { DEFAULT_KEYS, type KeysInstrument, type KeysPart, type KeysSettings } from "./keys-types";
import { leftHand, rightHand } from "./keys-voicing";
import { marksByBar, withMarkStops } from "./marks";
import type { NoteEvent } from "./note";
import { variationSeed } from "./bass-phrases";
import { createRandom } from "./random";
import { findStyle } from "./styles";
import { defaultKeysInstrument } from "./styles/keys-patterns";
import { barEnd, barSpans, fitStepsToBar, patternBeats, planOfBar, stepAt, stretchesToBar } from "./timing";

export const KEYS_STREAM = 0x6b657973;
const VELOCITIES = [0, 55, 67, 81, 93, 108] as const;

export function keysInstrument(plan: SectionPlan, settings: KeysSettings = DEFAULT_KEYS): KeysInstrument {
  return settings.sound === "auto" ? defaultKeysInstrument(plan.style) : settings.sound;
}

function partFor(plan: SectionPlan): Exclude<KeysPart, "auto"> {
  if (plan.keysPart && plan.keysPart !== "auto") return plan.keysPart;
  if (/intro|outro/i.test(plan.name) || plan.energy === 1) return "pad";
  if (plan.style === "reggae") return "stabs";
  if ((plan.style === "six-eight" || plan.style === "ballad") && plan.energy === 3) return "arp";
  return isChorusName(plan.name) || plan.energy >= 3 ? "comp" : "pad";
}

/** Chord and rhythm streams are independent of the other band players. */
export function generateKeys(grid: BeatGrid, harmony: readonly ChordAtBeat[], plans: readonly SectionPlan[], settings: BandSettings, seed: number, feel?: Feel, trimEnd?: number): NoteEvent[] {
  const { beats } = grid;
  const spans = barSpans(grid);
  const options = settings.keys ?? DEFAULT_KEYS;
  const chords = new Map(harmony.map(({ beat, chord }) => [beat, chord]));
  const marked = marksByBar(grid, settings.marks).byBar;
  const following = withMarkStops(grid, marked, feel);
  const endingPlans = plans.map((plan) => ({ ...plan, play: { ...plan.play, drums: false, bass: !!plan.play.keys && partFor(plan) !== "rest" } }));
  const finalBar = endingBar(grid, endingPlans, settings.ending, trimEnd);
  const ending = finalBar < 0 ? undefined : endingShape(grid, finalBar, settings.ending);
  const notes: NoteEvent[] = [];
  let lastPlan = -1;
  let previousChord: ParsedChord | null = null;
  let right: number[] = [];
  let left: number[] = [];

  for (const [bar, span] of spans.entries()) {
    const index = planOfBar(plans, beats, span);
    const plan = plans[index];
    if (!plan?.play.keys) continue;
    const part = partFor(plan);
    const style = findStyle(plan.style);
    if (!style || part === "rest") continue;
    if (lastPlan !== index) {
      lastPlan = index;
      previousChord = null;
      right = [];
      left = [];
    }

    const end = barEnd(beats, span.start, span.beats);
    const bareHit = marked.get(bar)?.some((mark) => mark.kind === "hit");
    const division = style.meter.stepsPerBeat;
    const gridDivision = stretchesToBar(style) ? style.meter.beatsPerBar * division / span.beats : division;
    const patterns = style.keys[plan.busy];
    const random = createRandom(variationSeed((plan.seed ?? seed) ^ KEYS_STREAM, "keys", span.start));
    const variation = random.pick(patterns);
    const mapSteps = (steps: number[]): number[] =>
      fitStepsToBar(steps.map((step) => ({ step })), style.meter.beatsPerBar * division, patternBeats(style, span.beats), span.beats).map(({ step }) => step);
    const accent = following?.profiles[index];
    const rightSteps = part === "pad" ? [0] : part === "arp" ? mapSteps(Array.from({ length: style.meter.beatsPerBar * 2 }, (_, i) => Math.round(i * division / 2)))
      : isAccented(accent) && !stretchesToBar(style) ? bassRhythmFromAccents(accent.weights, division, span.beats) : mapSteps(variation.right);
    const leftSteps = part === "pad" ? [0] : mapSteps(variation.left);
    const changeSteps = [];
    for (let beat = 1; beat < span.beats; beat++) {
      const index = span.start + beat;
      if (chords.get(index)?.name !== chords.get(index - 1)?.name || following?.hits.has(index)) changeSteps.push(beat * gridDivision);
    }
    const instrument = keysInstrument(plan, options);
    const octave = (plan.keysOctave ?? 0) * 12;
    const leftChoice = options.left === "style" ? (part === "pad" ? "root-octave" : plan.style === "reggae" ? "rest" : "root") : options.left;
    const emit = (pitches: number[], time: number, duration: number, velocity: number): void => {
      for (const pitch of pitches) notes.push({ time, pitch: pitch + octave, velocity, duration, instrument });
    };

    const steps = bareHit || (bar === finalBar && ending?.replacesBar) ? [0] : [...new Set([...rightSteps, ...leftSteps, ...changeSteps])].sort((a, b) => a - b);
    for (const step of steps) {
      const { beat, time } = stepAt(beats, style, span.start, step, span.beats, settings.swing);
      const chord = chords.get(beat);
      if (!chord || beat >= beats.length || following?.stops.has(beat)) {
        previousChord = null;
        continue;
      }
      const changed = previousChord?.name !== chord.name;
      if (changed) {
        right = rightHand(chord, options, right);
        left = leftHand(parseChordName(chord.name) ?? chord, leftChoice, left[0]);
        previousChord = chord;
      }
      let nextStop = beat + 1;
      while (nextStop < span.start + span.beats && chords.get(nextStop)?.name === chord.name && !following?.stops.has(nextStop)) nextStop++;
      const hit = bareHit || following?.hits.has(beat) || (bar === finalBar && ending?.replacesBar);
      const tail = nextStop >= span.start + span.beats ? end : beats[nextStop];
      const jitter = settings.humanise.amount * (random.next() - 0.5) * 0.008;
      const start = Math.max(beats[span.start], time + jitter);
      const gate = part === "stabs" ? 0.3 : part === "pad" ? 1 : variation.gate;
      const durationOf = (steps: number[]) => {
        if (bareHit) return Math.min(0.16, tail - start);
        const next = steps.find((at) => at > step);
        const nextTime = next === undefined ? tail : Math.min(tail, stepAt(beats, style, span.start, next, span.beats, settings.swing).time);
        return Math.max(0.035, (nextTime - start) * gate);
      };
      const velocity = VELOCITIES[plan.loud] + random.int(5) - 2;
      if (rightSteps.includes(step) || changed || hit) {
        const pitches = part === "arp" && right.length ? [right[Math.floor(step * 2 / division) % right.length]] : right;
        emit(pitches, start, durationOf(rightSteps), velocity - 6);
      }
      if (leftSteps.includes(step) || changed || hit) emit(left, start, durationOf(leftSteps), velocity);
    }
    if (bar === finalBar && ending && settings.ending.kind !== "hit" && previousChord) {
      emit(left, ending.final, ending.ring, VELOCITIES[plan.loud]);
      emit(right, ending.final, ending.ring, VELOCITIES[plan.loud] - 6);
    }
  }
  return notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
}
