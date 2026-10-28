import type { PcmAudio } from "../types";
import type { StretchReply, StretchRequest } from "./stretch-worker";
import type { StretchSettings } from "./stretch";

// Renders a stem's stretch in a worker and resolves with the result. The caller keeps its own buffers: they are copied before they
// are transferred, so the stems a session already holds stay playable while the render runs.

/** Renders `pcm` at `settings` in a worker. Rejects if the worker fails or the stretch throws. */
export function stretchInWorker(pcm: PcmAudio, settings: StretchSettings): Promise<PcmAudio> {
  const worker = new Worker(new URL("./stretch-worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const finish = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<StretchReply>) => {
      finish();
      if ("error" in event.data) reject(new Error(event.data.error));
      else resolve(event.data.pcm);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("The stretch worker failed. Try again, or play the song at its own speed."));
    };
    const copy: PcmAudio = { sampleRate: pcm.sampleRate, channels: pcm.channels.map((channel) => channel.slice()) };
    const request: StretchRequest = { id: 0, pcm: copy, settings };
    worker.postMessage(request, copy.channels.map((channel) => channel.buffer));
  });
}
