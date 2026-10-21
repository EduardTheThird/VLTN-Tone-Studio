import { fft } from '../tonematch/fft';
import type { PcmAudio } from '../types';
export interface Chord { time: number; name: string; confidence: number }
/** Windowed chroma template estimate. Major/minor only; never a transcription guarantee. */
export function detectChords(audio: PcmAudio): Chord[] {
  const n = 8192, hop = Math.round(audio.sampleRate / 2);
  const notes = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const result: Chord[] = [];
  for (let start = 0; start < audio.channels[0].length; start += hop) {
    const re = new Float64Array(n), im = new Float64Array(n), chroma = new Float64Array(12);
    for (let i = 0; i < n; i++) {
      for (const ch of audio.channels) re[i] += (ch[start + i] ?? 0) / audio.channels.length;
      re[i] *= 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    }
    fft(re, im);
    for (let k = 1; k < n / 2; k++) {
      const hz = k * audio.sampleRate / n;
      if (hz < 65 || hz > 2000) continue;
      const midi = Math.round(69 + 12 * Math.log2(hz / 440));
      chroma[(midi % 12 + 12) % 12] += re[k] ** 2 + im[k] ** 2;
    }
    const total = chroma.reduce((a,b) => a+b, 0);
    let score = 0, name = 'N';
    if (total > 0.01) for (let root = 0; root < 12; root++) for (const third of [4, 3]) {
      const value = (chroma[root] + chroma[(root + third) % 12] + chroma[(root + 7) % 12]) / total;
      if (value > score) { score = value; name = notes[root] + (third === 3 ? 'm' : ''); }
    }
    if (score < 0.55) name = 'N';
    if (result.at(-1)?.name !== name) result.push({ time: start / audio.sampleRate, name, confidence: score });
  }
  return result;
}
