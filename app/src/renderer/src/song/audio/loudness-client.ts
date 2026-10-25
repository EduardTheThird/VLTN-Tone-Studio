import type { PcmAudio } from "../types";
import type { LoudnessReply, LoudnessRequest } from "./loudness-worker";

// Measures a song's loudness in a worker and resolves with the level in LUFS. The caller keeps its own buffers: they are copied before
// they are transferred.

/** The song's integrated loudness, in LUFS (-Infinity for silence). Rejects if the worker fails. */
export function measureLoudnessInWorker(pcm: PcmAudio): Promise<number> {
  const worker = new Worker(new URL("./loudness-worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const finish = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<LoudnessReply>) => {
      finish();
      if ("error" in event.data) reject(new Error(event.data.error));
      else resolve(event.data.lufs);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("The loudness worker failed. Try again."));
    };
    const copy: PcmAudio = { sampleRate: pcm.sampleRate, channels: pcm.channels.map((channel) => channel.slice()) };
    const request: LoudnessRequest = { id: 0, pcm: copy };
    worker.postMessage(request, copy.channels.map((channel) => channel.buffer));
  });
}
