// The app's song runner (spec 80): the open song from the song store and its saved settings, playback from the playing state and the
// playlist, and the steps the open song's run takes. The runner itself (song-runner.ts) imports none of these.

import { useSong } from "../store";
import { useSongLibrary } from "../library";
import { chartChordTimes } from "../band/request";
import { parseChart } from "../performance/chart";
import { defaultChordSource } from "../performance/sources";
import { getSetting, performanceKey, readOptions, setSetting } from "../performance/settings";
import { isSongPlaying, onSongPlayingChange } from "../performance/playing-state";
import { readStoredBand } from "../band/stored";
import type { StemName } from "../types";
import { buildAnalysisAudio } from "./analysis-audio";
import { songAudioId, type AnalysisStep } from "./song-analysis";
import { chordsStep, keyStep, loudnessStep, partsStep, sectionsStep, silenceStep, tempoStep } from "./steps";
import { createSongRunner, type CapturedRun, type RunOptions, type RunTarget, type SavedSong } from "./song-runner";

/** A song is playing, or a playlist is. Nothing the runner does starts over the music. */
const playingNow = () => isSongPlaying() || useSongLibrary.getState().playlistPlaying;

/** The open song as a run sees it: its key, its audio at the meter given (or its own), and the chord stem chosen for it. */
function openTarget(beatsPerBar?: number): RunTarget | null {
  const { source, stems } = useSong.getState();
  if (!source) return null;
  const key = performanceKey(source);
  const options = readOptions<Record<string, unknown>>(key, {});
  const meter = beatsPerBar ?? (typeof options.beats === "number" ? options.beats : 4);
  const chordChoice = typeof options.chordChoice === "string" ? (options.chordChoice as StemName) : "";
  const chordName: StemName | "" = chordChoice && stems?.[chordChoice] ? chordChoice : defaultChordSource(stems);
  const audio = buildAnalysisAudio({ mix: source.audio, stems, beatsPerBar: meter, chordChanges: chartChordTimes(parseChart(getSetting(key, ""))), chordName });
  return { key, audioId: songAudioId(source.audio, stems), audio };
}

/** The steps the open song's run takes: the full list, or the tempo (and sections) for a detect. Lyrics join in a later step of this change. */
function appSteps(key: string, options: RunOptions, captured: CapturedRun): AnalysisStep[] {
  const tempo = tempoStep((grid) => (captured.grid = grid), options.hint ?? {});
  const sections = sectionsStep(() => captured.grid ?? readStoredBand(key).grid ?? null);
  if (options.tempoOnly) return options.sections ? [tempo, sections] : [tempo];
  return [loudnessStep(), silenceStep(), partsStep(), chordsStep(), tempo, keyStep(), sections];
}

/** The app's runner. */
export const songRunner = createSongRunner({
  target: (beatsPerBar) => openTarget(beatsPerBar),
  read: (key): SavedSong => ({
    bpm: getSetting(key, ":bpm"),
    options: readOptions<Record<string, unknown>>(key, {}),
    chart: getSetting(key, ""),
  }),
  write: (key, values) => {
    if (values[":bpm"] !== undefined) setSetting(key, ":bpm", values[":bpm"]);
    if (values[":options"] !== undefined) setSetting(key, ":options", values[":options"]);
  },
  steps: appSteps,
  playing: playingNow,
  onPlayingChange: (listener) => {
    const stopSong = onSongPlayingChange(listener);
    const stopPlaylist = useSongLibrary.subscribe((state, previous) => {
      if (state.playlistPlaying !== previous.playlistPlaying) listener(playingNow());
    });
    return () => {
      stopSong();
      stopPlaylist();
    };
  },
  finished: (key, analysis) => {
    // A drums and bass check is kept on the store when the song has none yet, as the Performance screen did.
    const { source, missingParts } = useSong.getState();
    if (analysis.parts && !missingParts && source && performanceKey(source) === key) useSong.setState({ missingParts: analysis.parts });
  },
});

/**
 * Starts the automatic run when a split or an import lands (the stems change and the store is idle). Returns the function that stops
 * the watch. The Song screen also asks for the run when it opens a song.
 */
export function watchSongs(): () => void {
  return useSong.subscribe((state, previous) => {
    if (state.status.kind !== "idle" || !state.source) return;
    if (state.source === previous.source && state.stems === previous.stems) return;
    songRunner.analyse();
  });
}
