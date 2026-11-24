import { decodeFlac } from "@shared/flac";
import { runBandJob, runBandPreview, transferables } from "./band-job";
import type { BandWorkerMessage, BandWorkerReply } from "./band-client";
import { keysInstrument } from "./keys";
import { kitFor } from "./arrangement";
import { loadSampleSetWith, type BassBank, type SampleSet, type SampleCache, type SampledKeys } from "./samples";

// The decoded samples live as long as this worker. The client keeps one worker across jobs, so a second render does not decode them again.
// The worker decodes with decodeFlac directly: it is already off the window's thread, so it does not need another worker for each file.
// Only the kit a request names is decoded, and each kit is kept once it has been.
const samples = new Map<string, Promise<SampleSet>>();
let activeBass: BassBank = "none";
const decodedSamples: SampleCache = new Map();
let decodedBass: SampleCache = new Map();

function loadSamples(urls: Record<string, string>, kit: string, bass: BassBank, keys: readonly SampledKeys[]): Promise<SampleSet> {
  if (bass !== "none" && bass !== activeBass) {
    decodedBass = new Map();
    for (const key of samples.keys()) if (key.split(":")[1] === activeBass) samples.delete(key);
    activeBass = bass;
  }
  const key = `${kit}:${bass}:${keys.join(",")}`;
  let set = samples.get(key);
  if (!set) {
    set = loadSampleSetWith(new Map(Object.entries(urls)), async (file) => decodeFlac(new Uint8Array(file)), kit, decodedSamples, bass, decodedBass, keys).catch((error: unknown) => {
      if (samples.get(key) === set) samples.delete(key);
      throw error;
    });
    samples.set(key, set);
  }
  return set;
}

function post(reply: BandWorkerReply, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(reply, transfer);
}

async function run({ id, request, preview }: BandWorkerMessage): Promise<void> {
  const stage = (name: "loading" | "generating" | "rendering") => post({ id, stage: name });
  try {
    stage("loading");
    const { settings } = request;
    const bass = !settings.parts.bass ? "none" : settings.bassSampleVersion === 2 ? settings.bassSound : "legacy";
    const keys = request.parts.keys ? [...new Set(request.plans
      .filter((plan) => plan.play.keys)
      .map((plan) => keysInstrument(plan, settings.keys))
      .filter((instrument): instrument is SampledKeys => instrument !== "organ"))].sort() : [];
    const set = await loadSamples(request.sampleUrls, kitFor(settings), bass, keys);
    const result = preview ? runBandPreview(request, set, preview.fromTime, preview.bars, stage) : runBandJob(request, set, stage);
    post({ id, result }, transferables(result));
  } catch (error) {
    post({ id, error: error instanceof Error ? error.message : String(error) });
  }
}

self.onmessage = (event: MessageEvent<BandWorkerMessage>) => {
  void run(event.data);
};
