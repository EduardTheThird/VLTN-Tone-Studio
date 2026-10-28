import { describe, expect, it } from "vitest";
import { DRUM_PAN, PEAK_LIMIT, panGains, renderPart } from "./render";
import { CLOSED_HAT, KICK, OPEN_HAT, SNARE, type NoteEvent } from "./note";
import { pickDrumSample, type BassSample, type DrumLayer, type SampleSet } from "./samples";
import type { PcmAudio } from "../types";

const RATE = 44100;
const CENTRE = panGains(0)[0];

const hit = (time: number, pitch: number, velocity = 100, duration = 0.1): NoteEvent => ({ time, pitch, velocity, duration });

/** One sample frame at `amplitude`, then silence. */
const impulse = (amplitude = 1, length = 64): PcmAudio => {
  const channel = new Float32Array(length);
  channel[0] = amplitude;
  return { sampleRate: RATE, channels: [channel] };
};

const constant = (value: number, length: number): PcmAudio => ({ sampleRate: RATE, channels: [new Float32Array(length).fill(value)] });

const sine = (hz: number, seconds: number): PcmAudio => {
  const channel = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < channel.length; i++) channel[i] = Math.sin((2 * Math.PI * hz * i) / RATE);
  return { sampleRate: RATE, channels: [channel] };
};

const layer = (audio: PcmAudio, velocity: [number, number] = [1, 127], nominal = 100, transpose = 0): DrumLayer => ({ velocity, nominal, transpose, audio });

const bass = (root: number, audio: PcmAudio): BassSample => ({ root, layer: "p", velocity: [1, 127], audio });

function kit(drums: Partial<Record<number, DrumLayer[]>>, basses: BassSample[] = []): SampleSet {
  return { drums: new Map(Object.entries(drums).map(([pitch, layers]) => [Number(pitch), layers ?? []])), bass: basses };
}

function indexOfPeak(channel: Float32Array): number {
  let best = 0;
  for (let i = 1; i < channel.length; i++) if (Math.abs(channel[i]) > Math.abs(channel[best])) best = i;
  return best;
}

function peak(channel: Float32Array): number {
  let max = 0;
  for (let i = 0; i < channel.length; i++) max = Math.max(max, Math.abs(channel[i]));
  return max;
}

/** How many times the signal crosses zero in [from, to). A sine at f Hz crosses 2f times a second. */
function crossings(channel: Float32Array, from: number, to: number): number {
  let count = 0;
  for (let i = from + 1; i < to; i++) if (channel[i - 1] < 0 !== channel[i] < 0) count++;
  return count;
}

describe("renderPart: drums", () => {
  it("renders a hit at its time, to within one sample", () => {
    const { audio } = renderPart([hit(0.5, KICK)], "drums", kit({ [KICK]: [layer(impulse(1))] }), RATE * 2);
    expect(Math.abs(indexOfPeak(audio.channels[0]) - 22050)).toBeLessThanOrEqual(1);
  });

  it("chooses the velocity layer and gain the picker chooses", () => {
    const soft = impulse(0.2);
    const hard = impulse(1);
    const drums = kit({ [KICK]: [layer(soft, [1, 62], 40), layer(hard, [63, 127], 100)] });

    const picked = pickDrumSample(drums, KICK, 50);
    expect(picked.audio).toBe(soft);
    expect(picked.gain).toBeCloseTo(50 / 40);
    const quiet = renderPart([hit(0, KICK, 50)], "drums", drums, 1000).audio.channels[0][0];
    expect(quiet).toBeCloseTo(0.2 * (50 / 40) * CENTRE, 6);

    const loud = renderPart([hit(0, KICK, 100)], "drums", drums, 1000).audio.channels[0][0];
    expect(loud).toBeCloseTo(1 * CENTRE, 6);
  });

  it("outputs exactly lengthFrames, and drops hits past the end", () => {
    const drums = kit({ [SNARE]: [layer(impulse(1))] });
    const { audio } = renderPart([hit(0.1, SNARE), hit(10, SNARE)], "drums", drums, 1000);
    expect(audio.channels).toHaveLength(2);
    expect(audio.channels[0]).toHaveLength(1000);
    expect(audio.channels[1]).toHaveLength(1000);
  });

  it("limits the peak to -1 dBFS and reports the factor when many loud hits overlap", () => {
    const notes = Array.from({ length: 200 }, () => hit(0, KICK, 127));
    const { audio, gain } = renderPart(notes, "drums", kit({ [KICK]: [layer(impulse(1))] }), 4410);
    const peakOut = Math.max(peak(audio.channels[0]), peak(audio.channels[1]));
    expect(peakOut).toBeCloseTo(PEAK_LIMIT, 5);
    expect(20 * Math.log10(peakOut)).toBeCloseTo(-1, 3);
    expect(gain).toBeLessThan(1);
  });

  it("leaves a quiet part unscaled and reports a gain of 1", () => {
    const { audio, gain } = renderPart([hit(0, KICK, 100)], "drums", kit({ [KICK]: [layer(impulse(1))] }), 100);
    expect(gain).toBe(1);
    expect(audio.channels[0][0]).toBeCloseTo(CENTRE, 6);
  });

  it("chokes a ringing open hat when a closed hat plays", () => {
    const drums = kit({ [OPEN_HAT]: [layer(constant(0.5, RATE))], [CLOSED_HAT]: [layer(constant(0, 8))] });
    const { audio } = renderPart([hit(0, OPEN_HAT, 100, 0.5), hit(0.2, CLOSED_HAT)], "drums", drums, RATE);
    const left = audio.channels[0];
    const chokeFrame = Math.round(0.2 * RATE);
    expect(Math.abs(left[chokeFrame - 10])).toBeGreaterThan(0.1);
    // Halfway through the 10 ms fade the hat is about half as loud as it was just before the choke.
    expect(Math.abs(left[chokeFrame + 220]) / Math.abs(left[chokeFrame - 1])).toBeCloseTo(0.5, 1);
    expect(Math.abs(left[chokeFrame + 441 + 2])).toBeLessThan(1e-6);
  });

  it("lets an open hat ring when nothing chokes it", () => {
    const drums = kit({ [OPEN_HAT]: [layer(constant(0.5, RATE))] });
    const { audio } = renderPart([hit(0, OPEN_HAT, 100, 0.5)], "drums", drums, RATE);
    expect(Math.abs(audio.channels[0][Math.round(0.9 * RATE)])).toBeGreaterThan(0.1);
  });

  it("pans a hat to the right, and the kick to the centre", () => {
    const drums = kit({ [CLOSED_HAT]: [layer(impulse(1))], [KICK]: [layer(impulse(1))] });
    const hat = renderPart([hit(0, CLOSED_HAT)], "drums", drums, 100).audio;
    expect(hat.channels[1][0]).toBeGreaterThan(hat.channels[0][0]);
    const [left, right] = panGains(DRUM_PAN[CLOSED_HAT]);
    expect(hat.channels[0][0]).toBeCloseTo(left, 6);
    expect(hat.channels[1][0]).toBeCloseTo(right, 6);

    const kick = renderPart([hit(0, KICK)], "drums", drums, 100).audio;
    expect(kick.channels[0][0]).toBeCloseTo(kick.channels[1][0], 6);
  });

  it("transposes a sample by resampling it", () => {
    // A 110 Hz sine played up an octave sounds at 220 Hz: about 220 zero crossings in half a second. The sample is two seconds long,
    // so it still sounds for the whole window.
    const drums = kit({ [SNARE]: [layer(sine(110, 2), [1, 127], 100, 12)] });
    const left = renderPart([hit(0, SNARE, 100, 1)], "drums", drums, RATE).audio.channels[0];
    expect(Math.abs(crossings(left, Math.round(0.1 * RATE), Math.round(0.6 * RATE)) - 220)).toBeLessThanOrEqual(4);
  });
});

describe("renderPart: bass", () => {
  it("holds a monophonic line: a new note fades out the one before it", () => {
    const bassKit = kit({}, [bass(45, constant(0.5, RATE * 2)), bass(47, constant(0.25, RATE * 2))]);
    const notes: NoteEvent[] = [hit(0, 45, 100, 1), hit(0.2, 47, 100, 0.5)];
    const left = renderPart(notes, "bass", bassKit, RATE).audio.channels[0];
    expect(left[Math.round(0.1 * RATE)]).toBeCloseTo(0.5 * CENTRE, 4);
    // Past the 10 ms cut, only the second note is sounding.
    expect(left[Math.round(0.2 * RATE) + 441 + 20]).toBeCloseTo(0.25 * CENTRE, 4);
  });

  it("releases a note over 30 ms after its duration", () => {
    const bassKit = kit({}, [bass(45, constant(0.5, RATE * 2))]);
    const left = renderPart([hit(0, 45, 100, 0.5)], "bass", bassKit, RATE).audio.channels[0];
    expect(left[Math.round(0.5 * RATE) - 10]).toBeCloseTo(0.5 * CENTRE, 4);
    expect(left[Math.round(0.5 * RATE) + Math.round(0.03 * RATE) + 2]).toBe(0);
  });

  it("is centred: the same level in both channels", () => {
    const bassKit = kit({}, [bass(45, constant(0.5, RATE))]);
    const { audio } = renderPart([hit(0, 45)], "bass", bassKit, 1000);
    expect(audio.channels[0][0]).toBeCloseTo(audio.channels[1][0], 6);
  });

  it("plays a pitch above its sample's root by changing the playback rate", () => {
    // The sample is 110 Hz at its root, 45. Note 57 is 12 semitones above it, so the rate doubles: 220 Hz.
    const bassKit = kit({}, [bass(45, sine(110, 3))]);
    const left = renderPart([hit(0, 57, 100, 1)], "bass", bassKit, RATE).audio.channels[0];
    expect(Math.abs(crossings(left, Math.round(0.1 * RATE), Math.round(0.6 * RATE)) - 220)).toBeLessThanOrEqual(4);
  });
});
