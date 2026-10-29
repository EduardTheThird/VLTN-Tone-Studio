// The analysis steps the song pass runs. Each one is a small job built on an existing analysis: the beat tracker for tempo. A step gives its
// result to the run and returns nothing to the screen, so it can run headless.

import { startBeatGrid } from "../band/beat-grid-client";
import type { BeatGrid } from "../band/beat-grid";
import { tempoFromGrid } from "../performance/tempo-source";
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
