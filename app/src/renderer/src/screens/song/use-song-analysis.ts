// Runs the song analysis for the loaded song, once its audio is known. It runs when a song opens or its stems change (a split or an import),
// never during playback. Playback interrupts a run; the run resumes from the step it stopped at once playback stops. Leaving the song
// cancels it. The results are saved with the song and handed back to the panel, which decides what to apply.

import { useEffect, useRef, useState } from "react";
import { readStoredBand, writeStoredBand } from "@/song/band/stored";
import type { Stems, PcmAudio, StemName } from "@/song/types";
import type { MissingParts } from "@/song/band/detect";
import { getSetting, readOptions, setSetting } from "@/song/performance/settings";
import { loadLyricsOnAnalysis, lyricsOptions } from "@/song/performance/lyrics-options";
import { lyricsMadeRecord, saveLyricsChart } from "@/song/performance/lyrics-chart";
import { buildAnalysisAudio } from "@/song/analysis/analysis-audio";
import {
  describeAnalysis,
  parseAnalysis,
  songAudioId,
  PLAYBACK_INTERRUPT,
  runSongAnalysis,
  type AnalysisSettings,
  type LoudnessResult,
  type MeterResult,
  type SongAnalysis,
  type TempoResult,
} from "@/song/analysis/song-analysis";
import { chordsStep, keyStep, loudnessStep, lyricsStep, partsStep, sectionsStep, silenceStep, tempoStep } from "@/song/analysis/steps";
import type { SilenceEnds } from "@/song/analysis/silence";
import type { DetectedSection } from "@/song/analysis/sections";
import type { BeatGrid, TempoHintOptions } from "@/song/band/beat-grid";

/** The lyrics step for a song with no lyrics: fills the chart only while it is still empty, so a chart saved meanwhile is never replaced. */
function analysisLyrics(songKey: string) {
  return lyricsStep({
    options: lyricsOptions(songKey),
    onText: (text) => {
      if (getSetting(songKey, ":lyrics").trim()) return;
      const made = lyricsMadeRecord(lyricsOptions(songKey), new Date().toISOString());
      saveLyricsChart(songKey, { text, source: "transcribed", made });
    },
  });
}

/** The analysis saved in a song's options. */
export function storedAnalysis(songKey: string): AnalysisSettings {
  return {
    read: () => parseAnalysis(readOptions<Record<string, unknown>>(songKey, {}).analysis),
    write: (analysis) => setSetting(songKey, ":options", JSON.stringify({ ...readOptions<Record<string, unknown>>(songKey, {}), analysis })),
  };
}

export interface SongAnalysisInput {
  songKey: string;
  /** The song's mix, the source every stem and the beat tracker reads from. Null while no song is loaded. */
  mix: PcmAudio | null;
  stems: Stems | null;
  beatsPerBar: number;
  /** Chord change times from the chart, in seconds. */
  chordChanges: number[];
  /** The stem the chords are read from. Empty when none is chosen. */
  chordName: StemName | "";
  /** True during playback, and while a playlist plays. Nothing runs then. */
  playing: boolean;
  /** Called with the tempo a finished run found. The panel decides whether to apply it, and may return a notice about it. */
  onTempo(tempo: TempoResult): Notice | null;
  /** Called with the meter a finished run found. The panel decides whether to apply it, and may return a notice about it. */
  onMeter(meter: MeterResult): Notice | null;
  /** Called with the tempo and meter a detect or analyse-again run found. They replace the saved ones, and the notice may offer to undo that. */
  onDetect(tempo: TempoResult, meter: MeterResult | null): Notice | null;
  /** Called with the loudness a finished run measured. The panel saves it when the song has none yet. */
  onLoudness(loudness: LoudnessResult): void;
  /** Called with the drums and bass check of a finished run. The panel uses it when the song has no check yet. */
  onParts(parts: MissingParts): void;
  /** Called with the silence at the ends of the song. The shape controls offer it as a trim. */
  onSilence(silence: SilenceEnds): void;
  /**
   * Called with the sections a finished run suggested. The panel applies them to a song with none; otherwise they are offered in the section editor.
   * `rerun` is set when a find-the-beat run made them, so the panel may also replace sections it can tell are still the detected ones.
   */
  onSections(sections: DetectedSection[], rerun: boolean): void;
}

/** A line the status shows after a run, with at most a few buttons. Shown until the next run starts. */
export interface Notice {
  text: string;
  actions?: { label: string; run(): void }[];
}

/** Whether the saved grid came from the analysis, so the analysis may replace it when the meter changes. */
export function gridFromAnalysis(songKey: string): boolean {
  return readOptions<Record<string, unknown>>(songKey, {}).beatGridSource === "analysis";
}

export interface SongAnalysisControl {
  /** The step being run, or null when idle. */
  step: string | null;
  /** True while the tempo is detected again, from the Detect button. */
  detecting: boolean;
  /** What the last finished run found, as one line. */
  message: string | null;
  /** Notices from the last finished run, such as an undo for a tempo that was replaced. */
  notices: Notice[];
  /** Runs the analysis again from the start, with the meter given when it is known to have changed. Ignored during playback. */
  rerun(beatsPerBar?: number): void;
  /** Detects the tempo and meter again, replacing the saved ones. The rest of the saved analysis is kept. Ignored during playback. */
  detect(): void;
  /** Finds the beat again from a tempo the performer typed: refined near it, or kept exactly when locked. Replaces the saved tempo and grid, as detect does. Ignored during playback. */
  findBeat(hint: TempoHintOptions): void;
  /** Runs every step again, replacing the saved tempo and meter. Ignored during playback. */
  analyseAgain(): void;
  /** Replaces the notices, so an action can show what it changed. */
  show(notices: Notice[]): void;
  /** Stops the run and drops it. The song is analysed again when it is next opened. */
  cancel(): void;
}

interface Resume {
  from: number;
  partial?: SongAnalysis;
  /** Runs even when the saved analysis matches. Set when the meter changed and the grid must be laid out again. */
  force?: boolean;
  /** The tempo and meter the run finds replace the saved ones, through `onDetect`. */
  detect?: boolean;
  /** Runs the tempo step only, and keeps the rest of the saved analysis. */
  tempoOnly?: boolean;
  /** A tempo the performer typed, which the tempo step tracks from. */
  hint?: TempoHintOptions;
  /** Runs the sections step after the tempo step, on the grid the tempo step tracked. */
  sections?: boolean;
}

const notice = (value: Notice | null): Notice[] => (value ? [value] : []);

/** The saved analysis when it was run on the audio the song has now. Detecting again keeps the rest of it, so it is only reused for the same audio. */
function savedFor(songKey: string, audioId: string): SongAnalysis | undefined {
  const saved = storedAnalysis(songKey).read();
  return saved?.audioId === audioId ? saved : undefined;
}

export function useSongAnalysis(input: SongAnalysisInput): SongAnalysisControl {
  const [step, setStep] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  // The latest input, read when a run starts or finishes, so a run never uses values from the render that started it.
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  const controller = useRef<AbortController | null>(null);
  const resume = useRef<Resume | null>(null);

  const start = (from: Resume, override?: { beatsPerBar?: number }) => {
    const { mix, stems, chordChanges, chordName, songKey } = latest.current;
    const beatsPerBar = override?.beatsPerBar ?? latest.current.beatsPerBar;
    if (!mix) return;
    const run = new AbortController();
    controller.current = run;
    const audio = buildAnalysisAudio({ mix, stems, beatsPerBar, chordChanges, chordName });
    const audioId = songAudioId(mix, stems);
    // The grid the tempo step tracked, kept for the sections step: it is too large for the analysis record.
    const captured: { grid: BeatGrid | null } = { grid: null };
    const tempo = tempoStep((grid) => {
      captured.grid = grid;
      // A performer's own grid is kept, unless the performer asked for the tempo again. The analysis's grid is replaced, so it always agrees
      // with the meter it was laid out for.
      if (!from.detect && readStoredBand(songKey).grid && !gridFromAnalysis(songKey)) return;
      writeStoredBand(songKey, { beatGrid: grid });
      setSetting(songKey, ":options", JSON.stringify({ ...readOptions(songKey, {}), beatGridSource: "analysis" }));
    }, from.hint);
    // The sections step uses the grid this run tracked, or the one saved with the song when the tempo step did not run.
    const sections = sectionsStep(() => captured.grid ?? readStoredBand(songKey).grid ?? null);
    // The lyrics step is the slowest, so it runs last, and only for a song with no lyrics yet (it never replaces a chart).
    const lyrics = loadLyricsOnAnalysis() && !getSetting(songKey, ":lyrics").trim() ? [analysisLyrics(songKey)] : [];
    const steps = from.tempoOnly
      ? from.sections
        ? [tempo, sections]
        : [tempo]
      : [loudnessStep(), silenceStep(), partsStep(), chordsStep(), tempo, keyStep(), sections, ...lyrics];
    // The label fills in when the first step starts, so it never names a step that has not begun.
    setStep(null);
    setNotices([]);
    setDetecting(!!from.tempoOnly);
    void runSongAnalysis({
      audioId,
      audio,
      steps,
      settings: storedAnalysis(songKey),
      from: from.from,
      partial: from.partial ?? (from.tempoOnly ? savedFor(songKey, audioId) : undefined),
      force: from.force,
      signal: run.signal,
      onStep: (_, name) => setStep(name),
    }).then((outcome) => {
      // A run that was superseded, cancelled or interrupted leaves the state to whoever stopped it.
      if (controller.current !== run) return;
      controller.current = null;
      if (outcome.status === "interrupted") {
        // A forced run stays forced, so a saved analysis of the old meter is not taken in its place.
        const next: Resume = {
          from: outcome.next,
          partial: outcome.analysis,
          force: from.force,
          detect: from.detect,
          tempoOnly: from.tempoOnly,
          hint: from.hint,
          sections: from.sections,
        };
        // Playback may have stopped while this step was still running. The effect below has already seen that, so restart here.
        if (latest.current.playing) resume.current = next;
        else start(next);
        return;
      }
      setStep(null);
      setDetecting(false);
      if (outcome.status !== "complete") return;
      setMessage(describeAnalysis(outcome.analysis));
      const found: Notice[] = [];
      if (from.detect) {
        if (outcome.analysis.tempo) found.push(...notice(latest.current.onDetect(outcome.analysis.tempo, outcome.analysis.meter ?? null)));
      } else {
        if (outcome.analysis.tempo) found.push(...notice(latest.current.onTempo(outcome.analysis.tempo)));
        if (outcome.analysis.meter) found.push(...notice(latest.current.onMeter(outcome.analysis.meter)));
      }
      setNotices(found);
      // A detect run only ran the tempo, so the rest of the saved analysis is not handed back again. A find-the-beat run also re-ran the sections.
      if (from.tempoOnly) {
        if (from.sections && outcome.analysis.sections) latest.current.onSections(outcome.analysis.sections, true);
        return;
      }
      if (outcome.analysis.loudness) latest.current.onLoudness(outcome.analysis.loudness);
      if (outcome.analysis.parts) latest.current.onParts(outcome.analysis.parts);
      if (outcome.analysis.silence) latest.current.onSilence(outcome.analysis.silence);
      if (outcome.analysis.sections) latest.current.onSections(outcome.analysis.sections, false);
    });
  };

  // Restarts the run from the start: the one that was running is cancelled and dropped first. Nothing restarts during playback.
  const restart = (from: Resume, override?: { beatsPerBar?: number }) => {
    if (latest.current.playing) return;
    controller.current?.abort("cancel");
    controller.current = null;
    start(from, override);
  };

  // Starts a run for a new song or new stems, and cancels the one that was running for the old ones. During playback the run waits.
  useEffect(() => {
    setMessage(null);
    resume.current = latest.current.playing ? { from: 0 } : null;
    if (!latest.current.playing) start({ from: 0 });
    return () => {
      controller.current?.abort("cancel");
      controller.current = null;
    };
    // The run is keyed on the song and its audio; the other inputs are read through `latest`.
  }, [input.songKey, input.mix, input.stems]);

  // Playback stops a run in progress, and the run resumes once playback stops.
  useEffect(() => {
    if (input.playing) {
      controller.current?.abort(PLAYBACK_INTERRUPT);
      return;
    }
    if (resume.current && !controller.current) {
      const next = resume.current;
      resume.current = null;
      start(next);
    }
    // Only the playing flag starts or stops a run here.
  }, [input.playing]);

  return {
    step,
    detecting,
    message,
    notices,
    rerun(beatsPerBar) {
      restart({ from: 0, force: true }, { beatsPerBar });
    },
    detect() {
      restart({ from: 0, force: true, detect: true, tempoOnly: true });
    },
    findBeat(hint) {
      restart({ from: 0, force: true, detect: true, tempoOnly: true, sections: true, hint });
    },
    analyseAgain() {
      restart({ from: 0, force: true, detect: true });
    },
    show: setNotices,
    cancel() {
      resume.current = null;
      controller.current?.abort("cancel");
      controller.current = null;
      setStep(null);
      setDetecting(false);
    },
  };
}
