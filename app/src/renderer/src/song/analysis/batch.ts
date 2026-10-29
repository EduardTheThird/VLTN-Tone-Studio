// Analyses saved songs from the Library, without opening them (spec 72). This file decides which songs to analyse, which steps each one runs,
// how a finished analysis is written back to a saved song, and what the summary says. The loop takes its audio loader, playback state,
// saved settings and steps as arguments, so it is tested without the library, the workers or the screen. Only one song's audio is held at
// a time: each song's audio is local to its turn, so it can be dropped before the next song loads.

import type { BeatGrid } from "../band/beat-grid";
import type { PcmAudio, StemName, Stems } from "../types";
import { chartChordTimes } from "../band/request";
import { parseChart } from "../performance/chart";
import { defaultChordSource } from "../performance/sources";
import { needsTempoDetection, readTempoSource, type TempoSource } from "../performance/tempo-source";
import { parseSections } from "../performance/sections";
import { parseBeatGrid } from "../band/beat-grid";
import {
  chartSourceOf,
  lrcTexts,
  lyricsMadeOf,
  lyricsMadeRecord,
  withLyricsChart,
  type ChartSource,
  type LyricsMade,
  type PreviousChart,
} from "../performance/lyrics-chart";
import { LYRIC_LANGUAGES, type LyricsLanguage, type LyricsOptions, type LyricsQualityId } from "../performance/lyrics-options";
import type { LyricsModelId } from "../performance/lyrics-models";
import { buildAnalysisAudio } from "./analysis-audio";
import { sectionsToApply } from "./sections";
import {
  ANALYSIS_VERSION,
  METER_CERTAIN,
  PLAYBACK_INTERRUPT,
  parseAnalysis,
  runSongAnalysis,
  songAudioId,
  type AnalysisOutcome,
  type AnalysisStep,
  type SongAnalysis,
} from "./song-analysis";

/**
 * The steps the Library dialog offers, in the order the dialog lists them. Lyrics come last: transcription is the slowest step, and it runs
 * after the others for each song. It is off by default, since it can take a long time and downloads a model the first time.
 */
export const BATCH_STEPS = [
  { id: "tempo", label: "Tempo and meter", defaultOn: true },
  { id: "key", label: "Key", defaultOn: true },
  { id: "chords", label: "Chords", defaultOn: true },
  { id: "loudness", label: "Loudness", defaultOn: true },
  { id: "parts", label: "Drums and bass", defaultOn: true },
  { id: "silence", label: "Silence", defaultOn: true },
  { id: "sections", label: "Sections", defaultOn: true },
  { id: "lyrics", label: "Lyrics", defaultOn: false },
] as const;
export type BatchStepId = (typeof BATCH_STEPS)[number]["id"];
export type BatchChoice = Record<BatchStepId, boolean>;

/** The steps every new batch starts with: all of them, as the dialog ticks them by default. */
export function defaultChoice(): BatchChoice {
  return Object.fromEntries(BATCH_STEPS.map((step) => [step.id, step.defaultOn])) as BatchChoice;
}

/** A saved song as the batch reads it: its id, its title, and its saved settings (the tempo, the options and the chart). */
export interface BatchSong {
  id: string;
  title: string;
  settings: Record<string, string>;
}

/** Which lyrics charts the lyrics step may replace. A performer's own chart (`user`) is never replaced in bulk. */
export type LyricsWhich = "empty" | "transcribed" | "older";

/** The lyrics step's settings for a batch: the model and quality, which songs, and whether aligned charts are timed again. */
export interface LyricsBatchOptions {
  model: LyricsModelId;
  quality: LyricsQualityId;
  which: LyricsWhich;
  /** Re-times the `aligned` charts (the performer's own words) with the model chosen. Their text is kept. */
  retime: boolean;
}

export const DEFAULT_LYRICS_BATCH: LyricsBatchOptions = { model: "small", quality: "fast", which: "empty", retime: true };

export interface BatchOptions {
  /** Analyse only the songs whose saved analysis is missing, older, or has no tempo of its own. */
  onlyNeeded: boolean;
  /** Tempo and meter the performer set by hand are replaced too. Off, a manual, tap or chart tempo is kept. */
  replaceManual: boolean;
  choice: BatchChoice;
  /** The song open on the Performance screen, skipped so its panel state is never changed behind its back. */
  openSongId: string | null;
  /** The lyrics step's settings. Defaults apply when absent. */
  lyrics?: LyricsBatchOptions;
}

/** What the lyrics step does to one song. `transcribe` makes a chart from the vocals; `retime` times the performer's own lines again. */
export type LyricsAction = { kind: "transcribe" } | { kind: "retime"; lines: string[] };

/**
 * The lyrics step's action for a song, or null when it leaves the song's chart alone. An empty chart is filled only for `empty`. A
 * transcribed chart is replaced for `transcribed`, or for `older` when it was made with another model. An aligned chart is timed again
 * when `retime` is on. A `user` chart is never touched.
 */
export function lyricsAction(song: BatchSong, lyrics: LyricsBatchOptions): LyricsAction | null {
  const options = parseOptions(song.settings[":options"]);
  const text = song.settings[":lyrics"] ?? "";
  if (!text.trim()) return lyrics.which === "empty" ? { kind: "transcribe" } : null;
  const source: ChartSource = chartSourceOf(options);
  if (source === "aligned") {
    const lines = lrcTexts(text);
    return lyrics.retime && lines.some(Boolean) ? { kind: "retime", lines } : null;
  }
  if (source === "transcribed") {
    if (lyrics.which === "transcribed") return { kind: "transcribe" };
    if (lyrics.which === "older" && (lyricsMadeOf(options)?.model ?? "") !== lyrics.model) return { kind: "transcribe" };
  }
  return null;
}

/** Whether any analysis step (not lyrics) is chosen. */
function analysisChosen(choice: BatchChoice): boolean {
  return BATCH_STEPS.some((step) => step.id !== "lyrics" && choice[step.id]);
}

/** The options of a saved song, read from its `:options` entry. A damaged entry reads as no options. */
export function parseOptions(json: string | undefined): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** True when the saved analysis is missing, of an older version, or the song has no tempo chosen by the performer. */
export function needsAnalysis(song: BatchSong): boolean {
  const options = parseOptions(song.settings[":options"]);
  const saved = parseAnalysis(options.analysis);
  if (!saved || saved.version < ANALYSIS_VERSION) return true;
  return needsTempoDetection(song.settings[":bpm"] ?? "", readTempoSource(options));
}

/** Whether the saved tempo may be changed by the analysis. A manual, tap or chart tempo is kept, unless the performer asked to replace it. */
export function tempoMayChange(song: BatchSong, replaceManual: boolean): boolean {
  const source: TempoSource | null = readTempoSource(parseOptions(song.settings[":options"]));
  return replaceManual || source === "detected" || needsTempoDetection(song.settings[":bpm"] ?? "", source);
}

/**
 * The songs to analyse, in the order given. The open song is skipped, and with `onlyNeeded` a song whose analysis is current is left out.
 * The skipped open song is returned too, so the summary can name it.
 */
export function selectSongs(songs: readonly BatchSong[], options: BatchOptions): { run: BatchSong[]; openSkipped: BatchSong[] } {
  const openSkipped = songs.filter((song) => song.id === options.openSongId);
  const run = songs.filter((song) => song.id !== options.openSongId && wantsRun(song, options));
  return { run, openSkipped };
}

/**
 * A song runs when the analysis is wanted for it (with `onlyNeeded`, only if it needs one), or when the lyrics step has something to do for
 * it. With no lyrics step, the songs are chosen as before.
 */
function wantsRun(song: BatchSong, options: BatchOptions): boolean {
  if (!options.choice.lyrics) return !options.onlyNeeded || needsAnalysis(song);
  const analysis = analysisChosen(options.choice) && (!options.onlyNeeded || needsAnalysis(song));
  return analysis || lyricsAction(song, options.lyrics ?? DEFAULT_LYRICS_BATCH) !== null;
}

/** The steps one song runs: the chosen ones, with tempo and meter dropped where the performer's tempo must be kept. */
export function stepsFor(song: BatchSong, options: Pick<BatchOptions, "choice" | "replaceManual">): BatchStepId[] {
  const allowed = tempoMayChange(song, options.replaceManual);
  return BATCH_STEPS.filter((step) => options.choice[step.id] && (step.id !== "tempo" || allowed)).map((step) => step.id);
}

/** What a finished analysis changes in a saved song, as the settings the library writes. `tempoChange` is set when the tempo changed. */
export interface WriteBack {
  values: Record<string, string>;
  tempoChange: { from: number; to: number } | null;
}

/**
 * The settings a finished analysis writes to a saved song. The tempo, first beat, meter (4 only, when certain) and beat grid are applied
 * under the same rules as the Performance screen: a grid the performer made is kept unless the performer asked to replace the tempo. A 3
 * is not applied, since the Performance screen only offers it. Loudness fills in only a song that has none.
 */
export function planWriteBack(
  song: BatchSong,
  analysis: SongAnalysis | null,
  grid: BeatGrid | null,
  replaceManual: boolean,
  lyrics: LyricsWrite | null = null,
): WriteBack {
  const options = parseOptions(song.settings[":options"]);
  const values: Record<string, string> = {};
  const next: Record<string, unknown> = analysis ? { ...options, analysis } : { ...options };
  const tempoChange = analysis ? applyAnalysis(song, analysis, grid, replaceManual, options, next, values) : null;
  if (lyrics) {
    const previousText = song.settings[":lyrics"] ?? "";
    const replaced: PreviousChart | null = previousText.trim() && previousText !== lyrics.text ? { text: previousText, source: chartSourceOf(options) } : null;
    values[":lyrics"] = lyrics.text;
    Object.assign(next, withLyricsChart(next, replaced, { source: lyrics.source, made: lyrics.made }));
  }
  values[":options"] = JSON.stringify(next);
  return { values, tempoChange };
}

/** A lyrics chart the lyrics step made for a song, with its source and the model that made it. */
export interface LyricsWrite {
  text: string;
  source: ChartSource;
  made: LyricsMade;
}

/** The analysis's part of a write-back: the tempo, the sections and the loudness, under the rules planWriteBack describes. */
function applyAnalysis(
  song: BatchSong,
  analysis: SongAnalysis,
  grid: BeatGrid | null,
  replaceManual: boolean,
  options: Record<string, unknown>,
  next: Record<string, unknown>,
  values: Record<string, string>,
): WriteBack["tempoChange"] {
  let tempoChange: WriteBack["tempoChange"] = null;
  // Detected sections fill in a song with none. A song's own sections, and the suggestion kept in the analysis, are left as they are.
  const sections = sectionsToApply(parseSections(options.sections), analysis.sections);
  if (sections) next.sections = sections;
  if (analysis.tempo && tempoMayChange(song, replaceManual)) {
    const from = Number(song.settings[":bpm"]) || 0;
    values[":bpm"] = String(analysis.tempo.bpm);
    tempoChange = from === analysis.tempo.bpm ? null : { from, to: analysis.tempo.bpm };
    next.tempoSource = "detected";
    next.firstBeat = analysis.tempo.firstBeat;
    if (grid && (replaceManual || !options.beatGrid || options.beatGridSource === "analysis")) {
      next.beatGrid = grid;
      next.beatGridSource = "analysis";
    }
    const meter = analysis.meter;
    if (meter && meter.confidence >= METER_CERTAIN && meter.beatsPerBar === 4 && (replaceManual || options.beatsSource !== "manual")) {
      next.beats = 4;
      next.beatsSource = "detected";
    }
  }
  if (analysis.loudness && typeof options.songLufs !== "number") {
    next.songLufs = analysis.loudness.lufs;
    next.songPeakDb = analysis.loudness.peakDb;
  }
  return tempoChange;
}

/** How one song came out of the batch. A cancelled song is not listed: it is left as it was. */
/** What the lyrics step did for a song: a chart made from the vocals, the performer's words timed, nothing heard, or it failed. */
export type LyricsOutcome = "made" | "timed" | "none" | "failed";

export type BatchOutcome =
  | { id: string; title: string; status: "analysed"; tempoChange: WriteBack["tempoChange"]; noBeat: boolean; lyrics: LyricsOutcome | null }
  | { id: string; title: string; status: "lyrics"; lyrics: LyricsOutcome }
  | { id: string; title: string; status: "current" }
  | { id: string; title: string; status: "skipped"; reason: "open" }
  | { id: string; title: string; status: "failed"; reason: string };

/** The progress of a batch, for the busy line. `step` is null until the first step of the song starts. */
export interface BatchProgress {
  index: number;
  total: number;
  title: string;
  step: string | null;
}

/** What the batch needs from the app. The library, the playback and the steps all arrive through here, so the loop has no imports from them. */
export interface BatchDeps {
  /** Loads a saved song's mix and stems, without opening it. */
  load(id: string): Promise<{ source: PcmAudio; stems: Stems }>;
  /** Whether the song is open on the Performance screen right now. */
  isOpen(id: string): boolean;
  /** Whether audio is playing, or a playlist is. */
  playing(): boolean;
  /** Calls `listener` when playback starts or stops. Returns a function that stops the listening. */
  onPlayingChange(listener: (playing: boolean) => void): () => void;
  /**
   * The analysis steps for the given ids, in the order they run, then the lyrics step when `lyrics` is given. `onGrid` receives the beat grid
   * the tempo step tracks, and `gridOf` gives the grid the sections step should use: the one just tracked, or the one saved with the song.
   */
  steps(
    ids: readonly BatchStepId[],
    onGrid: (grid: BeatGrid) => void,
    gridOf: () => BeatGrid | null,
    lyrics: { options: LyricsOptions; pasted?: string[]; onText(text: string): void } | null,
  ): AnalysisStep[];
  /** Writes the settings of a saved song through the library's settings writers. Not the song store. */
  write(id: string, values: Record<string, string>): void;
}

/** Waits until nothing is playing, or the batch is cancelled. A playing song holds the batch, so no audio is decoded during playback. */
function whenIdle(deps: BatchDeps, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || !deps.playing()) return resolve();
    const finish = () => {
      stopListening();
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const stopListening = deps.onPlayingChange((playing) => {
      if (!playing) finish();
    });
    signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Analyses the songs one at a time and writes each result back to its saved song. Playback pauses the batch between steps, and the song
 * resumes from the step it stopped at once playback stops. Cancelling stops after the current step and leaves the songs not reached as
 * they were. `onProgress` is told before each song's first step.
 */
export async function runAnalysisBatch(
  songs: readonly BatchSong[],
  options: BatchOptions,
  deps: BatchDeps,
  signal: AbortSignal,
  onProgress?: (progress: BatchProgress) => void,
): Promise<BatchOutcome[]> {
  const { run, openSkipped } = selectSongs(songs, options);
  const outcomes: BatchOutcome[] = openSkipped.map((song) => ({ id: song.id, title: song.title, status: "skipped", reason: "open" }));
  for (const [index, song] of run.entries()) {
    if (signal.aborted) break;
    if (deps.isOpen(song.id)) {
      outcomes.push({ id: song.id, title: song.title, status: "skipped", reason: "open" });
      continue;
    }
    await whenIdle(deps, signal);
    if (signal.aborted) break;
    const progress = (step: string | null) => onProgress?.({ index, total: run.length, title: song.title, step });
    progress(null);
    const outcome = await analyseOne(song, options, deps, signal, progress);
    if (!outcome) break;
    outcomes.push(outcome);
  }
  return outcomes;
}

/** Analyses one song. Returns null when the batch was cancelled, so the song is left as it was. */
async function analyseOne(
  song: BatchSong,
  options: BatchOptions,
  deps: BatchDeps,
  signal: AbortSignal,
  onStep: (step: string) => void,
): Promise<BatchOutcome | null> {
  let loaded: { source: PcmAudio; stems: Stems };
  try {
    loaded = await deps.load(song.id);
  } catch (e) {
    return { id: song.id, title: song.title, status: "failed", reason: e instanceof Error ? e.message : "Could not read the song's audio." };
  }
  const { source: mix, stems } = loaded;
  const saved = parseOptions(song.settings[":options"]);
  const audio = buildAnalysisAudio({
    mix,
    stems,
    beatsPerBar: typeof saved.beats === "number" ? saved.beats : 4,
    chordChanges: chartChordTimes(parseChart(song.settings[""] ?? "")),
    chordName: chordNameFor(saved, stems),
  });
  // The lyrics step is decided from the chart before the run, so a chart that the batch may not replace is never transcribed.
  const ids = stepsFor(song, options);
  const lyricsOn = ids.includes("lyrics");
  const lyrics = options.lyrics ?? DEFAULT_LYRICS_BATCH;
  const action = lyricsOn ? lyricsAction(song, lyrics) : null;
  // With the analysis not needed (only songs that need it), the saved analysis is kept and only the lyrics step runs.
  const analysisIds = ids.filter((id) => id !== "lyrics");
  const runAnalysis = analysisIds.length > 0 && (!options.onlyNeeded || needsAnalysis(song));
  if (!runAnalysis && !action) return { id: song.id, title: song.title, status: "current" };
  const lyricsOptions: LyricsOptions = { model: lyrics.model, quality: lyrics.quality, language: languageOf(saved) };
  // The captures are held in objects: the steps and the store fill them in from callbacks, which TypeScript cannot follow.
  const captured: { grid: BeatGrid | null; analysis: SongAnalysis | null; lyrics: string | null } = { grid: null, analysis: null, lyrics: null };
  const base = {
    audioId: songAudioId(mix, stems),
    audio,
    steps: deps.steps(
      runAnalysis ? analysisIds : [],
      (found) => (captured.grid = found),
      () => captured.grid ?? parseBeatGrid(saved.beatGrid),
      action ? { options: lyricsOptions, pasted: action.kind === "retime" ? action.lines : undefined, onText: (text) => (captured.lyrics = text) } : null,
    ),
    settings: {
      read: () => parseAnalysis(saved.analysis),
      write: (analysis: SongAnalysis) => (captured.analysis = analysis),
    },
    // Lyrics-only songs keep their saved analysis, so the run starts from it and nothing is recomputed.
    force: !options.onlyNeeded || !runAnalysis,
    partial: runAnalysis ? undefined : (parseAnalysis(saved.analysis) ?? undefined),
    onStep: (_: number, name: string) => onStep(name),
  };
  // Playback interrupts the run between steps; the run resumes from the step it stopped at once playback stops. Cancelling stops the
  // run with its reason, and nothing is written.
  let run: AbortController = new AbortController();
  const unsubscribe = deps.onPlayingChange((playing) => {
    if (playing) run.abort(PLAYBACK_INTERRUPT);
  });
  const cancel = () => run.abort("cancel");
  signal.addEventListener("abort", cancel, { once: true });
  let outcome: AnalysisOutcome | null = null;
  let resume: { from: number; partial: SongAnalysis } | null = null;
  try {
    for (;;) {
      run = new AbortController();
      if (signal.aborted) run.abort("cancel");
      outcome = await runSongAnalysis({ ...base, ...(resume ? { from: resume.from, partial: resume.partial } : {}), signal: run.signal });
      if (outcome.status !== "interrupted" || signal.aborted) break;
      await whenIdle(deps, signal);
      if (signal.aborted) break;
      resume = { from: outcome.next, partial: outcome.analysis };
    }
  } finally {
    unsubscribe();
    signal.removeEventListener("abort", cancel);
  }
  if (signal.aborted || !outcome || outcome.status !== "complete") return null;
  if (deps.isOpen(song.id)) return { id: song.id, title: song.title, status: "skipped", reason: "open" };
  const lyricsFailed = outcome.analysis.failed?.includes("lyrics") ?? false;
  const lyricsOutcome: LyricsOutcome | null = !action ? null : lyricsFailed ? "failed" : captured.lyrics === null ? "none" : action.kind === "retime" ? "timed" : "made";
  // Only a run that really analysed the song writes its analysis. A current analysis is not run again, so it is not written again.
  const analysis = runAnalysis ? captured.analysis : null;
  const lyricsWrite: LyricsWrite | null =
    action && captured.lyrics !== null
      ? { text: captured.lyrics, source: action.kind === "retime" ? "aligned" : "transcribed", made: lyricsMadeRecord(lyricsOptions, new Date().toISOString()) }
      : null;
  if (!analysis && !lyricsWrite) {
    if (!runAnalysis) return { id: song.id, title: song.title, status: "lyrics", lyrics: lyricsOutcome ?? "none" };
    return { id: song.id, title: song.title, status: "current" };
  }
  const plan = planWriteBack(song, analysis, captured.grid, options.replaceManual, lyricsWrite);
  deps.write(song.id, plan.values);
  if (!runAnalysis) return { id: song.id, title: song.title, status: "lyrics", lyrics: lyricsOutcome ?? "none" };
  return { id: song.id, title: song.title, status: "analysed", tempoChange: plan.tempoChange, noBeat: !!analysis && !analysis.tempo, lyrics: lyricsOutcome };
}

/** The language a song's lyrics are transcribed in, from its options. Unknown values read as automatic. */
function languageOf(saved: Record<string, unknown>): LyricsLanguage {
  return LYRIC_LANGUAGES.find((value) => value === saved.lyricsLanguage) ?? "auto";
}

/** The chord stem a song uses: its own choice when the stem is in the song, else the first stem with a signal. */
function chordNameFor(options: Record<string, unknown>, stems: Stems): StemName | "" {
  const chosen = options.chordChoice;
  if (typeof chosen === "string" && chosen && stems[chosen as StemName]) return chosen as StemName;
  return defaultChordSource(stems);
}

/** One line for the summary: what the batch changed, and what it could not do. */
export function describeBatch(outcomes: readonly BatchOutcome[]): string {
  const analysed = outcomes.filter((o): o is Extract<BatchOutcome, { status: "analysed" }> => o.status === "analysed");
  const changed = analysed.flatMap((o) => (o.tempoChange ? [`${o.title}: ${o.tempoChange.from} → ${o.tempoChange.to}`] : []));
  const parts = [`Analysed ${analysed.length} song${analysed.length === 1 ? "" : "s"}.`];
  if (changed.length) parts.push(`Tempo changed on ${changed.length} (${changed.join(", ")}).`);
  const noBeat = analysed.filter((o) => o.noBeat).length;
  if (noBeat) parts.push(`${noBeat} had no clear beat.`);
  const current = outcomes.filter((o) => o.status === "current").length;
  if (current) parts.push(`${current} already up to date.`);
  const open = outcomes.filter((o) => o.status === "skipped").length;
  if (open) parts.push(`${open} skipped (open).`);
  const lyrics = outcomes.flatMap((o) => (o.status === "analysed" || o.status === "lyrics" ? [o.lyrics] : []));
  const made = lyrics.filter((l) => l === "made").length;
  const timed = lyrics.filter((l) => l === "timed").length;
  if (made) parts.push(`Lyrics made for ${made} song${made === 1 ? "" : "s"}.`);
  if (timed) parts.push(`Lyrics timed for ${timed} song${timed === 1 ? "" : "s"}.`);
  const nothing = lyrics.filter((l) => l === "none").length;
  if (nothing) parts.push(`${nothing} had no words heard.`);
  const lyricsFailed = lyrics.filter((l) => l === "failed").length;
  if (lyricsFailed) parts.push(`${lyricsFailed} lyrics could not be made.`);
  for (const f of outcomes) if (f.status === "failed") parts.push(`${f.title}: ${f.reason}`);
  return parts.join(" ");
}
