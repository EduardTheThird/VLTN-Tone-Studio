// The analysis steps the song pass runs. Each one is a small job built on an existing analysis: the beat tracker for tempo. A step gives its
// result to the run and returns nothing to the screen, so it can run headless.

import { startBeatGrid } from "../band/beat-grid-client";
import type { BeatGrid } from "../band/beat-grid";
import { tempoFromGrid } from "../performance/tempo-source";
import type { Chord } from "../performance/chords";
import type { KeyEstimate } from "../performance/key";
import type { PcmAudio } from "../types";
import { measureLoudnessInWorker } from "../audio/loudness-client";
import type { AnalysisStep } from "./song-analysis";

/**
 * Tracks the beat of the song's audio, and reads the meter from the same beats. `onGrid` receives the whole grid, which the caller saves
 * with the band settings, since the grid is too large for the analysis record. The tempo goes to the analysis; the grid is only passed on
 * when it is long enough to trust.
 */
export function tempoStep(onGrid?: (grid: BeatGrid) => void): AnalysisStep {
  return {
    name: "tempo",
    async run(audio, signal) {
      const job = startBeatGrid({
        sources: audio.sources,
        sampleRate: audio.sampleRate,
        beatsPerBar: audio.beatsPerBar,
        chordChanges: audio.chordChanges,
      });
      const stop = () => job.cancel();
      signal.addEventListener("abort", stop, { once: true });
      let grid: BeatGrid;
      try {
        grid = await job.done;
      } finally {
        signal.removeEventListener("abort", stop);
      }
      const meter = await job.meter;
      const tempo = tempoFromGrid(grid);
      if (!tempo) return meter ? { meter } : {};
      onGrid?.(grid);
      return meter ? { tempo, meter } : { tempo };
    },
  };
}

/**
 * Runs a one-shot worker on `audio` and resolves with its reply. The worker is ended when it answers, fails, or the run is aborted, so a
 * song that is left or re-analysed does not keep a thread busy.
 */
function runWorker<T>(url: URL, audio: PcmAudio, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(url, { type: "module" });
    const stop = () => {
      worker.terminate();
      reject(new Error("The analysis was stopped."));
    };
    signal.addEventListener("abort", stop, { once: true });
    worker.onmessage = (event: MessageEvent<T & { error?: string }>) => {
      worker.terminate();
      signal.removeEventListener("abort", stop);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    worker.onerror = () => {
      worker.terminate();
      signal.removeEventListener("abort", stop);
      reject(new Error("The analysis could not finish."));
    };
    worker.postMessage(audio);
  });
}

/**
 * Measures the song's loudness and sample peak, in the loudness worker. The worker cannot be stopped, so an aborted run finishes the
 * measurement and drops it. Nothing is saved for a silent song, which has no level to normalise to.
 */
export function loudnessStep(): AnalysisStep {
  return {
    name: "loudness",
    async run(audio) {
      const { lufs, peakDb } = await measureLoudnessInWorker(audio.mix);
      return Number.isFinite(lufs) ? { loudness: { lufs, peakDb } } : {};
    },
  };
}

/** Estimates the song's key from its key stem. Nothing is saved when the song has no stem with a signal. */
export function keyStep(): AnalysisStep {
  return {
    name: "key",
    async run(audio, signal) {
      if (!audio.keySource) return {};
      const { estimate } = await runWorker<{ estimate: KeyEstimate | null }>(new URL("../performance/key-worker.ts", import.meta.url), audio.keySource.audio, signal);
      return estimate ? { key: { source: audio.keySource.name, estimate } } : {};
    },
  };
}

/** Reads the chords from the chord stem. Nothing is saved when no chord stem is chosen. */
export function chordsStep(): AnalysisStep {
  return {
    name: "chords",
    async run(audio, signal) {
      if (!audio.chordSource) return {};
      const { chords } = await runWorker<{ chords: Chord[] }>(new URL("../performance/chords-worker.ts", import.meta.url), audio.chordSource.audio, signal);
      return { chords: { source: audio.chordSource.name, chords } };
    },
  };
}
