import {
  findModel,
  MODEL_CHECKSUM_ERROR,
  MODEL_FILES,
  MODEL_MISSING_ERROR,
  modelDownloadError,
  modelFiles,
  sha256Hex,
  UNKNOWN_MODEL_ERROR,
  type ModelFile,
  type ModelProgress,
  type SongHostApi,
} from "@shared/host/song";
import { HostError } from "@shared/ipc";

// Browser build: each model file is cached in Cache Storage under its pinned URL, checked before it is stored.
// A model's files download one after another, so an interrupted download keeps the files already finished
// (Cache Storage can't append to a partial entry). Exported files are downloads.
const CACHE = "vltn-models";
const listeners = new Set<(p: ModelProgress) => void>();
const PROGRESS_EVERY_BYTES = 1 << 20;
const pending = new Map<string, Promise<void>>();

const openCache = () => caches.open(CACHE);

/** Download `f`, check it and store it; `onBytes` gets the bytes received so far. */
async function download(f: ModelFile, onBytes: (received: number) => void): Promise<void> {
  let res: Response;
  try {
    res = await fetch(f.url);
  } catch {
    throw new HostError("network", modelDownloadError(null));
  }
  if (!res.ok || !res.body) throw new HostError("network", modelDownloadError(res.status));
  const bytes = new Uint8Array(f.bytes);
  let received = 0;
  let reported = 0;
  const reader = res.body.getReader();
  onBytes(0);
  for (;;) {
    const chunk = await reader.read().catch(() => {
      throw new HostError("network", modelDownloadError(null));
    });
    if (chunk.done) break;
    if (received + chunk.value.byteLength > f.bytes) throw new HostError("invalid", MODEL_CHECKSUM_ERROR);
    bytes.set(chunk.value, received);
    received += chunk.value.byteLength;
    if (received - reported >= PROGRESS_EVERY_BYTES) {
      reported = received;
      onBytes(received);
    }
  }
  onBytes(received);
  if (received !== f.bytes || (await sha256Hex(bytes)) !== f.sha256) throw new HostError("invalid", MODEL_CHECKSUM_ERROR);
  await (await openCache()).put(f.url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
}

/** One download per file at a time; a second request joins it. */
function downloadOnce(f: ModelFile, onBytes: (received: number) => void): Promise<void> {
  let job = pending.get(f.file);
  if (!job) {
    job = download(f, onBytes).finally(() => pending.delete(f.file));
    pending.set(f.file, job);
  }
  return job;
}

function downloadFile(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/wav" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const webSong: SongHostApi = {
  async downloadedFiles() {
    const cache = await openCache();
    const files = [...MODEL_FILES.values()];
    const have = await Promise.all(files.map(async (f) => (await cache.match(f.url)) !== undefined));
    return files.filter((_, i) => have[i]).map((f) => f.file);
  },
  async downloadModel(id) {
    const model = findModel(id);
    if (!model) throw new HostError("invalid", UNKNOWN_MODEL_ERROR);
    const cache = await openCache();
    const missing: ModelFile[] = [];
    for (const f of modelFiles(model)) if (!(await cache.match(f.url))) missing.push(f);
    const total = missing.reduce((sum, f) => sum + f.bytes, 0);
    let done = 0;
    for (const f of missing) {
      await downloadOnce(f, (received) => listeners.forEach((cb) => cb({ received: done + received, total })));
      done += f.bytes;
    }
  },
  async modelFile(name) {
    const f = MODEL_FILES.get(name);
    if (!f) throw new HostError("invalid", UNKNOWN_MODEL_ERROR);
    const res = await (await openCache()).match(f.url);
    const bytes = res ? new Uint8Array(await res.arrayBuffer()) : null;
    if (!bytes || bytes.byteLength !== f.bytes) throw new HostError("not-found", MODEL_MISSING_ERROR);
    return bytes;
  },
  async deleteModel(id) {
    const model = findModel(id);
    if (!model) throw new HostError("invalid", UNKNOWN_MODEL_ERROR);
    const files = modelFiles(model);
    await Promise.allSettled(files.map((f) => pending.get(f.file)));
    const cache = await openCache();
    for (const f of files) await cache.delete(f.url);
  },
  onModelProgress(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  async saveFiles(files) {
    files.forEach((f) => downloadFile(f.name, f.bytes));
    return files.length === 1 ? files[0].name : `${files.length} files`;
  },
};
