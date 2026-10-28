import { detectBeatGrid } from "./beat-grid";
import type { BeatGridRequest } from "./beat-grid-client";

self.onmessage = (event: MessageEvent<BeatGridRequest>) => {
  const { sources, sampleRate, beatsPerBar, chordChanges } = event.data;
  try {
    self.postMessage({ grid: detectBeatGrid(sources, sampleRate, beatsPerBar, chordChanges) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
