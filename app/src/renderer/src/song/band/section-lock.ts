import { BAND_PARTS, type BandPart, type BandSettings, type SectionOverride, type SectionPlan } from "./arrangement";
import type { BandNoteSet } from "./band-job";
import { keysInstrument } from "./keys";
import { synthPart } from "./synth-notes";
import type { NoteEvent } from "./note";

export interface SectionLock {
  /** Start of the section when its last generated notes were captured. */
  start: number;
  engine: number;
  seed: number;
  plan: SectionOverride;
  notes: Partial<Record<BandPart, NoteEvent[]>>;
}

const inSection = (note: NoteEvent, span: Pick<SectionPlan, "start" | "end">): boolean =>
  note.time >= span.start && note.time < span.end;

/** Save the section's resolved settings and the actual notes so a different song seed or engine cannot redraw them. */
export function lockSection(plan: SectionPlan, notes: BandNoteSet, settings: BandSettings): SectionLock {
  const { name: _, sectionId: _section, start, end: _end, vamp: _vamp, locked: _locked, lock: _lock, lifted: _lifted, ...fields } = plan;
  const frozen: SectionLock["notes"] = {};
  for (const part of BAND_PARTS) {
    const source = notes[part];
    if (!source) continue;
    const selected = source.filter((note) => inSection(note, plan));
    frozen[part] = selected.map((note) => {
      if (part === "keys" && !note.instrument) return { ...note, instrument: keysInstrument(plan, settings.keys) };
      if (part === "synth" && !note.synthMode) {
        const mode = synthPart(plan);
        return mode === "rest" ? { ...note } : { ...note, synthMode: mode };
      }
      return { ...note };
    });
  }
  return { start, engine: settings.engine, seed: plan.seed ?? settings.seed, plan: fields, notes: frozen };
}

/** Locked notes replace generation in exactly that time span, rebased when a section is moved. */
export function keepLockedNotes(notes: BandNoteSet, plans: readonly SectionPlan[]): BandNoteSet {
  const locked = plans.filter((plan) => plan.locked && plan.lock);
  if (locked.length === 0) return notes;
  const kept = { ...notes };
  for (const part of BAND_PARTS) {
    const current = notes[part];
    if (!current) continue;
    const ordinary = current.filter((note) => !locked.some((plan) => inSection(note, plan)));
    for (const plan of locked) {
      const lock = plan.lock!;
      const delta = plan.start - lock.start;
      for (const note of lock.notes[part] ?? []) {
        const moved = delta ? { ...note, time: Math.max(0, note.time + delta) } : note;
        if (inSection(moved, plan)) ordinary.push(moved);
      }
    }
    kept[part] = ordinary.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  }
  return kept;
}

/** Copy level and playing choices. Section identity, loop mode and seeds belong to the destination. */
export function copySectionChoices(source: SectionOverride, target: SectionOverride): SectionOverride {
  const { seed: _, vamp: _vamp, sectionId: _id, start: _start, end: _end, locked: _locked, lock: _lock, ...values } = source;
  return { ...values, ...(target.seed !== undefined ? { seed: target.seed } : {}), ...(target.vamp ? { vamp: target.vamp } : {}) };
}
