// Web Worker: NAM text + Valeton's test signal (+ an optional cab IR WAV) in, the 8840-byte SnapTone clone out (about
// 10 s of CPU, kept off the UI thread). Each pedal family's upload file is cut from the clone (convert.ts snapToneFile).
import { readSignalWav } from "@shared/host/snaptone";
import { readWavMono } from "@/userir/convert";
import { fetchKernel } from "./fetch-kernel";
import { namToCloneBlob } from "./pipeline";
import type { ConvertReply, ConvertRequest } from "./convert";

const post = (msg: ConvertReply, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

self.onmessage = async (e: MessageEvent<ConvertRequest>) => {
  try {
    const excitation = readSignalWav(e.data.signalWav);
    const cabIr = e.data.cabIrWav && readWavMono(e.data.cabIrWav);
    const clone = await namToCloneBlob(e.data.namText, excitation, fetchKernel, (phase, fraction) => post({ type: "progress", phase, fraction }), cabIr);
    post({ type: "done", clone }, [clone.buffer]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
