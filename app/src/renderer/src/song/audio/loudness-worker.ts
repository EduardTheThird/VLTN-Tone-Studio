import { integratedLoudness } from "./loudness";
import type { PcmAudio } from "../types";

// Measures a song's integrated loudness off the main thread. The channels are transferred in, so the caller's copy is made before
// the request is sent (see loudness-client.ts).

export interface LoudnessRequest {
  id: number;
  pcm: PcmAudio;
}

export type LoudnessReply = { id: number; lufs: number } | { id: number; error: string };

self.onmessage = (event: MessageEvent<LoudnessRequest>) => {
  const { id, pcm } = event.data;
  try {
    self.postMessage({ id, lufs: integratedLoudness(pcm.channels, pcm.sampleRate) } satisfies LoudnessReply);
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) } satisfies LoudnessReply);
  }
};
