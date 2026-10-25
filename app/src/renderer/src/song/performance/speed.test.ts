import { describe, expect, it } from "vitest";
import {
  CAPO_MAX,
  DEFAULT_SPEED,
  chordDisplayTranspose,
  clampCapo,
  clampCents,
  clampRate,
  clampSemitones,
  effectiveBpm,
  followsPitch,
  pitchRatio,
  storedSpeed,
  transposeChordName,
} from "./speed";

describe("clampRate", () => {
  it("keeps the rate between 50% and 150%", () => {
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(2)).toBe(1.5);
    expect(clampRate(0.8)).toBe(0.8);
  });

  it("plays at the song's own speed when the value is not a number", () => {
    expect(clampRate(undefined)).toBe(1);
    expect(clampRate(Number.NaN)).toBe(1);
  });
});

describe("pitch limits", () => {
  it("keeps semitones whole and within six either way", () => {
    expect(clampSemitones(7.4)).toBe(6);
    expect(clampSemitones(-9)).toBe(-6);
    expect(clampSemitones(-2.6)).toBe(-3);
    expect(clampSemitones("x")).toBe(0);
  });

  it("keeps the fine tune within fifty cents", () => {
    expect(clampCents(80)).toBe(50);
    expect(clampCents(-12.2)).toBe(-12);
  });

  it("gives a frequency ratio of one at no shift and two for an octave", () => {
    expect(pitchRatio(0)).toBe(1);
    expect(pitchRatio(12)).toBeCloseTo(2);
    expect(pitchRatio(0, 100)).toBeCloseTo(pitchRatio(1));
  });
});

describe("effectiveBpm", () => {
  it("scales the written tempo by the rate", () => {
    expect(effectiveBpm(120, 0.75)).toBeCloseTo(90);
    expect(effectiveBpm(100, 1.5)).toBeCloseTo(150);
  });

  it("stays unusable when the tempo is", () => {
    expect(effectiveBpm(0, 1)).toBe(0);
    expect(effectiveBpm(Number.NaN, 1)).toBe(0);
  });
});

describe("capo and chord transposition", () => {
  it("lowers the shapes by the capo, and follows the pitch only when asked", () => {
    expect(chordDisplayTranspose(2, 3, true)).toBe(-1);
    expect(chordDisplayTranspose(2, 3, false)).toBe(-3);
    expect(chordDisplayTranspose(0, 0, true)).toBe(0);
  });

  it("keeps the capo between 0 and its maximum", () => {
    expect(clampCapo(CAPO_MAX + 3)).toBe(CAPO_MAX);
    expect(clampCapo(-1)).toBe(0);
  });

  it("moves a chord root and keeps its quality", () => {
    expect(transposeChordName("Am7", 2)).toBe("Bm7");
    expect(transposeChordName("F#m", 1)).toBe("Gm");
    expect(transposeChordName("C", -1)).toBe("B");
    expect(transposeChordName("Esus4", 12)).toBe("Esus4");
  });

  it("keeps a flat spelling where the chord used one", () => {
    expect(transposeChordName("Bb", 2)).toBe("C");
    expect(transposeChordName("Eb", 1)).toBe("E");
    expect(transposeChordName("Ab", -1)).toBe("G");
    expect(transposeChordName("Bb", 1)).toBe("B");
  });

  it("moves the bass of a slash chord too", () => {
    expect(transposeChordName("G/B", 1)).toBe("G#/C");
    expect(transposeChordName("C/E", -2)).toBe("A#/D");
  });

  it("never changes the no-chord mark or a name it cannot read", () => {
    expect(transposeChordName("N", 5)).toBe("N");
    expect(transposeChordName("x/y/z", 3)).toBe("x/y/z");
  });

  it("leaves a name unchanged at no shift", () => {
    expect(transposeChordName("G#m", 0)).toBe("G#m");
  });
});

describe("stored speed settings", () => {
  it("reads defaults from an empty song", () => {
    expect(storedSpeed({})).toEqual(DEFAULT_SPEED);
  });

  it("clamps what is stored and keeps only boolean track choices", () => {
    const stored = storedSpeed({ speed: 3, semitones: 9.4, cents: -80, capo: 12, applyToChords: true, followsPitch: { bass: false, drums: "yes", Bad: true } });
    expect(stored).toEqual({ rate: 1.5, semitones: 6, cents: -50, capo: 7, applyToChords: true, followsPitch: { bass: false } });
  });

  it("gives drums their own default and lets a track's choice override it", () => {
    expect(followsPitch(DEFAULT_SPEED, "drums")).toBe(false);
    expect(followsPitch(DEFAULT_SPEED, "vocals")).toBe(true);
    expect(followsPitch({ followsPitch: { drums: true, vocals: false } }, "drums")).toBe(true);
    expect(followsPitch({ followsPitch: { vocals: false } }, "vocals")).toBe(false);
  });
});
