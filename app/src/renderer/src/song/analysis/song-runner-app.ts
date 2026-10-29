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
import { parseAnalysis, songAudioId, type AnalysisStep } from "./song-analysis";
import { lyricsSkipLabel, lyricsStepText } from "./batch";
import { lyricsRunSkip } from "./lyrics-run";
import { lyricsOptionsFrom } from "../performance/lyrics-options";
import { createSongRunner, type CapturedRun, type RunOptions, type RunTarget, type SavedSong } from "./song-runner";
import { loadAfterSplit, type AfterSplitStep } from "./after-split";
import { chordsStep, keyStep, loudnessStep, lyricsStep, partsStep, sectionsStep, silenceStep, tempoStep } from "./steps";

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

/**
 * The lyrics step, when the run may transcribe the song's chart. A song with no split vocals gets a line saying so, and a chart the run
 * must leave alone gets a line saying why. The step's status replaces the step name while the model downloads.
 */
function lyricsFor(key: string, captured: CapturedRun): AnalysisStep | null {
  const { source, stems } = useSong.getState();
  if (!source) return null;
  if (!stems?.vocals) {
    captured.note = "Split the song to get lyrics.";
    return null;
  }
  const options = readOptions<Record<string, unknown>>(key, {});
  const saved = parseAnalysis(options.analysis);
  // A chart the run made for different audio belongs to the audio before a re-split; with no saved analysis it is kept.
  const audioChanged = !!saved && saved.audioId !== songAudioId(source.audio, stems);
  const skip = lyricsRunSkip(getSetting(key, ":lyrics"), options, audioChanged);
  if (skip) {
    captured.note = `Lyrics left as they are (${lyricsSkipLabel(skip)}).`;
    return null;
  }
  captured.lyricsOptions = lyricsOptionsFrom(options);
  return lyricsStep({
    options: captured.lyricsOptions,
    onText: (text) => (captured.lyrics = text),
    onStatus: (status) => songRunner.state.setState({ step: lyricsStepText(status) }),
    onError: (reason) => (captured.note = `Lyrics failed: ${reason}`),
  });
}

/**
 * The steps the open song's run takes, in the order the analysis runs them: only the ones ticked under "After the split", with lyrics
 * last. A detect takes the tempo (and the sections, for a find-the-beat) whatever is ticked, since its buttons are about the tempo.
 */
function appSteps(key: string, options: RunOptions, captured: CapturedRun): AnalysisStep[] {
  const tempo = tempoStep((grid) => (captured.grid = grid), options.hint ?? {});
  const sections = sectionsStep(() => captured.grid ?? readStoredBand(key).grid ?? null);
  if (options.tempoOnly) return options.sections ? [tempo, sections] : [tempo];
  const wanted = loadAfterSplit();
  const ordered: [AfterSplitStep, AnalysisStep[]][] = [
    ["loudness", [loudnessStep(), silenceStep()]],
    ["parts", [partsStep()]],
    ["chords", [chordsStep()]],
    ["tempo", [tempo]],
    ["key", [keyStep()]],
    ["sections", [sections]],
  ];
  const steps = ordered.filter(([id]) => wanted[id]).flatMap(([, made]) => made);
  const lyrics = wanted.lyrics ? lyricsFor(key, captured) : null;
  return lyrics ? [...steps, lyrics] : steps;
}

/** The app's runner. */
export const songRunner = createSongRunner({
  target: (beatsPerBar) => openTarget(beatsPerBar),
  read: (key): SavedSong => ({
    bpm: getSetting(key, ":bpm"),
    options: readOptions<Record<string, unknown>>(key, {}),
    chart: getSetting(key, ""),
    lyrics: getSetting(key, ":lyrics"),
  }),
  write: (key, values) => {
    if (values[":bpm"] !== undefined) setSetting(key, ":bpm", values[":bpm"]);
    if (values[":options"] !== undefined) setSetting(key, ":options", values[":options"]);
    if (values[":lyrics"] !== undefined) setSetting(key, ":lyrics", values[":lyrics"]);
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
