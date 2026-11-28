import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { HostError } from "@shared/ipc";
import { patchRc10rBank, readRc10rBank, readRc10rRecord } from "@shared/rc10r-bank";
import { patchRc10rMemory, readRc10rMemoryPair } from "@shared/rc10r-memory";
import { rc10rMemoryMap } from "@shared/rc10r-memory-map";
import { readRc10rSystemPair } from "@shared/rc10r-system";
import type { Rc10rBackupSummary, Rc10rLoopLibrary, Rc10rPedalReading, Rc10rStorageView, Rc10rWritePlan } from "@shared/host/rc10r";
import { syncPath, writeJsonAtomic } from "./fs-atomic";

const FILES = ["RC10R.RC0", "MEMORY1.RC0", "MEMORY2.RC0", "SYSTEM1.RC0", "SYSTEM2.RC0"] as const;
const WRITABLE = new Set(["RC10R.RC0", "MEMORY1.RC0", "MEMORY2.RC0"]);
const UUID = /^[a-f0-9-]{36}$/;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fail = (message: string): never => {
  throw new HostError("io", message);
};
const cancelled = (signal: AbortSignal) => {
  if (signal.aborted) throw new HostError("cancelled", "Transfer cancelled. Close the connection before using the pedal.");
};

export interface Rc10rVolume {
  root: string;
  identity: string;
}
interface BackupFile {
  path: string;
  bytes: number;
  sha256: string;
  /** Source modification time, so the next backup can link an unchanged loop instead of copying it (spec 175). */
  mtimeMs?: number;
  /** True when the file is a hard link to the same, unchanged file in an earlier backup. */
  linked?: boolean;
}
interface PedalFile {
  path: string;
  size: number;
  mtimeMs: number;
}
/** States whose backup is complete and verified. */
const COMPLETE = new Set(["backed-up", "planned", "writing", "partial", "written", "ejected", "finished", "recovered", "closed"]);
/** A backup from an interrupted write is kept until the player removes it on purpose. */
const KEEP = new Set(["writing", "partial"]);
const KEEP_NEWEST = 5;
const LOOP_PATH = /^ROLAND\/WAVE\/(\d{3})_([12])\/[^/\\]+\.wav$/i;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
interface Journal {
  version: 1;
  id: string;
  volume: string;
  date: string;
  state: string;
  files: BackupFile[];
  writes: string[];
}
interface Lease {
  id: string;
  owner: number;
  abort: AbortController;
  pending: boolean;
  volume?: Rc10rVolume;
  device?: { dev: number; ino: number };
  original?: Map<string, Uint8Array>;
  output?: Map<string, Uint8Array>;
  backup?: string;
  journal?: Journal;
  ejected: boolean;
}
export interface Rc10rStoreOptions {
  backupRoot: string;
  discover(): Promise<Rc10rVolume[]>;
  eject(volume: Rc10rVolume): Promise<void>;
  /** Fault injection operates on temporary fixture volumes in tests. */
  checkpoint?(phase: string, name: string): Promise<void>;
}

/** One owner holds both the planned bytes and their full backup. No renderer-supplied paths are accepted. */
export class Rc10rStore {
  private active?: Lease;
  constructor(private readonly options: Rc10rStoreOptions) {}
  get busy(): boolean {
    return !!this.active;
  }

  reserve(owner: number): string {
    if (this.active) throw new HostError("invalid", "An RC-10R connection is already open. Close it before starting another.");
    const id = randomUUID();
    this.active = { id, owner, abort: new AbortController(), pending: false, ejected: false };
    return id;
  }
  private lease(id: unknown, owner: number): Lease {
    const lease = this.active;
    if (typeof id !== "string" || !lease || id !== lease.id || owner !== lease.owner) throw new HostError("invalid", "This RC-10R connection has expired.");
    return lease;
  }
  private async run<T>(id: string, owner: number, action: (lease: Lease) => Promise<T>): Promise<T> {
    const lease = this.lease(id, owner);
    if (lease.pending) throw new HostError("invalid", "Wait for the current RC-10R operation to finish.");
    lease.pending = true;
    try {
      return await action(lease);
    } finally {
      lease.pending = false;
    }
  }
  cancel(id: string, owner: number): void {
    this.lease(id, owner).abort.abort();
  }

  private async root(lease: Lease): Promise<string> {
    const root = lease.volume?.root;
    if (!root || !lease.device || lease.ejected) return fail("The RC-10R storage connection is no longer available.");
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== lease.device.dev || stat.ino !== lease.device.ino || (await realpath(root)) !== root)
      return fail("The RC-10R volume changed. Reconnect and inspect it again.");
    return root;
  }
  private async safePath(lease: Lease, name: string): Promise<string> {
    if (!FILES.includes(name as (typeof FILES)[number])) return fail("Unsupported RC-10R data file.");
    let path = await this.root(lease);
    for (const part of ["ROLAND", "DATA", name]) {
      path = join(path, part);
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || stat.dev !== lease.device!.dev || (part === name ? !stat.isFile() : !stat.isDirectory()))
        return fail("The RC-10R layout changed or contains a link. No further writes are allowed.");
    }
    return path;
  }
  private async read(lease: Lease, name: string): Promise<Uint8Array> {
    const handle = await open(await this.safePath(lease, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.dev !== lease.device!.dev || stat.size > 8 * 1024 * 1024) return fail("The RC-10R data file has an unsupported size.");
      return new Uint8Array(await handle.readFile());
    } finally {
      await handle.close();
    }
  }
  private async snapshot(lease: Lease): Promise<Map<string, Uint8Array>> {
    const result = new Map<string, Uint8Array>();
    for (const name of FILES) result.set(name, await this.read(lease, name));
    readRc10rBank(result.get("RC10R.RC0")!);
    readRc10rMemoryPair(result.get("MEMORY1.RC0")!, result.get("MEMORY2.RC0")!);
    return result;
  }
  async inspect(id: string, owner: number): Promise<Rc10rStorageView> {
    return this.run(id, owner, async (lease) => {
      cancelled(lease.abort.signal);
      if (!lease.volume) {
        const volumes = await this.options.discover();
        if (volumes.length !== 1)
          return fail(
            volumes.length
              ? "More than one RC-10R volume is mounted. Disconnect the others."
              : "Waiting for RC-10R storage. Keep the pedal connected and try again.",
          );
        lease.volume = volumes[0];
        const stat = await lstat(volumes[0].root);
        lease.device = { dev: stat.dev, ino: stat.ino };
      }
      const recoveries = await this.recoveries(lease.volume.identity);
      try {
        lease.original = await this.snapshot(lease);
        const reading = await this.reading(lease).catch(() => undefined);
        return { id, patterns: readRc10rBank(lease.original.get("RC10R.RC0")!), recoveries, ...(reading ? { reading } : {}) };
      } catch (error) {
        lease.original = undefined;
        return { id, patterns: [], recoveries, problem: error instanceof Error ? error.message : String(error) };
      }
    });
  }

  /** Every regular file under ROLAND with its size and time, with the same link and volume checks as a backup. */
  private async listFiles(lease: Lease): Promise<PedalFile[]> {
    const root = await this.root(lease);
    const files: PedalFile[] = [];
    const walk = async (folder: string, depth: number): Promise<void> => {
      if (depth > 6) return fail("Unexpected folder depth on the pedal.");
      for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
        if (files.length > 5000 || entry.name.includes("\\") || entry.name === "..") return fail("Unexpected entry on the pedal.");
        const name = join(folder, entry.name),
          info = await lstat(join(root, name));
        if (info.isSymbolicLink() || info.dev !== lease.device!.dev) return fail("The pedal contains a link or another volume.");
        if (info.isDirectory()) await walk(name, depth + 1);
        else if (info.isFile()) files.push({ path: name.split(sep).join("/"), size: info.size, mtimeMs: info.mtimeMs });
      }
    };
    await walk("ROLAND", 0);
    return files;
  }
  /** The newest complete backup of this pedal whose files carry times, so unchanged loops can be linked. */
  private async previousBackup(volume: string): Promise<{ folder: string; files: Map<string, BackupFile> } | undefined> {
    let best: { folder: string; value: Journal } | undefined;
    for (const entry of await readdir(this.options.backupRoot).catch(() => [] as string[])) {
      if (!UUID.test(entry)) continue;
      const found = await this.journal(entry).catch(() => undefined);
      if (!found || found.value.volume !== volume || !COMPLETE.has(found.value.state)) continue;
      if (!best || found.value.date > best.value.date) best = found;
    }
    if (!best) return undefined;
    return { folder: best.folder, files: new Map(best.value.files.filter((f) => typeof f.mtimeMs === "number").map((f) => [f.path, f])) };
  }
  private reusable(previous: Awaited<ReturnType<Rc10rStore["previousBackup"]>>, file: PedalFile): BackupFile | undefined {
    if (!previous || !file.path.startsWith("ROLAND/WAVE/")) return undefined;
    const saved = previous.files.get(file.path);
    return saved && saved.bytes === file.size && saved.mtimeMs === file.mtimeMs ? saved : undefined;
  }
  /** Settings, memory map and storage sizes for the RC-10R card (specs 174, 177, 179). Problems are reported, never thrown. */
  private async reading(lease: Lease): Promise<Rc10rPedalReading> {
    const files = lease.original!;
    const result: Rc10rPedalReading = { storageBytes: 0, loopBytes: 0, backupCopyBytes: 0 };
    try {
      result.system = readRc10rSystemPair(files.get("SYSTEM1.RC0")!, files.get("SYSTEM2.RC0")!);
    } catch (error) {
      result.systemProblem = message(error);
    }
    try {
      result.memories = rc10rMemoryMap(readRc10rMemoryPair(files.get("MEMORY1.RC0")!, files.get("MEMORY2.RC0")!));
    } catch (error) {
      result.memoryProblem = message(error);
    }
    const previous = await this.previousBackup(lease.volume!.identity);
    for (const file of await this.listFiles(lease)) {
      result.storageBytes += file.size;
      if (file.path.startsWith("ROLAND/WAVE/")) result.loopBytes += file.size;
      if (!this.reusable(previous, file)) result.backupCopyBytes += file.size;
    }
    return result;
  }

  private async saveJournal(lease: Lease, state: string): Promise<void> {
    if (!lease.journal || !lease.backup) return;
    lease.journal.state = state;
    await writeJsonAtomic(join(lease.backup, "journal.json"), lease.journal);
  }
  private async copyFile(source: string, target: string, dev: number, signal: AbortSignal): Promise<BackupFile> {
    const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    const output = await open(target, "wx").catch(async (error) => {
      await input.close();
      throw error;
    });
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      const before = await input.stat();
      if (!before.isFile() || before.dev !== dev || before.size > 16 * 1024 ** 3) return fail("Unsupported file in the pedal backup.");
      const chunk = Buffer.alloc(1024 * 1024);
      for (;;) {
        cancelled(signal);
        const { bytesRead } = await input.read(chunk);
        if (!bytesRead) break;
        hash.update(chunk.subarray(0, bytesRead));
        for (let offset = 0; offset < bytesRead;) {
          const wrote = await output.write(chunk, offset, bytesRead - offset);
          if (!wrote.bytesWritten) return fail("The backup destination stopped accepting data.");
          offset += wrote.bytesWritten;
        }
        bytes += bytesRead;
      }
      const after = await input.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || bytes !== before.size)
        return fail("A pedal file changed during backup. Start again.");
      await output.sync();
    } finally {
      await Promise.all([input.close(), output.close()]);
    }
    const expected = hash.digest("hex");
    const check = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const actual = createHash("sha256");
    try {
      for await (const chunk of check.createReadStream()) actual.update(chunk);
    } finally {
      await check.close();
    }
    if (actual.digest("hex") !== expected) return fail("Backup verification failed. No pedal files were changed.");
    return { path: "", bytes, sha256: expected };
  }
  private async backup(lease: Lease): Promise<void> {
    const root = await this.root(lease);
    await mkdir(this.options.backupRoot, { recursive: true });
    const backupRoot = await realpath(this.options.backupRoot);
    const rel = relative(root, backupRoot);
    if (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)) return fail("The backup destination must be outside the pedal.");
    lease.backup = join(backupRoot, lease.id);
    await mkdir(lease.backup);
    const journal: Journal = {
      version: 1,
      id: lease.id,
      volume: lease.volume!.identity,
      date: new Date().toISOString(),
      state: "backing-up",
      files: [],
      writes: [],
    };
    lease.journal = journal;
    await this.saveJournal(lease, "backing-up");
    const previous = await this.previousBackup(lease.volume!.identity);
    let total = 0,
      count = 0;
    const walk = async (folder: string, depth: number): Promise<void> => {
      cancelled(lease.abort.signal);
      if (depth > 6) return fail("Unexpected folder depth on the pedal.");
      const source = join(root, folder),
        stat = await lstat(source);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== lease.device!.dev) return fail("The pedal backup contains a link or another volume.");
      await mkdir(join(lease.backup!, folder), { recursive: true });
      for (const entry of await readdir(source, { withFileTypes: true })) {
        if (++count > 5000 || entry.name.includes("\\") || entry.name === "..") return fail("Unexpected entry in the pedal backup.");
        const name = join(folder, entry.name),
          path = join(root, name),
          info = await lstat(path);
        if (info.isSymbolicLink() || info.dev !== lease.device!.dev) return fail("The pedal backup contains a link or another volume.");
        if (info.isDirectory()) await walk(name, depth + 1);
        else if (info.isFile()) {
          total += info.size;
          if (total > 32 * 1024 ** 3) return fail("The pedal backup exceeds 32 GB.");
          await this.options.checkpoint?.("backup-file", name);
          const relativePath = name.split(sep).join("/");
          const saved = this.reusable(previous, { path: relativePath, size: info.size, mtimeMs: info.mtimeMs });
          if (saved && (await this.linkSaved(previous!.folder, name, join(lease.backup!, name), saved.bytes))) {
            journal.files.push({ ...saved, path: relativePath, mtimeMs: info.mtimeMs, linked: true });
            continue;
          }
          const file = await this.copyFile(path, join(lease.backup!, name), lease.device!.dev, lease.abort.signal);
          journal.files.push({ ...file, path: relativePath, mtimeMs: info.mtimeMs });
        } else return fail("Unexpected file type on the pedal.");
      }
      await syncPath(join(lease.backup!, folder));
    };
    await walk("ROLAND", 0);
    await this.saveJournal(lease, "backed-up");
  }
  /** Links an unchanged loop from an earlier verified backup. Falls back to copying when the earlier file is missing or altered. */
  private async linkSaved(folder: string, name: string, target: string, bytes: number): Promise<boolean> {
    try {
      const source = join(folder, name),
        info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== bytes) return false;
      await link(source, target);
      return true;
    } catch {
      return false;
    }
  }
  async plan(id: string, owner: number, record: Uint8Array, slot: number, memory: number | null): Promise<Rc10rWritePlan> {
    return this.run(id, owner, async (lease) => {
      cancelled(lease.abort.signal);
      if (!lease.original || lease.output || lease.backup) return fail("Inspect a new connection before making a transfer plan.");
      const info = readRc10rRecord(record);
      if (memory !== null && (!Number.isInteger(memory) || memory < 1 || memory > 99)) throw new HostError("invalid", "Choose phrase memory 1–99.");
      const output = new Map<string, Uint8Array>();
      output.set("RC10R.RC0", patchRc10rBank(lease.original.get("RC10R.RC0")!, slot, record));
      if (memory !== null) {
        const xml = readRc10rMemoryPair(lease.original.get("MEMORY1.RC0")!, lease.original.get("MEMORY2.RC0")!);
        const [one, two] = patchRc10rMemory(xml, memory, slot, info.kit, info.bpm);
        output.set("MEMORY1.RC0", one);
        output.set("MEMORY2.RC0", two);
      }
      await this.backup(lease);
      for (const [name, bytes] of lease.original) {
        const saved = lease.journal!.files.find((file) => file.path === `ROLAND/DATA/${name}`);
        if (!saved || saved.sha256 !== digest(bytes)) return fail("Pedal data changed during backup. No transfer was started. Close and inspect again.");
      }
      await this.unchanged(lease);
      lease.output = output;
      lease.journal!.writes = [...output.keys()];
      await this.saveJournal(lease, "planned");
      return {
        slot,
        memory,
        name: info.name,
        previous: readRc10rBank(lease.original.get("RC10R.RC0")!).find((p) => p.slot === slot)?.name ?? null,
        backupPath: lease.backup!,
      };
    });
  }
  private async unchanged(lease: Lease): Promise<void> {
    for (const [name, bytes] of lease.original!)
      if (digest(await this.read(lease, name)) !== digest(bytes))
        return fail("Pedal data changed since inspection. No transfer was started. Close and inspect again.");
  }
  private async writeFile(lease: Lease, name: string, bytes: Uint8Array): Promise<void> {
    if (!WRITABLE.has(name)) return fail("This file cannot be written by rhythm transfer.");
    await this.options.checkpoint?.("before-write", name);
    const handle = await open(await this.safePath(lease, name), constants.O_RDWR | constants.O_NOFOLLOW);
    try {
      if ((await handle.stat()).dev !== lease.device!.dev) return fail("The pedal volume changed.");
      await handle.writeFile(bytes);
      await handle.truncate(bytes.length);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.options.checkpoint?.("after-write", name);
    if (digest(await this.read(lease, name)) !== digest(bytes)) return fail(`Readback did not match ${name}. Restore from the backup before using the pedal.`);
  }
  async write(id: string, owner: number): Promise<void> {
    return this.run(id, owner, async (lease) => {
      cancelled(lease.abort.signal);
      if (!lease.output || lease.journal?.state !== "planned") return fail("Make and review a backed-up plan before sending.");
      await this.unchanged(lease);
      try {
        await this.saveJournal(lease, "writing");
        for (const name of ["MEMORY1.RC0", "MEMORY2.RC0", "RC10R.RC0"]) {
          const bytes = lease.output.get(name);
          if (!bytes) continue;
          cancelled(lease.abort.signal);
          await this.writeFile(lease, name, bytes);
        }
        cancelled(lease.abort.signal);
        for (const [name, original] of lease.original!) {
          if (digest(await this.read(lease, name)) !== digest(lease.output.get(name) ?? original))
            return fail(`Final readback did not match ${name}. Restore from the backup before using the pedal.`);
        }
        await syncPath(dirname(await this.safePath(lease, "RC10R.RC0")));
        await this.saveJournal(lease, "written");
      } catch (error) {
        await this.saveJournal(lease, "partial").catch(() => {});
        throw new HostError("io", `Transfer may be incomplete. Backup: ${lease.backup}. ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
  private async journal(id: string): Promise<{ folder: string; value: Journal }> {
    if (!UUID.test(id)) throw new HostError("invalid", "Unknown recovery backup.");
    const folder = join(await realpath(this.options.backupRoot), id);
    if ((await lstat(folder)).isSymbolicLink() || (await realpath(folder)) !== folder) return fail("The backup folder changed.");
    const file = join(folder, "journal.json"),
      stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) return fail("Unsupported recovery journal.");
    const value: Journal = JSON.parse(await readFile(file, "utf8"));
    if (
      value.version !== 1 ||
      value.id !== id ||
      typeof value.volume !== "string" ||
      typeof value.date !== "string" ||
      !Number.isFinite(Date.parse(value.date)) ||
      typeof value.state !== "string" ||
      !Array.isArray(value.files) ||
      value.files.length > 5000 ||
      value.files.some(
        (file) =>
          !file ||
          typeof file.path !== "string" ||
          !Number.isSafeInteger(file.bytes) ||
          file.bytes < 0 ||
          file.bytes > 16 * 1024 ** 3 ||
          typeof file.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(file.sha256),
      ) ||
      !Array.isArray(value.writes) ||
      new Set(value.writes).size !== value.writes.length ||
      value.writes.some((name) => !WRITABLE.has(name))
    )
      return fail("Unsupported recovery journal.");
    return { folder, value };
  }
  private async recoveries(volume: string): Promise<Rc10rStorageView["recoveries"]> {
    await mkdir(this.options.backupRoot, { recursive: true });
    const result: Rc10rStorageView["recoveries"] = [];
    for (const entry of await readdir(this.options.backupRoot)) {
      if (!UUID.test(entry)) continue;
      try {
        const { value } = await this.journal(entry);
        if (value.volume === volume && ["writing", "partial", "written", "ejected"].includes(value.state))
          result.push({ id: entry, date: value.date, state: value.state });
      } catch {
        /* An incomplete backup is never offered as a recovery image. */
      }
    }
    return result.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  }
  async recover(id: string, owner: number, backupId: string): Promise<void> {
    return this.run(id, owner, async (lease) => {
      await this.root(lease);
      const { folder, value } = await this.journal(backupId);
      if (value.volume !== lease.volume!.identity || !value.writes.length || !["writing", "partial", "written", "ejected"].includes(value.state))
        return fail("This backup does not belong to this pedal or has no interrupted writes.");
      const restored = new Map<string, Uint8Array>();
      for (const name of value.writes) {
        const path = `ROLAND/DATA/${name}`,
          meta = value.files.find((file) => file.path === path);
        if (!meta) return fail("The backup is missing a required file.");
        let target = folder;
        for (const part of ["ROLAND", "DATA", name]) {
          target = join(target, part);
          if ((await lstat(target)).isSymbolicLink()) return fail("The backup contains a link.");
        }
        const stat = await lstat(target);
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return fail("Unsupported recovery file size.");
        const bytes = new Uint8Array(await readFile(target));
        if (bytes.length !== meta.bytes || digest(bytes) !== meta.sha256) return fail("Backup verification failed. No recovery was started.");
        restored.set(name, bytes);
      }
      if (restored.has("RC10R.RC0")) readRc10rBank(restored.get("RC10R.RC0")!);
      if (restored.has("MEMORY1.RC0") || restored.has("MEMORY2.RC0")) {
        if (!restored.has("MEMORY1.RC0") || !restored.has("MEMORY2.RC0")) return fail("Recovery requires both memory copies.");
        readRc10rMemoryPair(restored.get("MEMORY1.RC0")!, restored.get("MEMORY2.RC0")!);
      }
      const before = join(folder, `before-recovery-${randomUUID()}`);
      await mkdir(before);
      for (const name of restored.keys()) {
        const bytes = await this.read(lease, name);
        const file = await open(join(before, name), "wx");
        try {
          await file.writeFile(bytes);
          await file.sync();
        } finally {
          await file.close();
        }
      }
      await syncPath(before);
      lease.journal = value;
      lease.backup = folder;
      lease.abort = new AbortController();
      await this.saveJournal(lease, "writing");
      try {
        // Match sending's order: both redundant memory copies, then the shared bank.
        for (const name of ["MEMORY1.RC0", "MEMORY2.RC0", "RC10R.RC0"]) {
          const bytes = restored.get(name);
          if (!bytes) continue;
          cancelled(lease.abort.signal);
          await this.writeFile(lease, name, bytes);
        }
        for (const [name, bytes] of restored) if (digest(await this.read(lease, name)) !== digest(bytes)) return fail("Recovery readback did not match.");
        await syncPath(dirname(await this.safePath(lease, "RC10R.RC0")));
        lease.original = await this.snapshot(lease);
        await this.saveJournal(lease, "recovered");
      } catch (error) {
        await this.saveJournal(lease, "partial");
        throw error;
      }
      lease.output = undefined;
    });
  }
  async eject(id: string, owner: number): Promise<void> {
    return this.run(id, owner, async (lease) => {
      if (!lease.volume) {
        const volumes = await this.options.discover();
        if (volumes.length > 1) return fail("More than one volume is mounted. Eject the RC-10R drive in Finder before retrying.");
        lease.volume = volumes[0];
      }
      if (lease.volume && !lease.ejected) {
        await this.options.eject(lease.volume);
        lease.ejected = true;
        await this.saveJournal(lease, lease.journal?.state === "written" ? "ejected" : (lease.journal?.state ?? "closed"));
      }
    });
  }
  release(id: string, owner: number): Promise<void> {
    const lease = this.lease(id, owner);
    if (lease.pending || (lease.volume && !lease.ejected)) return fail("Eject the pedal before releasing its connection.");
    return this.finishRelease(lease);
  }
  private async finishRelease(lease: Lease): Promise<void> {
    lease.pending = true;
    try {
      if (lease.journal?.state === "ejected") await this.saveJournal(lease, "finished");
      this.active = undefined;
    } finally {
      lease.pending = false;
    }
  }
  /** Valid journals, newest first. Folders without a valid journal are never listed or removed. */
  private async journals(): Promise<{ id: string; folder: string; value: Journal }[]> {
    const result: { id: string; folder: string; value: Journal }[] = [];
    for (const entry of await readdir(this.options.backupRoot).catch(() => [] as string[])) {
      if (!UUID.test(entry)) continue;
      const found = await this.journal(entry).catch(() => undefined);
      if (found) result.push({ id: entry, ...found });
    }
    return result.sort((a, b) => b.value.date.localeCompare(a.value.date));
  }
  /** Loops in the newest complete backup (spec 178). Reads only the app's own backup folder. */
  async loops(): Promise<Rc10rLoopLibrary> {
    const newest = (await this.journals()).find(({ value }) => COMPLETE.has(value.state) && value.files.some((f) => LOOP_PATH.test(f.path)));
    if (!newest) return { loops: [] };
    const loops = newest.value.files.flatMap((file) => {
      const match = LOOP_PATH.exec(file.path);
      if (!match || file.bytes <= 44) return [];
      return [{ memory: Number(match[1]), track: Number(match[2]) as 1 | 2, path: file.path, bytes: file.bytes }];
    });
    loops.sort((a, b) => a.memory - b.memory || a.track - b.track);
    return { backup: { id: newest.id, date: newest.value.date }, loops };
  }
  /** One loop's bytes, checked against the backup's journal. */
  async loopAudio(backupId: string, path: string): Promise<Uint8Array> {
    if (typeof path !== "string" || !LOOP_PATH.test(path) || path.split("/").includes("..")) throw new HostError("invalid", "Unknown loop.");
    const { folder, value } = await this.journal(backupId);
    const meta = value.files.find((file) => file.path === path);
    if (!meta || meta.bytes > 512 * 1024 * 1024) throw new HostError("invalid", "Unknown loop.");
    let target = folder;
    for (const part of path.split("/")) {
      target = join(target, part);
      if ((await lstat(target)).isSymbolicLink()) return fail("The backup contains a link.");
    }
    const bytes = new Uint8Array(await readFile(target));
    if (bytes.length !== meta.bytes || digest(bytes) !== meta.sha256) return fail("This loop no longer matches its backup.");
    return bytes;
  }
  private async diskBytes(folders: string[]): Promise<number> {
    const seen = new Set<string>();
    let total = 0;
    const walk = async (folder: string, depth: number): Promise<void> => {
      if (depth > 8) return;
      for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
        const path = join(folder, entry.name),
          info = await lstat(path);
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) await walk(path, depth + 1);
        else if (info.isFile() && !seen.has(`${info.dev}:${info.ino}`)) {
          seen.add(`${info.dev}:${info.ino}`);
          total += info.size;
        }
      }
    };
    for (const folder of folders) await walk(folder, 0);
    return total;
  }
  private removable(list: Awaited<ReturnType<Rc10rStore["journals"]>>) {
    return list.filter(({ value }, index) => index >= KEEP_NEWEST && !KEEP.has(value.state));
  }
  async backups(): Promise<Rc10rBackupSummary> {
    const list = await this.journals();
    return { count: list.length, bytes: await this.diskBytes(list.map(({ folder }) => folder)), removable: this.removable(list).length };
  }
  /** Removes all but the five newest backups, keeping any from an interrupted write. Never runs during a pedal session. */
  async pruneBackups(): Promise<Rc10rBackupSummary> {
    if (this.active) throw new HostError("invalid", "Close the RC-10R connection before removing backups.");
    for (const { folder } of this.removable(await this.journals())) await rm(folder, { recursive: true, force: true });
    return this.backups();
  }
  /** A renderer crash cannot send MIDI cleanup. Eject storage and leave recovery information for the next session. */
  async abandon(owner: number): Promise<void> {
    const lease = this.active;
    if (!lease || lease.owner !== owner) return;
    lease.abort.abort();
    while (lease.pending) await new Promise((done) => setTimeout(done, 25));
    if (lease.volume && !lease.ejected) await this.options.eject(lease.volume).catch(() => {});
    if (this.active === lease) this.active = undefined;
  }
}
