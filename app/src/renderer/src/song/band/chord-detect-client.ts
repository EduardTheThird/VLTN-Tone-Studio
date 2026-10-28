// Runs the chord detector (the same worker the Performance screen's chord analysis uses) for the Band panel, so Generate can find chords
// when the chart has none and the screen's analysis has not run. The job can be cancelled: cancelling ends the worker at once.

import type { Chord } from "../performance/chords";
import type { PcmAudio } from "../types";

export interface ChordDetectionJob {
  /** Resolves with the detected chords, or rejects with an AbortError after `cancel`. */
  done: Promise<Chord[]>;
  cancel(): void;
}

/** Starts chord detection on `audio` in a worker. Call it while playback is stopped. */
export function startChordDetection(audio: PcmAudio): ChordDetectionJob {
  const worker = new Worker(new URL("../performance/chords-worker.ts", import.meta.url), { type: "module" });
  let rejectDone: (error: Error) => void = () => {};
  const done = new Promise<Chord[]>((resolve, reject) => {
    rejectDone = reject;
    worker.onmessage = (event: MessageEvent<{ chords?: Chord[]; error?: string }>) => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.chords ?? []);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("Chord detection could not finish."));
    };
  });
  worker.postMessage(audio);
  return {
    done,
    cancel() {
      worker.terminate();
      const error = new Error("Chord detection was cancelled.");
      error.name = "AbortError";
      rejectDone(error);
    },
  };
}
