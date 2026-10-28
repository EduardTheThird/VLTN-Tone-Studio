import { detectBeatGrid } from "./beat-grid";
import type { BeatGridMessage } from "./beat-grid-client";

self.onmessage = (event: MessageEvent<BeatGridMessage>) => {
  const { mono, sampleRate, beatsPerBar, chordChanges } = event.data;
  try {
    self.postMessage({ grid: detectBeatGrid([{ sampleRate, channels: [mono] }], sampleRate, beatsPerBar, chordChanges) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
