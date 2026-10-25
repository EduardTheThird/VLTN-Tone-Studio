import { describe, expect, it } from "vitest";
import { integratedLoudness, loudnessFromOptions, normalisingGain, NORMALISE_GAIN_MAX, withLoudness } from "./loudness";

const RATE = 44100;

/** A stereo sine of `seconds` at `amplitude` and 1 kHz. */
function sine(amplitude: number, seconds: number): Float32Array[] {
  const frames = Math.round(seconds * RATE);
  const channel = Float32Array.from({ length: frames }, (_, i) => amplitude * Math.sin((2 * Math.PI * 1000 * i) / RATE));
  return [channel, channel.slice()];
}

describe("integrated loudness", () => {
  it("measures a 1 kHz sine at the level BS.1770 gives it", () => {
    // A stereo sine at amplitude A has a mean square of A² / 2 per channel, so -0.691 + 10·log10(A²) before weighting. The K-weighting
    // adds about 0.7 dB at 1 kHz, which puts -20 dB of amplitude at -20 LUFS.
    expect(integratedLoudness(sine(0.1, 10), RATE)).toBeCloseTo(-20, 1);
  });

  it("rises by 6 dB when the amplitude doubles", () => {
    const quiet = integratedLoudness(sine(0.05, 10), RATE);
    const loud = integratedLoudness(sine(0.1, 10), RATE);
    expect(loud - quiet).toBeCloseTo(6.02, 1);
  });

  it("is -Infinity for silence", () => {
    expect(integratedLoudness([new Float32Array(RATE * 2), new Float32Array(RATE * 2)], RATE)).toBe(-Infinity);
  });

  it("leaves out quiet passages, so a quiet tail does not pull the level down", () => {
    const loud = sine(0.1, 5);
    const quiet = sine(0.00001, 5);
    const joined = [Float32Array.from([...loud[0], ...quiet[0]]), Float32Array.from([...loud[1], ...quiet[1]])];
    // The block that straddles the join is loud enough to pass the gates, so the level moves by a fraction of a decibel, not more.
    expect(Math.abs(integratedLoudness(joined, RATE) - integratedLoudness(loud, RATE))).toBeLessThan(0.2);
  });

  it("gives the same answer however the channels are split between mono and stereo of the same signal", () => {
    const [left] = sine(0.1, 4);
    expect(integratedLoudness([left], RATE)).toBeCloseTo(integratedLoudness([left, left.slice()], RATE) - 3.01, 1);
  });
});

describe("normalising gain", () => {
  it("is 1 for a song already at the target", () => {
    expect(normalisingGain(-14)).toBeCloseTo(1, 10);
  });

  it("raises a quiet song to the target", () => {
    expect(normalisingGain(-20)).toBeCloseTo(10 ** (6 / 20), 10);
  });

  it("lowers a loud song to the target", () => {
    expect(normalisingGain(-8)).toBeCloseTo(10 ** (-6 / 20), 10);
  });

  it("never raises a song by more than the limit, and leaves silence alone", () => {
    expect(normalisingGain(-40)).toBe(NORMALISE_GAIN_MAX);
    expect(normalisingGain(-Infinity)).toBe(1);
  });
});

describe("a song's stored loudness", () => {
  it("reads a measured level and whether the song is normalised", () => {
    expect(loudnessFromOptions('{"songLufs":-17.5,"normaliseSong":true,"shift":2}')).toEqual({ lufs: -17.5, normalise: true });
  });

  it("reads a song that has not been measured as not measured, and not normalised", () => {
    expect(loudnessFromOptions("")).toEqual({ lufs: null, normalise: false });
    expect(loudnessFromOptions("{broken")).toEqual({ lufs: null, normalise: false });
    expect(loudnessFromOptions('{"songLufs":"loud"}')).toEqual({ lufs: null, normalise: false });
  });

  it("writes the loudness in and keeps the rest of the options", () => {
    const written = JSON.parse(withLoudness('{"shift":2,"songLufs":-30}', { lufs: -16, normalise: true }));
    expect(written).toEqual({ shift: 2, songLufs: -16, normaliseSong: true });
    expect(JSON.parse(withLoudness('{"songLufs":-16,"normaliseSong":true}', { lufs: null, normalise: false }))).toEqual({ normaliseSong: false });
  });
});
