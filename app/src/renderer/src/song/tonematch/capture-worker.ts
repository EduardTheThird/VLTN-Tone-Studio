// Web Worker: renders NAM captures on the guitar part of Valeton's test signal and compares them with the song's
// guitar stem (capture-match.ts). About a second or two per capture, kept off the UI thread.
import { readSignalWav } from "@shared/host/snaptone";
import { fetchKernel } from "@/snaptone/fetch-kernel";
import { evaluateCapture, excitationCache, type StemTarget } from "./capture-match";
import type { CaptureWorkerReply, CaptureWorkerRequest } from "./capture-run";

const post = (msg: CaptureWorkerReply) => self.postMessage(msg);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

let setup: { excitationAt: (rate: number) => Float32Array; target: StemTarget } | null = null;

self.onmessage = async (e: MessageEvent<CaptureWorkerRequest>) => {
  const req = e.data;
  if (req.type === "init") {
    try {
      setup = { excitationAt: excitationCache(readSignalWav(req.signalWav)), target: req.target };
    } catch (err) {
      post({ type: "error", message: message(err) });
    }
    return;
  }
  if (!setup) return post({ type: "failed", id: req.id, message: "The capture ranking wasn't set up" });
  try {
    const fit = await evaluateCapture(req.namText, req.gear, setup.excitationAt, fetchKernel, setup.target, (fraction) => post({ type: "progress", id: req.id, fraction }));
    post({ type: "fit", id: req.id, fit });
  } catch (err) {
    post({ type: "failed", id: req.id, message: message(err) });
  }
};
