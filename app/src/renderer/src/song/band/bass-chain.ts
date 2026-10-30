// The real bass chain for bass-tone.ts: the capture's offline NAM render (the full model, not the Lite one, since there is no live
// budget here) with the cab IR convolved after it. The engine is imported when a bass tone is rendered, so the song code does not load
// the NAM engine until a Generate asks for it.
import { FLAT_SHAPING } from "@/screens/capture/nam/shaping";
import type { BassChain } from "./bass-tone";

const BASS = "bass";

export const renderBassChain: BassChain = async (model, input, ir, inputDb, outputDb) => {
  const { renderOffline, SLIM_SIZE } = await import("@/screens/capture/audio/engine");
  return renderOffline(
    model,
    { id: BASS, slimSize: SLIM_SIZE.full },
    { shaping: { ...FLAT_SHAPING, driveDb: inputDb }, gainDb: { [BASS]: outputDb } },
    input,
    ir,
  );
};
