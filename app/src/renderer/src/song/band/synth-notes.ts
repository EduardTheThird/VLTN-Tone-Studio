import { isChorusName, type BandSettings, type SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { type Feel } from "./feel";
import type { ChordAtBeat } from "./harmony";
import { generateKeys } from "./keys";
import { DEFAULT_KEYS } from "./keys-types";
import { rightHand } from "./keys-voicing";
import { marksByBar, withMarkStops } from "./marks";
import type { NoteEvent } from "./note";
import type { SynthMode } from "./synth-presets";
import { beatSpan, planIndexAt } from "./timing";

export function synthPart(plan: SectionPlan): SynthMode | "rest" {
  if (plan.synthPart && plan.synthPart !== "auto") return plan.synthPart;
  return isChorusName(plan.name) || /bridge/i.test(plan.name) ? "pad" : "rest";
}

export function generateSynth(grid: BeatGrid, harmony: readonly ChordAtBeat[], plans: readonly SectionPlan[], settings: BandSettings, seed: number, feel?: Feel, trimEnd?: number): NoteEvent[] {
  const sectionMode = plans.map((plan) => plan.play.synth ? synthPart(plan) : "rest");
  const marked = marksByBar(grid, settings.marks).byBar;
  const follow = withMarkStops(grid, marked, feel);
  const notes: NoteEvent[] = [];
  if (sectionMode.includes("stabs")) {
    const stabs = plans.map((plan, i): SectionPlan => ({
      ...plan, keysPart: "stabs", keysOctave: 0, play: { ...plan.play, keys: sectionMode[i] === "stabs" },
    }));
    for (const { instrument: _, ...note } of generateKeys(grid, harmony, stabs, { ...settings, keys: { ...DEFAULT_KEYS, voices: 4, left: "rest" } }, seed ^ 0x9b053318, feel, trimEnd)) {
      notes.push({ ...note, synthMode: "stabs" });
    }
  }

  let lastPlan = -1;
  let chordName = "";
  let voicing: number[] = [];
  let held: NoteEvent[] = [];
  for (const { beat, time, chord } of harmony) {
    const i = planIndexAt(plans, time);
    const plan = plans[i];
    if (lastPlan !== i) { voicing = []; chordName = ""; held = []; lastPlan = i; }
    const mode = sectionMode[i];
    if (!plan || !chord || mode === "rest" || mode === "stabs" || follow?.stops.has(beat)) {
      chordName = "";
      held = [];
      continue;
    }
    const fullBeat = Math.min(beatSpan(grid.beats, beat), plan.end - time, (trimEnd ?? Infinity) - time);
    if (fullBeat <= 0) continue;
    if (chordName !== chord.name || follow?.hits.has(beat)) {
      voicing = rightHand(chord, { ...DEFAULT_KEYS, voices: 4 }, voicing);
      chordName = chord.name;
      held = [];
    }
    const velocity = 46 + plan.loud * 10;
    if (mode === "pulse") {
      for (const fraction of [0, 0.5]) for (const pitch of voicing) notes.push({
        time: time + fullBeat * fraction, pitch, velocity, duration: fullBeat * 0.31, synthMode: mode,
      });
    } else if (held.length) {
      for (const note of held) note.duration = time + fullBeat - note.time;
    } else {
      held = voicing.map((pitch) => ({ time, pitch, velocity, duration: fullBeat, synthMode: mode }));
      notes.push(...held);
    }
  }
  return notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
}
