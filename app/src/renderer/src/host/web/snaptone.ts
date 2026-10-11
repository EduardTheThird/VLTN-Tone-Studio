import { readSignalWav, type SnapToneApi } from "@shared/host/snaptone";
import { HostError } from "@shared/ipc";
import { pickFiles } from "./pick-files";

// Browser build: the chosen test signal is kept in memory for this page load. signal() hands out copies: the
// converter transfers its buffer to a worker.
let kept: Uint8Array | null = null;

export const webSnapTone: SnapToneApi = {
  hasSignal: async () => kept !== null,
  signal: async () => kept?.slice() ?? null,
  async chooseSignal() {
    const [file] = await pickFiles(".wav,audio/wav");
    if (!file) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      readSignalWav(bytes);
    } catch (e) {
      throw new HostError("invalid", e instanceof Error ? e.message : String(e));
    }
    kept = bytes;
    return bytes;
  },
};
