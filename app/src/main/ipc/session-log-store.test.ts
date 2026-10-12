// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionLogStore } from "./session-log-store";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "session-log-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const line = (n: number) => `line ${String(n).padStart(4, "0")}`; // 9 bytes + newline

describe("SessionLogStore", () => {
  it("creates its folder and appends in call order", async () => {
    const store = new SessionLogStore(join(root, "logs"));
    await Promise.all([store.append([line(1), line(2)]), store.append([line(3)])]);
    expect(await readFile(join(root, "logs", "session.log"), "utf8")).toBe(`${line(1)}\n${line(2)}\n${line(3)}\n`);
  });

  it("rotates past maxBytes and drops files past keep", async () => {
    const store = new SessionLogStore(root, 25, 2); // two lines per file
    for (let n = 1; n <= 9; n++) await store.append([line(n)]);
    expect((await readdir(root)).sort()).toEqual(["session.1.log", "session.2.log", "session.log"]);
    expect(await readFile(join(root, "session.log"), "utf8")).toBe(`${line(9)}\n`);
    expect(await readFile(join(root, "session.2.log"), "utf8")).toBe(`${line(5)}\n${line(6)}\n`);
  });

  it("tail reads back across rotated files, oldest first", async () => {
    const store = new SessionLogStore(root, 25, 2);
    for (let n = 1; n <= 9; n++) await store.append([line(n)]);
    expect(await store.tail(4)).toEqual([line(6), line(7), line(8), line(9)]);
    expect(await store.tail(100)).toEqual([5, 6, 7, 8, 9].map(line));
  });

  it("picks up the size of an existing log after a restart", async () => {
    await new SessionLogStore(root, 25, 2).append([line(1), line(2)]);
    await new SessionLogStore(root, 25, 2).append([line(3)]);
    expect(await readFile(join(root, "session.1.log"), "utf8")).toBe(`${line(1)}\n${line(2)}\n`);
    expect(await readFile(join(root, "session.log"), "utf8")).toBe(`${line(3)}\n`);
  });

  it("saves every kept file as one text, oldest first, after pending writes", async () => {
    const store = new SessionLogStore(root, 25, 2);
    for (let n = 1; n <= 5; n++) void store.append([line(n)]);
    const out = join(root, "saved.txt");
    await store.saveTo(out);
    expect(await readFile(out, "utf8")).toBe([1, 2, 3, 4, 5].map((n) => `${line(n)}\n`).join(""));
  });

  it("tail of an empty log is empty", async () => {
    expect(await new SessionLogStore(root).tail(10)).toEqual([]);
  });
});
