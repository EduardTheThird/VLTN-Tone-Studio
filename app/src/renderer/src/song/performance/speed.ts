// Speed and pitch, as the performance layer sees them (pure). A song plays at a rate `r` (0.5 to 1.5). At rate `r` a song second takes
// 1 / r audio seconds, so cues, lyrics and sections stay in song time while the clock and the MIDI tempo follow the effective BPM.
// The pitch is a separate setting that changes the sound and, when the chords follow it, the chord names. Neither one touches the
// song's own timeline, which is why the mapping lives here and not in the audio code.

/** The slowest and fastest rate a song may play at: 50% to 150% */
export const RATE_MIN = 0.5;
export const RATE_MAX = 1.5;
/** Pitch shift limits: whole semitones, plus a fine tune in cents */
export const PITCH_SEMITONES_MAX = 6;
export const PITCH_CENTS_MAX = 50;
/** The highest capo position a player can use */
export const CAPO_MAX = 7;

/** `value` as a rate, kept between RATE_MIN and RATE_MAX. A value that is not a number plays at the song's own speed. */
export function clampRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, value));
}

/** `value` as whole semitones within the shift limit. */
export function clampSemitones(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(PITCH_SEMITONES_MAX, Math.max(-PITCH_SEMITONES_MAX, Math.round(value)));
}

/** `value` as a fine tune in cents within the limit. */
export function clampCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(PITCH_CENTS_MAX, Math.max(-PITCH_CENTS_MAX, Math.round(value)));
}

/** `value` as a capo position, from 0 (none) to CAPO_MAX. */
export function clampCapo(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(CAPO_MAX, Math.max(0, Math.round(value)));
}

/** The frequency ratio for a pitch shift: 1 at no shift, 2 for an octave up. */
export function pitchRatio(semitones: number, cents = 0): number {
  return 2 ** ((semitones + cents / 100) / 12);
}

/**
 * The tempo a player hears: the song's BPM times the rate. The clock, the count-in and a tempo message all use it, so a song at 80%
 * sends and counts at 80% of its written tempo. A missing or unusable BPM stays unusable (0).
 */
export function effectiveBpm(bpm: number, rate: number): number {
  return Number.isFinite(bpm) && bpm > 0 ? bpm * clampRate(rate) : 0;
}

/**
 * The semitones the chord names shift by on screen. The chords follow the pitch shift only when `applyPitch` is on. The capo then
 * lowers the shapes the player plays: a capo at 2 shows the chord two semitones below the sounding one.
 */
export function chordDisplayTranspose(semitones: number, capo: number, applyPitch: boolean): number {
  return (applyPitch ? clampSemitones(semitones) : 0) - clampCapo(capo);
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ROOT = /^([A-G])([#b]?)(.*)$/;

/** Moves one note name (root, with an optional accidental) by `semitones`, keeping a flat spelling where the source used one. */
function transposeNote(root: string, accidental: string, semitones: number): string {
  const index = (NOTE_INDEX[root] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0) + semitones + 1200) % 12;
  return accidental === "b" ? FLAT_NAMES[index] : SHARP_NAMES[index];
}

/** One chord symbol (no bass) moved by `semitones`. Quality text such as "m7" or "sus4" is kept as written. */
function transposeSymbol(symbol: string, semitones: number): string {
  const match = ROOT.exec(symbol);
  if (!match) return symbol;
  const [, root, accidental, quality] = match;
  return transposeNote(root, accidental, semitones) + quality;
}

/**
 * A chord name moved by `semitones`, including a slash bass ("G/B" → "A/C#"). "N" (no chord) and names that do not parse are returned
 * unchanged, so nothing is ever invented.
 */
export function transposeChordName(name: string, semitones: number): string {
  if (!semitones || name === "N") return name;
  const [symbol, bass, ...rest] = name.split("/");
  if (rest.length) return name;
  const moved = transposeSymbol(symbol, semitones);
  return bass === undefined ? moved : `${moved}/${transposeSymbol(bass, semitones)}`;
}
