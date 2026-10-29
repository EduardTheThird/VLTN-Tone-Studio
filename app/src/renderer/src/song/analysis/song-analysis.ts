// Works out what Tone Studio can about a song once its audio is known: tempo now, and meter, key, chords, loudness, missing parts and
// silence as later steps are added. Each step is a small job that returns what it found. This file runs them in order, keeps the results,
// and stops when playback starts. It imports no React or screen code, so the same run can later work through saved songs headless (spec 72).

import type { Chord } from "../performance/chords";
import type { KeyEstimate } from "../performance/key";
import type { PcmAudio, Stems } from "../types";

/** The song's integrated loudness and sample peak, as the loudness control measures them. */
export interface LoudnessResult {
  lufs: number;
  peakDb: number;
}

/** A meter estimate at or above this confidence is applied to the song. Below it, the meter is only suggested. */
export const METER_CERTAIN = 0.6;

/** Bump when an analysis improves, so songs analysed earlier are analysed again the next time they open. */
export const ANALYSIS_VERSION = 1;

/** The tempo the analysis found. `firstBeat` is the time of the first beat, in seconds, when the grid fits a straight line. */
export interface TempoResult {
  bpm: number;
  firstBeat: number;
  steady: boolean;
}

/** The meter the beats fall into. `confidence` is how clearly the chosen meter stands out, from 0 to 1. */
export interface MeterResult {
  beatsPerBar: 3 | 4;
  confidence: number;
}

/** The key the song was estimated to be in, and the stem it was estimated from. */
export interface KeyResult {
  source: string;
  estimate: KeyEstimate;
}

/** The chords read from one stem. The stem is recorded, so a different chord source is analysed again. */
export interface ChordsResult {
  source: string;
  chords: Chord[];
}

/** What the analysis saved for one song. It is keyed on the audio it was run on, so a re-split runs it again. */
export interface SongAnalysis {
  /** A fingerprint of the audio analysed (see `audioFingerprint`). */
  audioId: string;
  version: number;
  tempo?: TempoResult;
  meter?: MeterResult;
  loudness?: LoudnessResult;
  key?: KeyResult;
  chords?: ChordsResult;
  /** Names of the steps that failed. A failed step is not retried until the song is analysed again. */
  failed?: string[];
}

/** A named piece of audio a step reads, such as the stem the chords come from. */
export interface NamedAudio {
  name: string;
  audio: PcmAudio;
}

/** The audio a run analyses: the sources and the timing context the steps need. */
export interface AnalysisAudio {
  /** The song's mix, measured for loudness. */
  mix: PcmAudio;
  sources: readonly PcmAudio[];
  sampleRate: number;
  beatsPerBar: number;
  /** Chord change times, in seconds of the same audio. Empty when the song has no chords yet. */
  chordChanges: number[];
  /** The stem the key is read from, or null when there is no audio with a signal. */
  keySource: NamedAudio | null;
  /** The stem the chords are read from, or null when no chord stem is chosen. */
  chordSource: NamedAudio | null;
}

/** The fields a step may fill. The bookkeeping fields belong to the run. */
export type StepResult = Partial<Omit<SongAnalysis, "audioId" | "version" | "failed">>;

export interface AnalysisStep {
  /** Written to `failed` when the step throws. */
  name: string;
  /** Does the work for one song. Throws on failure; the run records it and carries on. */
  run(audio: AnalysisAudio, signal: AbortSignal): Promise<StepResult>;
}

export interface AnalysisSettings {
  /** The analysis saved for the song, or null. */
  read(): SongAnalysis | null;
  /** Saves a finished analysis. Only a complete run is saved, so an interrupted one starts again. */
  write(analysis: SongAnalysis): void;
}

/** Why a run stopped early. Playback interrupts it, so it can resume once playback stops; anything else cancels it. */
export const PLAYBACK_INTERRUPT = "playback";

export interface AnalysisRun {
  audioId: string;
  audio: AnalysisAudio;
  steps: readonly AnalysisStep[];
  settings: AnalysisSettings;
  /** Runs even when the saved analysis matches. */
  force?: boolean;
  /** Where to resume, with what the earlier interrupted run found. */
  from?: number;
  partial?: SongAnalysis;
  /** Aborted to stop the run. Its reason says whether playback interrupted it or it was cancelled. */
  signal?: AbortSignal;
  /** Called before each step starts, with its index and name. */
  onStep?: (index: number, name: string) => void;
}

export type AnalysisOutcome =
  | { status: "complete"; analysis: SongAnalysis }
  | { status: "interrupted"; next: number; analysis: SongAnalysis }
  | { status: "cancelled"; analysis: SongAnalysis | null };

/** The fingerprint of a song's mix and stems, the id its analysis is saved under. */
export function songAudioId(mix: PcmAudio, stems: Stems | null): string {
  return audioFingerprint(mix.sampleRate, { mix, ...stems });
}

/**
 * A short fingerprint of the audio: the sample rate and the length of each source, in name order. A re-split or an added track
 * changes it, and the analysis is run again. Stems are looked up by name, so the same audio always gives the same id.
 */
export function audioFingerprint(sampleRate: number, stems: Record<string, PcmAudio | undefined>): string {
  const parts = Object.entries(stems)
    .filter((entry): entry is [string, PcmAudio] => entry[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, audio]) => `${name}:${audio.channels[0]?.length ?? 0}`);
  return `${sampleRate}|${parts.join(",")}`;
}

/** The saved analysis matches the audio and the current version, so it needs no run. */
export function isCurrent(saved: SongAnalysis | null, audioId: string): saved is SongAnalysis {
  return !!saved && saved.audioId === audioId && saved.version === ANALYSIS_VERSION;
}

/**
 * Runs the steps in order and returns what they found. A step that throws is recorded in `failed` and the run carries on. The run stops
 * early when `signal` is aborted: with the playback reason it reports where to resume, otherwise it is cancelled and nothing is saved.
 */
export async function runSongAnalysis(run: AnalysisRun): Promise<AnalysisOutcome> {
  const saved = run.settings.read();
  if (!run.force && !run.from && isCurrent(saved, run.audioId)) return { status: "complete", analysis: saved };
  const analysis: SongAnalysis = run.partial ?? { audioId: run.audioId, version: ANALYSIS_VERSION };
  const failed = [...(analysis.failed ?? [])];
  const signal = run.signal ?? new AbortController().signal;
  const snapshot = (): SongAnalysis => ({ ...analysis, failed: failed.length ? [...failed] : undefined });
  for (let index = run.from ?? 0; index < run.steps.length; index++) {
    if (signal.aborted) return stopped(signal, index, snapshot());
    const step = run.steps[index];
    run.onStep?.(index, step.name);
    try {
      Object.assign(analysis, await step.run(run.audio, signal));
    } catch (e) {
      if (signal.aborted) return stopped(signal, index, snapshot());
      failed.push(step.name);
    }
  }
  const result = snapshot();
  run.settings.write(result);
  return { status: "complete", analysis: result };
}

function stopped(signal: AbortSignal, next: number, analysis: SongAnalysis): AnalysisOutcome {
  if (signal.reason === PLAYBACK_INTERRUPT) return { status: "interrupted", next, analysis };
  return { status: "cancelled", analysis: null };
}

/** Reads an analysis saved in a song's options. Anything that is not an analysis of the current shape gives null, so the song is analysed again. */
export function parseAnalysis(value: unknown): SongAnalysis | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.audioId !== "string" || typeof record.version !== "number") return null;
  const tempo = record.tempo as Record<string, unknown> | undefined;
  const validTempo = !!tempo && typeof tempo.bpm === "number" && typeof tempo.firstBeat === "number" && typeof tempo.steady === "boolean";
  const loudness = record.loudness as Record<string, unknown> | undefined;
  const validLoudness = typeof loudness?.lufs === "number" && typeof loudness.peakDb === "number";
  const key = record.key as { source?: unknown; estimate?: { name?: unknown } } | undefined;
  const validKey = typeof key?.source === "string" && typeof key.estimate?.name === "string";
  const chords = record.chords as { source?: unknown; chords?: unknown } | undefined;
  const validChords = typeof chords?.source === "string" && Array.isArray(chords.chords);
  const meter = record.meter as Record<string, unknown> | undefined;
  const validMeter = !!meter && (meter.beatsPerBar === 3 || meter.beatsPerBar === 4) && typeof meter.confidence === "number";
  const failed = Array.isArray(record.failed) && record.failed.every((name) => typeof name === "string") ? record.failed : undefined;
  return {
    audioId: record.audioId,
    version: record.version,
    ...(validTempo ? { tempo: { bpm: tempo.bpm as number, firstBeat: tempo.firstBeat as number, steady: tempo.steady as boolean } } : {}),
    ...(validMeter ? { meter: { beatsPerBar: meter.beatsPerBar as 3 | 4, confidence: meter.confidence as number } } : {}),
    ...(validLoudness ? { loudness: { lufs: loudness!.lufs as number, peakDb: loudness!.peakDb as number } } : {}),
    ...(validKey ? { key: { source: key!.source as string, estimate: key!.estimate as KeyEstimate } } : {}),
    ...(validChords ? { chords: { source: chords!.source as string, chords: chords!.chords as Chord[] } } : {}),
    ...(failed?.length ? { failed } : {}),
  };
}

/** One line for the status under the song: what was found, and what failed. */
export function describeAnalysis(analysis: SongAnalysis): string {
  const found = analysis.tempo ? `Tempo ${analysis.tempo.bpm} BPM${analysis.tempo.steady ? "" : " (the tempo varies)"}` : "No steady tempo found";
  const meter = analysis.meter ? `. Meter ${analysis.meter.beatsPerBar}/4${analysis.meter.confidence < METER_CERTAIN ? " (not certain)" : ""}` : "";
  const loudness = analysis.loudness ? `. Loudness ${analysis.loudness.lufs.toFixed(1)} LUFS` : "";
  const key = analysis.key ? `. Key ${analysis.key.estimate.name}` : "";
  const chords = analysis.chords ? `. ${analysis.chords.chords.length} chords` : "";
  const failed = analysis.failed?.length ? `. Could not work out: ${analysis.failed.join(", ")}` : "";
  return `${found}${meter}${loudness}${key}${chords}${failed}`;
}
