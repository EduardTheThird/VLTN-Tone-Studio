// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Rc10rStore, type Rc10rStoreOptions } from "./rc10r-store";
import { readRc10rBank } from "@shared/rc10r-bank";
import { testRc10rBank, testRc10rMemory, testRc10rRecord } from "@shared/rc10r-test-data";

vi.setConfig({ testTimeout: 20000 });
let base: string, volume: string, backups: string;
const memory = testRc10rMemory();
const digest = (bytes: Uint8Array | undefined) => bytes && createHash("sha256").update(bytes).digest("hex");
const hashes = (files: Map<string, Uint8Array>) => new Map([...files].map(([name, bytes]) => [name, digest(bytes)]));
let eject: Mock<Rc10rStoreOptions["eject"]>;
const data = (name: string) => join(volume, "ROLAND", "DATA", name);
const original = async () =>
  new Map(
    await Promise.all(
      ["RC10R.RC0", "MEMORY1.RC0", "MEMORY2.RC0", "SYSTEM1.RC0", "SYSTEM2.RC0"].map(async (name) => [name, await readFile(data(name))] as const),
    ),
  );
const storeFor = (checkpoint?: Rc10rStoreOptions["checkpoint"]) =>
  new Rc10rStore({ backupRoot: backups, discover: async () => [{ root: volume, identity: "test-volume" }], eject, checkpoint });
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "vltn-rc10r-")));
  volume = join(base, "pedal");
  backups = join(base, "backups");
  await mkdir(join(volume, "ROLAND", "DATA"), { recursive: true });
  await mkdir(join(volume, "ROLAND", "WAVE", "empty"), { recursive: true });
  await writeFile(data("RC10R.RC0"), testRc10rBank(2));
  await writeFile(data("MEMORY1.RC0"), memory);
  await writeFile(data("MEMORY2.RC0"), memory);
  await writeFile(data("SYSTEM1.RC0"), "system-one");
  await writeFile(data("SYSTEM2.RC0"), "system-two");
  await writeFile(join(volume, "ROLAND", "WAVE", "loop.WAV"), "keep the recorded loop");
  eject = vi.fn(async (_volume) => {});
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("RC-10R copied-filesystem transactions", () => {
  it("makes a full checked backup and replaces one record with optional kit/tempo, retaining every other file", async () => {
    const before = await original(),
      store = storeFor(),
      id = store.reserve(1);
    const view = await store.inspect(id, 1);
    expect(view.patterns.map((p) => p.name)).toEqual(["User1", "User2"]);
    const plan = await store.plan(id, 1, testRc10rRecord("New"), 2, 99);
    expect(hashes(await original())).toEqual(hashes(before));
    expect(await readFile(join(plan.backupPath, "ROLAND/WAVE/loop.WAV"), "utf8")).toBe("keep the recorded loop");
    expect(await readdir(join(plan.backupPath, "ROLAND/WAVE/empty"))).toEqual([]);
    const journal = JSON.parse(await readFile(join(plan.backupPath, "journal.json"), "utf8"));
    expect(journal.files).toHaveLength(6);
    expect(journal.state).toBe("planned");
    await store.write(id, 1);
    expect(readRc10rBank(await readFile(data("RC10R.RC0"))).map((p) => p.name)).toEqual(["User1", "New"]);
    const after = await original();
    for (const name of ["SYSTEM1.RC0", "SYSTEM2.RC0"]) expect(after.get(name)).toEqual(before.get(name));
    expect(await readFile(join(volume, "ROLAND/WAVE/loop.WAV"), "utf8")).toBe("keep the recorded loop");
    expect(() => store.release(id, 1)).toThrow(/Eject/);
    await store.eject(id, 1);
    await store.release(id, 1);
    expect(store.busy).toBe(false);
  });
  it("does not write memory files when phrase-memory settings were not selected", async () => {
    const before = await original(),
      touched: string[] = [],
      store = storeFor(async (phase, name) => {
        if (phase === "before-write") touched.push(name);
      });
    const id = store.reserve(1);
    await store.inspect(id, 1);
    await store.plan(id, 1, testRc10rRecord("Added"), 3, null);
    await store.write(id, 1);
    expect(touched).toEqual(["RC10R.RC0"]);
    expect(digest(await readFile(data("MEMORY1.RC0")))).toBe(digest(before.get("MEMORY1.RC0")));
  });
  it("refuses overlapping leases, foreign owners, unreviewed writes and stale pedal content", async () => {
    const store = storeFor(),
      id = store.reserve(1);
    expect(() => store.reserve(2)).toThrow();
    await expect(store.inspect(id, 2)).rejects.toThrow(/expired/);
    await expect(store.write(id, 1)).rejects.toThrow(/review/);
    await store.inspect(id, 1);
    await store.plan(id, 1, testRc10rRecord("New"), 1, null);
    await writeFile(data("SYSTEM1.RC0"), "changed outside this app");
    await expect(store.write(id, 1)).rejects.toThrow(/changed since inspection/);
    expect(readRc10rBank(await readFile(data("RC10R.RC0")))[0].name).toBe("User1");
  });
  it("cancels during full backup before writing any pedal bytes", async () => {
    let store: Rc10rStore, id: string;
    store = storeFor(async (phase) => {
      if (phase === "backup-file") store.cancel(id, 1);
    });
    id = store.reserve(1);
    const before = await original();
    await store.inspect(id, 1);
    await expect(store.plan(id, 1, testRc10rRecord("New"), 1, 1)).rejects.toThrow(/cancelled/);
    expect(hashes(await original())).toEqual(hashes(before));
    await store.eject(id, 1);
    await store.release(id, 1);
  });
  it("refuses symlinked source files and never follows a link into the backup", async () => {
    const external = join(base, "outside");
    await writeFile(external, "untouched");
    await symlink(external, join(volume, "ROLAND/WAVE/link"));
    const store = storeFor(),
      id = store.reserve(1);
    await store.inspect(id, 1);
    await expect(store.plan(id, 1, testRc10rRecord("New"), 1, null)).rejects.toThrow(/link/);
    expect(await readFile(external, "utf8")).toBe("untouched");
    expect(readRc10rBank(await readFile(data("RC10R.RC0")))[0].name).toBe("User1");
  });
  it("exposes crash recovery even when a partial memory write makes the pair disagree", async () => {
    const before = await original();
    const record = testRc10rRecord("New");
    new DataView(record.buffer).setUint16(14, 121, true);
    const corruption = storeFor(async (phase, name) => {
      if (phase === "after-write" && name === "MEMORY1.RC0") {
        await writeFile(data(name), "partial");
        throw new Error("USB disappeared");
      }
    });
    const nextId = corruption.reserve(2);
    await corruption.inspect(nextId, 2);
    await corruption.plan(nextId, 2, record, 1, 99);
    await expect(corruption.write(nextId, 2)).rejects.toThrow(/may be incomplete/);
    const afterCrash = storeFor(),
      recoveryId = afterCrash.reserve(3),
      view = await afterCrash.inspect(recoveryId, 3);
    expect(view.problem).toBeTruthy();
    expect(view.recoveries.some((r) => r.id === nextId)).toBe(true);
    await expect(afterCrash.plan(recoveryId, 3, record, 1, null)).rejects.toThrow(/Inspect/);
    await afterCrash.recover(recoveryId, 3, nextId);
    expect(hashes(await original())).toEqual(hashes(before));
    const kept = await readdir(join(backups, nextId));
    expect(kept.some((name) => name.startsWith("before-recovery-"))).toBe(true);
  });
  it("detects mismatched readback and keeps the lease when eject fails", async () => {
    const store = storeFor(async (phase, name) => {
      if (phase === "after-write") await writeFile(data(name), "wrong bytes");
    });
    const id = store.reserve(1);
    await store.inspect(id, 1);
    await store.plan(id, 1, testRc10rRecord("New"), 1, null);
    await expect(store.write(id, 1)).rejects.toThrow(/Readback/);
    eject.mockRejectedValueOnce(new Error("volume busy"));
    await expect(store.eject(id, 1)).rejects.toThrow(/busy/);
    expect(() => store.release(id, 1)).toThrow(/Eject/);
    expect(store.busy).toBe(true);
  });

  it("catches a previously checked memory copy changing during the final bank write", async () => {
    const store = storeFor(async (phase, name) => {
      if (phase === "after-write" && name === "RC10R.RC0") await writeFile(data("MEMORY1.RC0"), "changed after its own readback");
    });
    const id = store.reserve(1);
    await store.inspect(id, 1);
    await store.plan(id, 1, testRc10rRecord("New"), 1, 1);
    await expect(store.write(id, 1)).rejects.toThrow(/Final readback/);
    const journal = JSON.parse(await readFile(join(backups, id, "journal.json"), "utf8"));
    expect(journal.state).toBe("partial");
  });

  it("restores after cancellation between memory writes and keeps recovered state through eject", async () => {
    let store: Rc10rStore,
      id: string,
      interrupt = true;
    const before = await original();
    store = storeFor(async (phase, name) => {
      if (interrupt && phase === "after-write" && name === "MEMORY1.RC0") store.cancel(id, 1);
    });
    id = store.reserve(1);
    await store.inspect(id, 1);
    const record = testRc10rRecord("New");
    new DataView(record.buffer).setUint16(14, 121, true);
    await store.plan(id, 1, record, 1, 99);
    await expect(store.write(id, 1)).rejects.toThrow(/cancelled/);
    interrupt = false;
    await store.recover(id, 1, id);
    expect(hashes(await original())).toEqual(hashes(before));
    await store.eject(id, 1);
    await store.release(id, 1);
    const journal = JSON.parse(await readFile(join(backups, id, "journal.json"), "utf8"));
    expect(journal.state).toBe("recovered");
    const next = storeFor(),
      nextId = next.reserve(2);
    expect((await next.inspect(nextId, 2)).recoveries).toEqual([]);
  });

  it("rejects altered backup bytes before recovery writes anything", async () => {
    const store = storeFor(async (phase) => {
      if (phase === "before-write") throw new Error("interrupted");
    });
    const id = store.reserve(1);
    await store.inspect(id, 1);
    const plan = await store.plan(id, 1, testRc10rRecord("New"), 1, null);
    await expect(store.write(id, 1)).rejects.toThrow(/incomplete/);
    const before = await original();
    await writeFile(join(plan.backupPath, "ROLAND/DATA/RC10R.RC0"), "damaged backup");
    await expect(store.recover(id, 1, id)).rejects.toThrow(/Backup verification failed/);
    expect(hashes(await original())).toEqual(hashes(before));
    const journalPath = join(plan.backupPath, "journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    await writeFile(journalPath, JSON.stringify({ ...journal, date: 123 }));
    const next = storeFor(),
      nextId = next.reserve(2);
    expect((await next.inspect(nextId, 2)).recoveries).toEqual([]);
  });
});
