import { host } from "@/host";
import { sessionLog } from "@/state/session-log";
import type { ModelFile, SeparationModel, SeparationPass, StemName } from "@shared/host/song";
import type { PcmAudio } from "../types";
import { chunkCount } from "./demucs";
import { assembleStems, orderPasses, passRows, type SplitQuality } from "./options";
import type { Backend, WorkerReply, WorkerRequest } from "./protocol";

// UI-thread side of the separation workers. A model is one or more passes (shared/host/song.ts), each one model
// file run over the whole song: the worker holds one session at a time and swaps it between passes. The worker
// build follows the file (worker.ts for "webgpu" files, worker-cpu.ts for "wasm" ones). The worker and its last
// session stay loaded between splits and are shut down after IDLE_MS without work, since a session holds about a
// gigabyte. Loading, the backend (and why WebGPU wasn't used) and each split's timing go to the session log: a
// slow split is otherwise undiagnosable.

/** `backend` null: the pass's model is still starting (reading it, creating the session) */
export type SeparationProgress =
  /** `bytes`: the size of the whole download */
  | { stage: "model"; fraction: number; bytes: number }
  | { stage: "split"; fraction: number; backend: Backend | null; pass: number; passes: number };

export interface Separation {
  /** The model's stems, planar channels, 44.1 kHz */
  stems: Partial<Record<StemName, Float32Array[]>>;
  /** Where the passes ran, each backend once */
  backends: Backend[];
  /** Wall time of the split, loading each pass's model included (the download excluded) */
  seconds: number;
}

export interface SplitSettings {
  model: SeparationModel;
  quality: SplitQuality;
}

const IDLE_MS = 120_000;

interface Loaded {
  worker: Worker;
  runtime: ModelFile["runtime"];
  /** The file whose session is loaded */
  file: string;
  backend: Backend;
}

let loaded: Loaded | null = null;
/** Splits run one at a time: a new one waits for the cancelled one to let go of the worker. */
let lock: Promise<void> = Promise.resolve();
let idleTimer: number | undefined;
let active = 0;
let nextId = 1;
/** Files whose WebGPU session failed: loaded straight on WebAssembly from then on */
const gpuFailed = new Set<string>();

const aborted = () => new DOMException("Separation cancelled", "AbortError");
const send = (worker: Worker, msg: WorkerRequest, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);
const seconds = (since: number) => ((performance.now() - since) / 1000).toFixed(1);

function shutDown() {
  loaded?.worker.terminate();
  loaded = null;
}

/** Download the model's missing files (progress as stage "model"); an abort stops waiting, the download goes on. */
async function download(model: SeparationModel, onProgress: (p: SeparationProgress) => void, signal: AbortSignal): Promise<void> {
  const off = host.song.onModelProgress((p) => onProgress({ stage: "model", fraction: p.total ? p.received / p.total : 0, bytes: p.total }));
  const stop = Promise.withResolvers<never>();
  const onAbort = () => stop.reject(aborted());
  if (signal.aborted) onAbort();
  signal.addEventListener("abort", onAbort);
  try {
    await Promise.race([host.song.downloadModel(model.id), stop.promise]);
  } finally {
    signal.removeEventListener("abort", onAbort);
    off();
  }
}

/** A worker with `f`'s session loaded: the current one when it has it, else `f` loaded into it (or a new worker of `f`'s build). */
async function loadFile(f: ModelFile): Promise<Loaded> {
  if (loaded && loaded.runtime !== f.runtime) shutDown();
  if (loaded?.file === f.file) return loaded;
  const model = await host.song.modelFile(f.file);
  const worker =
    loaded?.worker ??
    (f.runtime === "webgpu"
      ? new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
      : new Worker(new URL("./worker-cpu.ts", import.meta.url), { type: "module" }));
  loaded = null;
  const gpu = f.runtime === "webgpu" && !gpuFailed.has(f.file);
  const started = performance.now();
  const { promise, resolve, reject } = Promise.withResolvers<Extract<WorkerReply, { type: "loaded" }>>();
  const onMessage = (e: MessageEvent<WorkerReply>) => {
    if (e.data.type === "loaded" && e.data.file === f.file) resolve(e.data);
    else if (e.data.type === "load-error" && e.data.file === f.file) reject(new Error(e.data.message));
  };
  const onError = (e: ErrorEvent) => reject(new Error(e.message || "The separation worker stopped"));
  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);
  try {
    send(worker, { type: "load", file: f.file, model, gpu, optimize: f.runtime === "webgpu" }, [model.buffer]);
    const reply = await promise;
    const why = f.runtime === "wasm" ? "this model runs on the processor only" : gpu ? `WebGPU unavailable: ${reply.gpuError}` : "WebGPU failed on this model before";
    const where = reply.backend === "webgpu" ? "WebGPU" : `WebAssembly, ${reply.threads} thread${reply.threads === 1 ? "" : "s"}; ${why}`;
    sessionLog("Stems", `Separation model ${f.file} started in ${seconds(started)} s (${where})`);
    if (gpu && reply.backend === "wasm") gpuFailed.add(f.file);
    loaded = { worker, runtime: f.runtime, file: f.file, backend: reply.backend };
    return loaded;
  } catch (e) {
    worker.terminate();
    const message = e instanceof Error ? e.message : String(e);
    sessionLog("Stems", `Separation model ${f.file} failed to start: ${message}`);
    throw new Error(`Couldn't start the separation model: ${message}`);
  } finally {
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onError);
  }
}

/** Run `pass` over the whole song in the loaded worker: its rows (planar channels) and where it ran. */
function runPass(
  { worker, file, backend: startBackend }: Loaded,
  audio: PcmAudio,
  pass: SeparationPass,
  quality: SplitQuality,
  onProgress: (fraction: number, backend: Backend) => void,
  signal: AbortSignal,
): Promise<{ stems: Float32Array[][]; backend: Backend }> {
  const id = nextId++;
  let backend = startBackend;
  let fraction = 0;
  const { promise, resolve, reject } = Promise.withResolvers<{ stems: Float32Array[][]; backend: Backend }>();
  const finish = () => {
    signal.removeEventListener("abort", abort);
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onError);
  };
  // Once aborted the pass is settled, but the worker may still report a fallback before it stops: keep listening to it
  // (not to errors, which the next split must not be killed by) until its last reply for this id.
  let stopped = false;
  const abort = () => {
    send(worker, { type: "cancel", id });
    stopped = true;
    signal.removeEventListener("abort", abort);
    worker.removeEventListener("error", onError);
    reject(aborted());
  };
  const onMessage = (e: MessageEvent<WorkerReply>) => {
    const msg = e.data;
    if (!("id" in msg) || msg.id !== id) return;
    if (msg.type === "progress") {
      if (stopped) return;
      fraction = msg.fraction;
      return onProgress(fraction, backend);
    }
    if (msg.type === "fallback") {
      backend = "wasm";
      gpuFailed.add(file);
      if (loaded?.worker === worker) loaded = { ...loaded, backend };
      sessionLog("Stems", `WebGPU failed while splitting ${file}, going on with WebAssembly: ${msg.message}`);
      return stopped ? undefined : onProgress(fraction, backend);
    }
    finish();
    if (stopped) return;
    if (msg.type === "error") {
      // The worker's session is gone or unusable (a lost GPU device, or the WebAssembly rebuild failed): the next load starts a fresh worker.
      if (backend === "webgpu") gpuFailed.add(file);
      if (loaded?.worker === worker) shutDown();
    }
    if (msg.type === "done") resolve({ stems: msg.stems, backend });
    else if (msg.type === "cancelled") reject(aborted());
    else reject(new Error(msg.message));
  };
  const onError = (e: ErrorEvent) => {
    finish();
    shutDown();
    sessionLog("Stems", `Separation worker stopped while splitting: ${e.message || "no message"}`);
    reject(new Error(e.message || "The separation worker stopped"));
  };
  signal.addEventListener("abort", abort);
  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);
  // The worker takes copies: the source stays playable while it splits.
  const channels = audio.channels.map((c) => c.slice());
  const request = { type: "split", id, channels, sources: pass.file.sources.length, rows: passRows(pass), overlap: quality.overlap, shifts: quality.shifts } as const;
  send(worker, request, channels.map((c) => c.buffer));
  return promise;
}

async function runPasses(audio: PcmAudio, { model, quality }: SplitSettings, onProgress: (p: SeparationProgress) => void, signal: AbortSignal): Promise<Separation> {
  const passes = orderPasses(model.passes, loaded?.file ?? null);
  const started = performance.now();
  const length = audio.channels[0].length;
  const chunks = chunkCount(length, quality.shifts, quality.overlap);
  sessionLog("Stems", `Splitting ${(length / audio.sampleRate).toFixed(1)} s of audio: ${model.label}, ${quality.label} (${passes.length} × ${chunks} chunks)`);
  const results: Float32Array[][][] = [];
  const backends: Backend[] = [];
  try {
    for (const [k, pass] of passes.entries()) {
      const progress = (fraction: number, backend: Backend | null) =>
        onProgress({ stage: "split", fraction: (k + fraction) / passes.length, backend, pass: k + 1, passes: passes.length });
      progress(0, null);
      const l = await loadFile(pass.file);
      if (signal.aborted) throw aborted();
      progress(0, l.backend);
      const res = await runPass(l, audio, pass, quality, progress, signal);
      results.push(res.stems);
      if (!backends.includes(res.backend)) backends.push(res.backend);
    }
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError")) sessionLog("Stems", `Split failed after ${seconds(started)} s: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
  sessionLog("Stems", `Split done in ${seconds(started)} s (${backends.join(" + ")})`);
  return { stems: assembleStems(passes, results), backends, seconds: (performance.now() - started) / 1000 };
}

/** Split 44.1 kHz stereo `audio` with the chosen model and quality in a worker; downloads the model on first use. */
export async function separateStems(audio: PcmAudio, settings: SplitSettings, onProgress: (p: SeparationProgress) => void, signal: AbortSignal): Promise<Separation> {
  clearTimeout(idleTimer);
  active++;
  try {
    await download(settings.model, onProgress, signal);
    const previous = lock;
    let release = () => {};
    lock = new Promise<void>((resolve) => (release = resolve));
    try {
      await previous;
      if (signal.aborted) throw aborted();
      return await runPasses(audio, settings, onProgress, signal);
    } finally {
      release();
    }
  } finally {
    if (--active === 0) idleTimer = window.setTimeout(shutDown, IDLE_MS);
  }
}
