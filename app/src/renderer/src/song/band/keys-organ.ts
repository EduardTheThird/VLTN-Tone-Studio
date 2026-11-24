import type { PcmAudio } from "../types";

/** A clean three-drawbar organ with a short key click and a slow rotating speaker. */
export function organSample(pitch: number, rate: number): PcmAudio {
  const pcm = new Float32Array(5 * rate);
  const fundamental = 440 * 2 ** ((pitch - 69) / 12);
  const turn = 2 * Math.PI;
  let phase = 0;
  for (let i = 0; i < pcm.length; i++) {
    const time = i / rate;
    const rotary = Math.sin(turn * 0.9 * time);
    phase += turn * (fundamental / 2) * (1 + 0.002 * rotary) / rate;
    const drawbars = 0.22 * Math.sin(phase) + 0.44 * Math.sin(2 * phase) + 0.17 * Math.sin(4 * phase);
    const click = 0.08 * Math.sin(turn * 2800 * time) * Math.exp(-time * 500);
    pcm[i] = 0.65 * (click + drawbars * Math.min(1, time * 330) * (0.89 + 0.11 * rotary));
  }
  return { sampleRate: rate, channels: [pcm] };
}
