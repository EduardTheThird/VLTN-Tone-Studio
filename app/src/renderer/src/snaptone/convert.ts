import { host } from "@/host";
import { cloneToSnapToneFile } from "@/gp5/lib/snaptone.mjs";
import { toGp200SnapTone } from "@/gp200/lib/snaptone.mjs";
import { useDevice } from "@/state/device";
import { DEFAULT_DEVICE, isGp5Family } from "@/state/device-model";
import type { DeviceKey } from "@/state/device-types";
import type { ClonePhase } from "./pipeline";

export interface ConvertRequest {
  namText: string;
  /** Valeton's nam_input_wav.wav (see shared/host/snaptone.ts) */
  signalWav: Uint8Array;
  /** Optional cab IR (raw WAV bytes) baked into the SnapTone */
  cabIrWav?: Uint8Array;
}

export type ConvertReply =
  | { type: "progress"; phase: ClonePhase; fraction: number }
  | { type: "done"; clone: Uint8Array }
  | { type: "error"; message: string };

/** Share of the total time each phase takes (measured in Node: resample 0.8 s, render 3.9 s, clone 7 s). */
const PHASE_SPAN: Record<ClonePhase, [number, number]> = { excitation: [0, 0.07], render: [0.07, 0.4], clone: [0.4, 1] };

/**
 * Convert a NAM A1 or A2 model (checked by shared/nam.ts prepareNam) into the 8840-byte SnapTone clone, in a Web
 * Worker; snapToneFile cuts a pedal's upload file from it. `onProgress` gets an overall fraction 0..1 (the clone phase
 * reports only its start). `cabIrWav` (raw WAV bytes) is a cab IR baked in after the model; a WAV the worker can't read
 * rejects with a readable message.
 */
export async function convertToClone(
  namText: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
  cabIrWav?: Uint8Array,
): Promise<Uint8Array> {
  const signalWav = await host.snaptone.signal();
  if (!signalWav) throw new Error("Making a SnapTone needs Valeton's test signal (nam_input_wav.wav). Choose it first.");
  if (signal?.aborted) throw new DOMException("Conversion cancelled", "AbortError");
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  return new Promise<Uint8Array>((resolve, reject) => {
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Conversion cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort);
    worker.onmessage = (e: MessageEvent<ConvertReply>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        const [from, to] = PHASE_SPAN[msg.phase];
        onProgress?.(from + (to - from) * msg.fraction);
      } else {
        finish();
        if (msg.type === "done") resolve(msg.clone);
        else reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || "The SnapTone converter stopped"));
    };
    // The IR is copied so the caller keeps its bytes (they may be reused for another conversion).
    const cabIr = cabIrWav?.slice();
    const request: ConvertRequest = { namText, signalWav, cabIrWav: cabIr };
    worker.postMessage(request, cabIr ? [signalWav.buffer, cabIr.buffer] : [signalWav.buffer]);
  });
}

/**
 * The SnapTone upload file `device` takes, cut from a clone: the GP-5 family's 2696-byte file (Suite's cut-down
 * clone), or the GP-200 family's 4744-byte one, which keeps 1024 impulse-response taps.
 */
export function snapToneFile(clone: Uint8Array, device: DeviceKey): Uint8Array {
  return isGp5Family(device) ? cloneToSnapToneFile(clone) : toGp200SnapTone(clone);
}

/** convertToClone, then the upload file for the connected (or last connected) pedal. */
export async function convertToSnapTone(
  namText: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
  cabIrWav?: Uint8Array,
): Promise<Uint8Array> {
  const clone = await convertToClone(namText, onProgress, signal, cabIrWav);
  return snapToneFile(clone, useDevice.getState().device ?? DEFAULT_DEVICE);
}
