// Builds the audio one song's analysis runs on, from its mix and stems. The panel and the headless batch (spec 72) both build it here, so a
// song analysed from the Library gets the same sources, key stem and chord stem as one analysed on the Performance screen.

import { beatSources } from "../band/request";
import { keyAudio } from "../performance/key";
import type { PcmAudio, Stems, StemName } from "../types";
import type { AnalysisAudio } from "./song-analysis";

/** The inputs that come from the song itself: its mix, its stems, its meter, its chart's chord changes, and the chosen chord stem. */
export interface SongAudioInput {
  mix: PcmAudio;
  stems: Stems | null;
  beatsPerBar: number;
  chordChanges: number[];
  /** The stem the chords are read from. Empty when none is chosen. */
  chordName: StemName | "";
}

/** The audio an analysis runs on: the beat sources, the key stem and the chord stem, chosen the same way for every song. */
export function buildAnalysisAudio({ mix, stems, beatsPerBar, chordChanges, chordName }: SongAudioInput): AnalysisAudio {
  return {
    mix,
    stems,
    sources: beatSources(stems, mix),
    sampleRate: mix.sampleRate,
    beatsPerBar,
    chordChanges,
    keySource: keyAudio(stems, mix),
    chordSource: chordName && stems?.[chordName] ? { name: chordName, audio: stems[chordName] } : null,
  };
}
