// Runs the band pipeline in a worker, so generating and rendering a song does not block the window (spec 50, commit 5b). The worker is
// kept between jobs, so the decoded samples are decoded once per run of renders, not once per render. Cancelling ends the worker at once,
// which also drops those samples. Starting a job while another runs cancels the other one. Call these only while playback is stopped.

import type { BandRequest, BandResult, BandStage } from "./band-job";
import { monoSum } from "./beat-grid";
import { sampleFileUrls } from "./samples";

/** What the client sends. With `preview`, the worker renders `bars` bars from `fromTime`; without it, the whole song. */
export interface BandWorkerMessage {
  id: number;
  request: BandRequest;
  preview?: { fromTime: number; bars: number };
}

/** What the worker answers: a stage as it starts, then one result or one error. */
export type BandWorkerReply = { id: number; stage: BandStage } | { id: number; result: BandResult } | { id: number; error: string };

export interface BandJob {
  /** Resolves with the rendered parts, or rejects with an AbortError after `cancel`. */
  done: Promise<BandResult>;
  /** Calls `listener` with each stage the job reaches from now on. */
  onProgress(listener: (stage: BandStage) => void): void;
  cancel(): void;
}

interface Current {
  id: number;
  listeners: ((stage: BandStage) => void)[];
  resolve(result: BandResult): void;
  reject(error: Error): void;
  cancel(): void;
}

let worker: Worker | null = null;
let current: Current | null = null;
let nextId = 1;

/** The bundled sample URLs, made absolute. The worker fetches them, and a relative URL would resolve against the worker's own file. */
export function bandSampleUrls(): Record<string, string> {
  const base = typeof location === "undefined" ? undefined : location.href;
  return Object.fromEntries([...sampleFileUrls()].map(([file, url]) => [file, base ? new URL(url, base).href : url]));
}

function abortError(): Error {
  const error = new Error("Generating the band parts was cancelled.");
  error.name = "AbortError";
  return error;
}

function dropWorker(): void {
  worker?.terminate();
  worker = null;
}

function workerFor(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./band-worker.ts", import.meta.url), { type: "module" });
  created.onmessage = (event: MessageEvent<BandWorkerReply>) => {
    const reply = event.data;
    const job = current;
    if (!job || reply.id !== job.id) return;
    if ("result" in reply) {
      current = null;
      job.resolve(reply.result);
    } else if ("error" in reply) {
      current = null;
      job.reject(new Error(reply.error));
    } else {
      for (const listener of job.listeners) listener(reply.stage);
    }
  };
  created.onerror = () => {
    dropWorker();
    const job = current;
    current = null;
    job?.reject(new Error("Generating the band parts could not finish."));
  };
  worker = created;
  return created;
}

/**
 * The request with its follow audio summed to one channel, the same as the beat grid's source. Only that mono buffer is sent, and it is
 * transferred rather than copied.
 */
function withMonoFollow(request: BandRequest): BandRequest {
  if (!request.follow) return request;
  const { source, audio } = request.follow;
  const mono = monoSum([audio]);
  return { ...request, follow: { source, audio: { sampleRate: audio.sampleRate, channels: [mono] } } };
}

function start(body: Omit<BandWorkerMessage, "id">): BandJob {
  current?.cancel();
  const id = nextId++;
  let resolve!: (result: BandResult) => void;
  let reject!: (error: Error) => void;
  const done = new Promise<BandResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const listeners: ((stage: BandStage) => void)[] = [];
  const job: Current = {
    id,
    listeners,
    resolve,
    reject,
    cancel() {
      if (current !== job) return;
      current = null;
      dropWorker();
      reject(abortError());
    },
  };
  current = job;
  const transfer = body.request.follow ? body.request.follow.audio.channels.map((channel) => channel.buffer as ArrayBuffer) : [];
  workerFor().postMessage({ id, ...body } satisfies BandWorkerMessage, transfer);
  return {
    done,
    onProgress: (listener) => {
      listeners.push(listener);
    },
    cancel: () => job.cancel(),
  };
}

/** Generates and renders the whole song's drum and bass parts, as the request asks. */
export function startBandRender(request: BandRequest): BandJob {
  return start({ request: withMonoFollow(request) });
}

/** Renders `bars` bars of the parts from `fromTime`, for listening. Nothing is saved. */
export function renderPreview(request: BandRequest, fromTime: number, bars = 4): BandJob {
  return start({ request: withMonoFollow(request), preview: { fromTime, bars } });
}
