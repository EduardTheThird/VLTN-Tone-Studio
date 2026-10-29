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
import { buildAnalysisAudio } from "./analysis-audio";
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

/** The steps the Library dialog offers, in the order the dialog lists them. Sections and lyrics join when specs 74 and 75 add their steps. */
export const BATCH_STEPS = [
  { id: "tempo", label: "Tempo and meter", defaultOn: true },
  { id: "key", label: "Key", defaultOn: true },
  { id: "chords", label: "Chords", defaultOn: true },
  { id: "loudness", label: "Loudness", defaultOn: true },
  { id: "parts", label: "Drums and bass", defaultOn: true },
  { id: "silence", label: "Silence", defaultOn: true },
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

export interface BatchOptions {
  /** Analyse only the songs whose saved analysis is missing, older, or has no tempo of its own. */
  onlyNeeded: boolean;
  /** Tempo and meter the performer set by hand are replaced too. Off, a manual, tap or chart tempo is kept. */
  replaceManual: boolean;
  choice: BatchChoice;
  /** The song open on the Performance screen, skipped so its panel state is never changed behind its back. */
  openSongId: string | null;
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
  const run = songs.filter((song) => song.id !== options.openSongId && (!options.onlyNeeded || needsAnalysis(song)));
  return { run, openSkipped };
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
export function planWriteBack(song: BatchSong, analysis: SongAnalysis, grid: BeatGrid | null, replaceManual: boolean): WriteBack {
  const options = parseOptions(song.settings[":options"]);
  const values: Record<string, string> = {};
  let tempoChange: WriteBack["tempoChange"] = null;
  const next: Record<string, unknown> = { ...options, analysis };
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
  values[":options"] = JSON.stringify(next);
  return { values, tempoChange };
}

/** How one song came out of the batch. A cancelled song is not listed: it is left as it was. */
export type BatchOutcome =
  | { id: string; title: string; status: "analysed"; tempoChange: WriteBack["tempoChange"]; noBeat: boolean }
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
  /** The analysis steps for the given ids, in the order they run. `onGrid` receives the beat grid the tempo step tracks. */
  steps(ids: readonly BatchStepId[], onGrid: (grid: BeatGrid) => void): AnalysisStep[];
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
  // The captures are held in objects: the steps and the store fill them in from callbacks, which TypeScript cannot follow.
  const captured: { grid: BeatGrid | null; analysis: SongAnalysis | null } = { grid: null, analysis: null };
  const base = {
    audioId: songAudioId(mix, stems),
    audio,
    steps: deps.steps(stepsFor(song, options), (found) => (captured.grid = found)),
    settings: {
      read: () => parseAnalysis(saved.analysis),
      write: (analysis: SongAnalysis) => (captured.analysis = analysis),
    },
    force: !options.onlyNeeded,
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
  // A song whose analysis is current is not run again, so nothing is written for it.
  if (!captured.analysis) return { id: song.id, title: song.title, status: "current" };
  if (deps.isOpen(song.id)) return { id: song.id, title: song.title, status: "skipped", reason: "open" };
  const plan = planWriteBack(song, captured.analysis, captured.grid, options.replaceManual);
  deps.write(song.id, plan.values);
  return { id: song.id, title: song.title, status: "analysed", tempoChange: plan.tempoChange, noBeat: !captured.analysis.tempo };
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
  for (const f of outcomes) if (f.status === "failed") parts.push(`${f.title}: ${f.reason}`);
  return parts.join(" ");
}
