// Choose a close-position hand shape whose voices travel as little as possible.
import { fifthInterval, pitchClass, SEVENTH, THIRD } from "./chord-tones";
import type { ParsedChord } from "./harmony";
import type { KeysRegister, KeysSettings } from "./keys-types";

export const KEYS_RANGE: Record<KeysRegister, readonly [number, number]> = { low: [48, 60], mid: [52, 76], high: [60, 84] };

function noteClasses(chord: ParsedChord, extensions: boolean): number[] {
  const intervals = [0, THIRD[chord.quality], fifthInterval(chord.quality)];
  if (extensions) {
    intervals.push(SEVENTH[chord.seventh]);
    const quality = chord.name.split("/")[0].replace(/^[A-Ga-g][#♯b♭]?/, "");
    if (/(?:add)?9/.test(quality)) intervals.push(/b9/.test(quality) ? 1 : /[#♯]9/.test(quality) ? 3 : 2);
  }
  return [...new Set(intervals.flatMap((interval) => interval === null ? [] : [pitchClass(chord.root + interval)]))];
}

/** Enumerate only notes of this chord and keep every inversion inside the register. */
export function rightHand(chord: ParsedChord, settings: Pick<KeysSettings, "voices" | "extensions" | "register">, previous: readonly number[] = []): number[] {
  const [low, high] = KEYS_RANGE[settings.register];
  const classes = noteClasses(chord, settings.extensions);
  // The fit can favor the seventh or ninth over the fifth when there are more chord tones than fingers.
  const fifth = pitchClass(chord.root + fifthInterval(chord.quality));
  const essential = classes.length > settings.voices ? classes.filter((pc) => pc !== fifth).slice(-settings.voices) : classes;
  const candidates = Array.from({ length: high - low + 1 }, (_, i) => low + i).filter((note) => classes.includes(pitchClass(note)));
  const count = Math.min(settings.voices, candidates.length);
  if (!count) return [];
  const centre = (low + high) / 2;
  let best: number[] = [];
  let cost = Infinity;
  const pick = (notes: number[], next: number): void => {
    if (notes.length === count) {
      const set = new Set(notes.map(pitchClass));
      const missing = essential.filter((pc) => !set.has(pc)).length;
      const travel = previous.length
        ? notes.reduce((sum, note, i) => sum + Math.abs(note - (previous[i] ?? previous.at(-1)!)), 0)
        : notes.reduce((sum, note) => sum + Math.abs(note - centre), 0);
      const held = notes.filter((note) => previous.includes(note)).length;
      const score = missing * 50 + travel - held * 2 + (notes.at(-1)! - notes[0]) * 0.05;
      if (score < cost) { best = notes; cost = score; }
      return;
    }
    for (let i = next; i < candidates.length; i++) pick([...notes, candidates[i]], i + 1);
  };
  pick([], 0);
  return best;
}

export function leftHand(chord: ParsedChord, choice: Exclude<KeysSettings["left"], "style">, previous?: number): number[] {
  if (choice === "rest") return [];
  const anchor = previous ?? 42;
  const roots = Array.from({ length: 13 }, (_, i) => 36 + i).filter((note) => pitchClass(note) === chord.bass);
  const root = roots.sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))[0];
  if (choice === "root-octave") return [root, root + 12];
  if (choice === "root-fifth") return [root, root + (chord.bass === chord.root ? fifthInterval(chord.quality) : 7)];
  return [root];
}
