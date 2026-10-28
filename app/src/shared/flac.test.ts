import { describe, expect, it } from "vitest";
import { decodeFlac, encodeFlac, quantize } from "./flac";

function tone(frames: number, offset: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = 0.6 * Math.sin((i + offset) / 17) + 0.2 * Math.sin((i + offset) / 211);
  return out;
}

describe("FLAC codec", () => {
  it("round-trips stereo audio bit-exactly at 24 bits", async () => {
    const channels = [tone(50000, 0), tone(50000, 400)];
    const decoded = await decodeFlac(await encodeFlac({ sampleRate: 44100, channels }));
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.channels).toHaveLength(2);
    for (let c = 0; c < 2; c++) {
      expect(decoded.channels[c]).toHaveLength(50000);
      for (let i = 0; i < 50000; i++) expect(Math.round(decoded.channels[c][i] * (2 ** 23 - 1))).toBe(quantize(channels[c][i]));
    }
  });

  it("keeps mono and sample rates", async () => {
    const decoded = await decodeFlac(await encodeFlac({ sampleRate: 48000, channels: [tone(9000, 3)] }));
    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.channels).toHaveLength(1);
  });

  it("clips out-of-range samples instead of wrapping", async () => {
    const decoded = await decodeFlac(await encodeFlac({ sampleRate: 44100, channels: [Float32Array.of(2, -2, 0.5, 0)] }));
    expect(Array.from(decoded.channels[0].slice(0, 2))).toEqual([1, -1]);
  });

  it("compresses a tonal signal well below raw float32", async () => {
    const channels = [tone(200000, 0), tone(200000, 90)];
    const bytes = await encodeFlac({ sampleRate: 44100, channels });
    expect(bytes.length).toBeLessThan(200000 * 2 * 4 * 0.6);
  });

  it("rejects empty and mismatched input", async () => {
    await expect(encodeFlac({ sampleRate: 44100, channels: [] })).rejects.toThrow();
    await expect(encodeFlac({ sampleRate: 44100, channels: [new Float32Array(4), new Float32Array(3)] })).rejects.toThrow();
  });

  it("rejects damaged and non-FLAC data", async () => {
    const bytes = await encodeFlac({ sampleRate: 44100, channels: [tone(20000, 0)] });
    await expect(decodeFlac(new TextEncoder().encode("not audio at all"))).rejects.toThrow();
    await expect(decodeFlac(bytes.slice(0, Math.floor(bytes.length / 2)))).rejects.toThrow();
  });

  it("encodes and decodes four minutes of stereo audio quickly enough to load a song", async () => {
    const frames = 44100 * 240;
    const channels = [tone(frames, 0), tone(frames, 700)];
    const encodeStart = performance.now();
    const bytes = await encodeFlac({ sampleRate: 44100, channels });
    const decodeStart = performance.now();
    await decodeFlac(bytes);
    const decodeMs = performance.now() - decodeStart;
    console.info(`4 min stereo: ${(bytes.length / 1e6).toFixed(1)} MB, encode ${Math.round(decodeStart - encodeStart)} ms, decode ${Math.round(decodeMs)} ms`);
    expect(decodeMs).toBeLessThan(5000);
  }, 60000);
});
