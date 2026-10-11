// Web Worker: NAM text + Valeton's test signal in, the 8840-byte SnapTone clone out (about 10 s of CPU, kept off the
// UI thread). Each pedal family's upload file is cut from the clone (convert.ts snapToneFile).
import { readSignalWav } from "@shared/host/snaptone";
import a1KernelUrl from "./a1kernel.wasm?url";
import a2KernelUrl from "./a2kernel.wasm?url";
import { namToCloneBlob } from "./pipeline";
import type { ConvertReply, ConvertRequest } from "./convert";

const post = (msg: ConvertReply, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

async function fetchKernel(arch: "A1" | "A2"): Promise<ArrayBuffer> {
  const res = await fetch(arch === "A2" ? a2KernelUrl : a1KernelUrl);
  if (!res.ok) throw new Error(`Couldn't load the SnapTone converter (${res.status})`);
  return res.arrayBuffer();
}

self.onmessage = async (e: MessageEvent<ConvertRequest>) => {
  try {
    const excitation = readSignalWav(e.data.signalWav);
    const clone = await namToCloneBlob(e.data.namText, excitation, fetchKernel, (phase, fraction) => post({ type: "progress", phase, fraction }));
    post({ type: "done", clone }, [clone.buffer]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
