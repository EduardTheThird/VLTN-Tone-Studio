// Runs the song analysis for the loaded song, once its audio is known. It runs when a song opens or its stems change (a split or an import),
// never during playback. Playback interrupts a run; the run resumes from the step it stopped at once playback stops. Leaving the song
// cancels it. The results are saved with the song and handed back to the panel, which decides what to apply.

import { useEffect, useRef, useState } from "react";
import { beatSources } from "@/song/band/request";
import { readStoredBand, writeStoredBand } from "@/song/band/stored";
import type { Stems, PcmAudio, StemName } from "@/song/types";
import { keyAudio } from "@/song/performance/key";
import { readOptions, setSetting } from "@/song/performance/settings";
import {
  describeAnalysis,
  parseAnalysis,
  songAudioId,
  PLAYBACK_INTERRUPT,
  runSongAnalysis,
  type AnalysisAudio,
  type AnalysisSettings,
  type LoudnessResult,
  type MeterResult,
  type SongAnalysis,
  type TempoResult,
} from "@/song/analysis/song-analysis";
import { chordsStep, keyStep, loudnessStep, tempoStep } from "@/song/analysis/steps";

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
  /** Called with the tempo a finished run found. The panel decides whether to apply it. */
  onTempo(tempo: TempoResult): void;
  /** Called with the meter a finished run found. The panel decides whether to apply it. */
  onMeter(meter: MeterResult): void;
  /** Called with the loudness a finished run measured. The panel saves it when the song has none yet. */
  onLoudness(loudness: LoudnessResult): void;
}

export interface SongAnalysisControl {
  /** The step being run, or null when idle. */
  step: string | null;
  /** What the last finished run found, as one line. */
  message: string | null;
  /** Stops the run and drops it. The song is analysed again when it is next opened. */
  cancel(): void;
}

interface Resume {
  from: number;
  partial?: SongAnalysis;
}

export function useSongAnalysis(input: SongAnalysisInput): SongAnalysisControl {
  const [step, setStep] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The latest input, read when a run starts or finishes, so a run never uses values from the render that started it.
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  const controller = useRef<AbortController | null>(null);
  const resume = useRef<Resume | null>(null);

  const start = (from: Resume) => {
    const { mix, stems, beatsPerBar, chordChanges, chordName, songKey } = latest.current;
    if (!mix) return;
    const run = new AbortController();
    controller.current = run;
    const audio: AnalysisAudio = {
      mix,
      sources: beatSources(stems, mix),
      sampleRate: mix.sampleRate,
      beatsPerBar,
      chordChanges,
      keySource: keyAudio(stems, mix),
      chordSource: chordName && stems?.[chordName] ? { name: chordName, audio: stems[chordName] } : null,
    };
    const audioId = songAudioId(mix, stems);
    const tempo = tempoStep((grid) => {
      if (!readStoredBand(songKey).grid) writeStoredBand(songKey, { beatGrid: grid });
    });
    setStep("tempo");
    void runSongAnalysis({
      audioId,
      audio,
      steps: [loudnessStep(), tempo, chordsStep(), keyStep()],
      settings: storedAnalysis(songKey),
      from: from.from,
      partial: from.partial,
      signal: run.signal,
      onStep: (_, name) => setStep(name),
    }).then((outcome) => {
      // A run that was superseded, cancelled or interrupted leaves the state to whoever stopped it.
      if (controller.current !== run) return;
      controller.current = null;
      if (outcome.status === "interrupted") {
        resume.current = { from: outcome.next, partial: outcome.analysis };
        return;
      }
      setStep(null);
      if (outcome.status !== "complete") return;
      setMessage(describeAnalysis(outcome.analysis));
      if (outcome.analysis.tempo) latest.current.onTempo(outcome.analysis.tempo);
      if (outcome.analysis.meter) latest.current.onMeter(outcome.analysis.meter);
      if (outcome.analysis.loudness) latest.current.onLoudness(outcome.analysis.loudness);
    });
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
    message,
    cancel() {
      resume.current = null;
      controller.current?.abort("cancel");
      controller.current = null;
      setStep(null);
    },
  };
}
