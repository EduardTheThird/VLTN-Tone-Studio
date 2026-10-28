import { describe, expect, it } from "vitest";
import type { PcmAudio } from "../types";
import {
  detectBeatGrid,
  doubleTempo,
  estimateTempo,
  fitSteady,
  halveTempo,
  nudgeGrid,
  onsetStrength,
  pickDownbeat,
  shiftDownbeat,
  trackBeats,
  type BeatGrid,
} from "./beat-grid";

const RATE = 44100;
const SECONDS = 30;
const FIRST_BEAT = 0.5;

/** Deterministic noise in −1..1, so a failing test reproduces the same audio. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 2 ** 32) * 2 - 1;
  };
}

interface Hit {
  at: number;
  amplitude: number;
  /** Decay time constant, in seconds */
  decay: number;
  /** A sine at this frequency instead of a noise burst: a low thump */
  tone?: number;
}

/** Renders hits onto a mono track over a quiet floor. Noise bursts are broadband, like a stick hit, so the onset tracker can lock onto them. */
function render(hits: Hit[], seconds = SECONDS): PcmAudio {
  const out = new Float32Array(Math.round(seconds * RATE));
  const random = noise(7);
  for (let i = 0; i < out.length; i++) out[i] = 0.004 * random();
  for (const hit of hits) {
    const start = Math.round(hit.at * RATE);
    for (let i = 0; i < 0.3 * RATE && start + i < out.length; i++) {
      const t = i / RATE;
      const body = hit.tone ? Math.sin(2 * Math.PI * hit.tone * t) : random();
      out[start + i] += hit.amplitude * Math.exp(-t / hit.decay) * body;
    }
  }
  return { sampleRate: RATE, channels: [out] };
}

/** Click track: a noise burst on every beat, and a low thump on beats with index % thumpEvery === 0. */
function clickAudio(beats: number[], thumpEvery: number): PcmAudio {
  const hits: Hit[] = [];
  beats.forEach((at, i) => {
    hits.push({ at, amplitude: 0.5, decay: 0.012 });
    if (i % thumpEvery === 0) hits.push({ at, amplitude: 0.8, decay: 0.08, tone: 55 });
  });
  return render(hits);
}

/** Beats at a constant tempo, starting at FIRST_BEAT. */
function steadyBeats(bpm: number, seconds = SECONDS): number[] {
  const beats: number[] = [];
  for (let t = FIRST_BEAT; t < seconds - 0.5; t += 60 / bpm) beats.push(t);
  return beats;
}

/** Beats whose tempo moves linearly from `from` to `to` BPM over the clip. */
function driftBeats(from: number, to: number, seconds = SECONDS): number[] {
  const beats: number[] = [];
  for (let t = FIRST_BEAT; t < seconds - 0.5; t += 60 / (from + ((to - from) * t) / seconds)) beats.push(t);
  return beats;
}

/** Share of the true beats with a detected beat within `tolerance` seconds. */
function hitRate(detected: readonly number[], truth: readonly number[], tolerance = 0.07): number {
  const hits = truth.filter((t) => detected.some((d) => Math.abs(d - t) <= tolerance)).length;
  return hits / truth.length;
}

describe("onsetStrength", () => {
  it("returns one frame per hop, at the hop's frame rate, with no negative values", () => {
    const { onset, low, frameRate } = onsetStrength([render([{ at: 0.5, amplitude: 0.5, decay: 0.01 }], 2)], RATE);
    expect(frameRate).toBeCloseTo(RATE / 512, 6);
    expect(onset.length).toBe(Math.ceil((2 * RATE) / 512));
    expect(low.length).toBe(onset.length);
    expect(onset.every((v) => v >= 0)).toBe(true);
    expect(low.every((v) => v >= 0)).toBe(true);
  });

  it("returns empty curves for no audio", () => {
    expect(onsetStrength([], RATE).onset.length).toBe(0);
  });
});

describe("click track at 120 BPM", () => {
  const beats = steadyBeats(120);
  const truth = beats;
  const audio = clickAudio(beats, 4);

  it("tracks at least 95% of the beats within 70 ms, with the downbeat on the thump", () => {
    const grid = detectBeatGrid([audio], RATE, 4);
    expect(hitRate(grid.beats, truth)).toBeGreaterThanOrEqual(0.95);
    // The first true beat is a downbeat, so the grid's downbeat must land on a beat in that phase.
    const nearest = grid.beats.findIndex((b) => Math.abs(b - FIRST_BEAT) <= 0.07);
    expect(nearest).toBeGreaterThanOrEqual(0);
    expect((grid.downbeat - nearest + 400) % 4).toBe(0);
    expect(grid.bpm).toBeCloseTo(120, 0);
  });

  it("fits a steady line at 120 BPM that starts on the first click", () => {
    const { steady } = detectBeatGrid([audio], RATE, 4);
    expect(steady).not.toBeNull();
    expect(Math.abs(steady!.bpm - 120)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(steady!.firstBeat - FIRST_BEAT)).toBeLessThanOrEqual(0.02);
  });
});

describe("drift from 116 to 124 BPM", () => {
  const truth = driftBeats(116, 124);
  const audio = clickAudio(truth, 4);

  it("tracks at least 85% of the beats within 70 ms and does not call the song steady", () => {
    const grid = detectBeatGrid([audio], RATE, 4);
    expect(hitRate(grid.beats, truth)).toBeGreaterThanOrEqual(0.85);
    expect(grid.steady).toBeNull();
  });
});

describe("tempo candidates", () => {
  it("includes 150 BPM when the track is at 75 BPM", () => {
    const { onset, frameRate } = onsetStrength([clickAudio(steadyBeats(75), 4)], RATE);
    expect(estimateTempo(onset, frameRate).candidates).toEqual(expect.arrayContaining([expect.closeTo(150, 0)]));
  });

  it("includes 75 BPM when the track is at 150 BPM", () => {
    const { onset, frameRate } = onsetStrength([clickAudio(steadyBeats(150), 4)], RATE);
    expect(estimateTempo(onset, frameRate).candidates).toEqual(expect.arrayContaining([expect.closeTo(75, 0)]));
  });
});

describe("downbeat from chord changes", () => {
  it("moves the downbeat to a chord change when every beat has the same low thump", () => {
    const beats = steadyBeats(120);
    // Every beat has a thump, so the low band has no preference. The chord changes fall on beats 2, 6, 10 …
    const changes = beats.filter((_, i) => i % 4 === 2);
    const grid = detectBeatGrid([clickAudio(beats, 1)], RATE, 4, changes);
    expect(changes.some((c) => Math.abs(grid.beats[grid.downbeat] - c) <= 0.07)).toBe(true);
  });

  it("keeps the low-band choice when no chord change is given", () => {
    const beats = steadyBeats(120);
    const grid = detectBeatGrid([clickAudio(beats, 4)], RATE, 4);
    const nearest = grid.beats.findIndex((b) => Math.abs(b - FIRST_BEAT) <= 0.07);
    expect((grid.downbeat - nearest + 400) % 4).toBe(0);
  });
});

describe("pickDownbeat", () => {
  it("returns the phase with the most chord-change hits when low evidence is equal", () => {
    const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
    const flat = new Float64Array(400).fill(1);
    expect(pickDownbeat(beats, flat, 100, 4, [1.0, 3.0])).toBe(2);
  });

  it("returns 0 for no beats", () => {
    expect(pickDownbeat([], new Float64Array(10), 100, 4)).toBe(0);
  });
});

describe("fitSteady", () => {
  it("returns null for fewer than four beats or a drifting track", () => {
    expect(fitSteady([0, 0.5, 1])).toBeNull();
    expect(fitSteady([0, 0.5, 1.04, 1.5])).toBeNull();
  });

  it("returns the tempo and first beat of an exact line", () => {
    expect(fitSteady([1, 1.5, 2, 2.5])).toEqual({ bpm: 120, firstBeat: 1 });
  });
});

describe("trackBeats", () => {
  it("returns nothing for a silent or zero-tempo curve", () => {
    expect(trackBeats(new Float64Array(100), 86, 120)).toEqual([]);
    expect(trackBeats(new Float64Array(100).fill(1), 86, 0)).toEqual([]);
  });
});

describe("corrections", () => {
  const grid: BeatGrid = {
    beatsPerBar: 4,
    beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    downbeat: 1,
    bpm: 120,
    steady: { bpm: 120, firstBeat: 0 },
  };

  it("halves the tempo, keeping the downbeat's beat", () => {
    const halved = halveTempo(grid);
    expect(halved.beats).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(halved.beats[halved.downbeat]).toBe(0.5);
    expect(halved.bpm).toBeCloseTo(60, 6);
  });

  it("doubles the tempo, adding midpoints and keeping the downbeat's time", () => {
    const doubled = doubleTempo(grid);
    expect(doubled.beats).toHaveLength(15);
    expect(doubled.beats[doubled.downbeat]).toBe(0.5);
    expect(doubled.bpm).toBeCloseTo(240, 6);
  });

  it("moves the downbeat by one beat, wrapping within the bar", () => {
    expect(shiftDownbeat(grid, 1).downbeat).toBe(2);
    expect(shiftDownbeat(grid, -1).downbeat).toBe(0);
    expect(shiftDownbeat({ ...grid, downbeat: 0 }, -1).downbeat).toBe(3);
  });

  it("nudges by at most 0.1 s per call and never below zero", () => {
    const shifted = nudgeGrid({ ...grid, beats: [0.05, 0.55, 1.05] }, -5);
    expect(shifted.beats[0]).toBe(0);
    expect(shifted.beats[1]).toBeCloseTo(0.45, 9);
    expect(shifted.beats[2]).toBeCloseTo(0.95, 9);
    expect(nudgeGrid(grid, 0.5).beats[0]).toBeCloseTo(0.1, 9);
  });
});
