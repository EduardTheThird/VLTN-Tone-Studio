import { describe, expect, it } from "vitest";
import { stretchedLength, stretchPcm } from "./stretch";

const SR = 44100;

/** A sine at `hz` for `seconds`, as one channel. */
function tone(hz: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

/** Rising zero crossings per second, measured over the middle of the signal so the engine's start-up is not counted. */
function frequency(samples: Float32Array): number {
  const from = Math.floor(samples.length / 3),
    to = from + SR;
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
  return crossings;
}

describe("stretchedLength", () => {
  it("is the input length divided by the rate", () => {
    expect(stretchedLength(SR, 1)).toBe(SR);
    expect(stretchedLength(SR, 0.5)).toBe(2 * SR);
    expect(stretchedLength(SR, 1.5)).toBe(Math.round(SR / 1.5));
  });

  it("clamps the rate to the allowed range", () => {
    expect(stretchedLength(SR, 0.1)).toBe(2 * SR);
  });
});

describe("stretchPcm", () => {
  it("changes the length and keeps the pitch at a slower and a faster rate", () => {
    for (const rate of [0.5, 0.8, 1.25, 1.5]) {
      const out = stretchPcm({ sampleRate: SR, channels: [tone(440, 3)] }, { rate, semitones: 0, cents: 0 });
      expect(out.channels[0].length).toBe(stretchedLength(3 * SR, rate));
      expect(frequency(out.channels[0])).toBeCloseTo(440, -1);
    }
  });

  it("shifts the pitch without changing the length", () => {
    const out = stretchPcm({ sampleRate: SR, channels: [tone(440, 3)] }, { rate: 1, semitones: 3, cents: 0 });
    expect(out.channels[0].length).toBe(3 * SR);
    // 440 Hz up three semitones is about 523 Hz; three semitones and fifty cents is 3.5 semitones, about 539 Hz.
    expect(frequency(out.channels[0])).toBeCloseTo(523, -1);
    const fine = stretchPcm({ sampleRate: SR, channels: [tone(440, 3)] }, { rate: 1, semitones: 3, cents: 50 });
    expect(frequency(fine.channels[0])).toBeCloseTo(539, -1);
  });

  it("keeps mono as mono and stereo as stereo", () => {
    const mono = stretchPcm({ sampleRate: SR, channels: [tone(440, 1)] }, { rate: 0.8, semitones: 0, cents: 0 });
    expect(mono.channels).toHaveLength(1);
    const stereo = stretchPcm({ sampleRate: SR, channels: [tone(440, 1), tone(440, 1)] }, { rate: 0.8, semitones: 0, cents: 0 });
    expect(stereo.channels).toHaveLength(2);
    expect(stereo.sampleRate).toBe(SR);
  });

  it("keeps the end of the song rather than cutting it off", () => {
    const out = stretchPcm({ sampleRate: SR, channels: [tone(440, 2)] }, { rate: 1.5, semitones: 0, cents: 0 });
    const tail = out.channels[0].subarray(out.channels[0].length - SR / 10);
    expect(Math.max(...tail.map(Math.abs))).toBeGreaterThan(0.3);
  });

  it("returns silence for an empty stem", () => {
    const out = stretchPcm({ sampleRate: SR, channels: [new Float32Array(0)] }, { rate: 0.5, semitones: 0, cents: 0 });
    expect(out.channels[0]).toHaveLength(0);
  });
});
