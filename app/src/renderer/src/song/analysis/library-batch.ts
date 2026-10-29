// Connects the batch analysis (batch.ts) to the app: the saved songs' audio from the library, the open song and playback from the screen, the
// analysis steps, and the library's settings writers. The batch itself does not import any of these.

import { useSong } from "../store";
import { loadSongAudio, useSongLibrary } from "../library";
import { flushSettings, LIBRARY_PREFIX, setSetting } from "../performance/settings";
import { isSongPlaying, onSongPlayingChange } from "../performance/playing-state";
import { chordsStep, keyStep, loudnessStep, partsStep, silenceStep, tempoStep } from "./steps";
import { runAnalysisBatch, type BatchDeps, type BatchOptions, type BatchOutcome, type BatchProgress, type BatchSong, type BatchStepId } from "./batch";
import type { AnalysisStep } from "./song-analysis";
import type { BeatGrid } from "../band/beat-grid";

/** The steps in the order the analysis runs them. The tempo step gives the beat grid to the batch, which saves it with the song. */
function stepsFor(ids: readonly BatchStepId[], onGrid: (grid: BeatGrid) => void): AnalysisStep[] {
  const wanted = new Set<BatchStepId>(ids);
  const ordered: [BatchStepId, () => AnalysisStep][] = [
    ["loudness", loudnessStep],
    ["silence", silenceStep],
    ["parts", partsStep],
    ["chords", chordsStep],
    ["tempo", () => tempoStep(onGrid)],
    ["key", keyStep],
  ];
  return ordered.filter(([id]) => wanted.has(id)).map(([, make]) => make());
}

/** The app's side of the batch: loads from the library, writes through the library's settings, and reads the open song and playback. */
export const libraryBatchDeps: BatchDeps = {
  load: (id) => loadSongAudio(id),
  isOpen: (id) => useSong.getState().source?.libraryId === id,
  playing: () => isSongPlaying() || useSongLibrary.getState().playlistPlaying,
  onPlayingChange: (listener) => onSongPlayingChange(listener),
  steps: stepsFor,
  write: (id, values) => {
    const key = `${LIBRARY_PREFIX}${id}`;
    if (values[":bpm"] !== undefined) setSetting(key, ":bpm", values[":bpm"]);
    setSetting(key, ":options", values[":options"]);
  },
};

/**
 * Analyses the given saved songs in turn, and then sends the settings they wrote to the library and refreshes the library's list. Refuse
 * to call this while a song plays: the caller checks first, so the batch never starts over the music.
 */
export async function runLibraryAnalysis(
  songs: readonly BatchSong[],
  options: BatchOptions,
  signal: AbortSignal,
  onProgress?: (progress: BatchProgress) => void,
): Promise<BatchOutcome[]> {
  try {
    return await runAnalysisBatch(songs, options, libraryBatchDeps, signal, onProgress);
  } finally {
    await flushSettings();
    await useSongLibrary.getState().refresh();
  }
}
