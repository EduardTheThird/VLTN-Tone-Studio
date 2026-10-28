// Runs the beat tracker in a worker so a long song does not block the window. The job can be cancelled: cancelling ends the worker at
// once, so a song that is closed or re-split during analysis does not keep a thread busy.

import type { PcmAudio } from "../types";
import type { BeatGrid } from "./beat-grid";

export interface BeatGridRequest {
  sources: PcmAudio[];
  sampleRate: number;
  beatsPerBar: number;
  /** Chord change times, in seconds of the same audio */
  chordChanges?: number[];
}

export interface BeatGridJob {
  /** Resolves with the grid, or rejects with an AbortError after `cancel`. */
  done: Promise<BeatGrid>;
  cancel(): void;
}

export function startBeatGrid(request: BeatGridRequest): BeatGridJob {
  const worker = new Worker(new URL("./beat-grid-worker.ts", import.meta.url), { type: "module" });
  let rejectDone: (error: Error) => void = () => {};
  const done = new Promise<BeatGrid>((resolve, reject) => {
    rejectDone = reject;
    worker.onmessage = (event: MessageEvent<{ grid?: BeatGrid; error?: string }>) => {
      worker.terminate();
      if (event.data.error || !event.data.grid) reject(new Error(event.data.error || "Beat tracking returned no grid."));
      else resolve(event.data.grid);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("Beat tracking could not finish."));
    };
  });
  worker.postMessage(request);
  return {
    done,
    cancel() {
      worker.terminate();
      const error = new Error("Beat tracking was cancelled.");
      error.name = "AbortError";
      rejectDone(error);
    },
  };
}
