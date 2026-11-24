import type { PcmAudio } from "../types";
import type { SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { monoAverage } from "./level";

export interface DrumPatternCheck {
  mono: Float32Array;
  sampleRate: number;
  plans: readonly SectionPlan[];
  grid: BeatGrid | null;
  beats: number;
  tempoHint?: number;
}

/** Runs the first-import check off the renderer thread. This job never changes the song's beat grid. */
export function startDrumPatternCheck(audio: PcmAudio, input: Omit<DrumPatternCheck, "mono" | "sampleRate">) {
  const mono = monoAverage(audio);
  const worker = new Worker(new URL("./drum-pattern-worker.ts", import.meta.url), { type: "module" });
  let finish: (basic: boolean) => void;
  const done = new Promise<boolean>((resolve) => {
    finish = (basic) => {
      worker.terminate();
      resolve(basic);
    };
  });
  worker.onmessage = ({ data }: MessageEvent<boolean>) => finish(data === true);
  worker.onerror = () => finish(false);
  worker.postMessage({ ...input, mono, sampleRate: audio.sampleRate } satisfies DrumPatternCheck, [mono.buffer]);
  return { done, cancel: () => finish(false) };
}
