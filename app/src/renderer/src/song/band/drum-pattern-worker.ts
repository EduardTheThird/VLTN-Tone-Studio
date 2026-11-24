import { analyseBeats } from "./beat-grid";
import type { DrumPatternCheck } from "./drum-pattern-client";
import { isBasicDrumPattern } from "./drum-transcribe";
import { drumHits } from "./drummer-timing";

self.onmessage = ({ data }: MessageEvent<DrumPatternCheck>) => {
  const { mono, sampleRate, plans, grid, beats, tempoHint } = data;
  const drums = { sampleRate, channels: [mono] };
  const effectiveGrid = grid ?? analyseBeats([drums], sampleRate, beats, [], { tempoHint }).grid;
  self.postMessage(isBasicDrumPattern(drumHits(drums), effectiveGrid, plans));
};
