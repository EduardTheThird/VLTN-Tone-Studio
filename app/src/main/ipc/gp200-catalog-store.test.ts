// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_XML_BYTES } from "@shared/host/gp200-catalog";
import { Gp200CatalogStore, algorithmXmlCandidates, findAlgorithmXml, readAlgorithmXml } from "./gp200-catalog-store";

const XML = '<?xml version="1.0" encoding="utf-8" ?>\r\n<GP-200>\r\n  <Catalog Name = "AMP"></Catalog>\r\n</GP-200>\r\n';
/** A catalog of the gp200/lib shape (synthetic, not Valeton data). */
const CATALOG = {
  meta: { device: "GP-200", source: "algorithm.xml", counts: { algEntries: 1, uniqueCodes: 1, perModule: { AMP: 1 }, controls: 1 } },
  modules: [{ module: "AMP", algs: [{ name: "Test Amp", module: "AMP", code: 117440513, codeHex: "0x07000001", index: 0, knobs: [{ kind: "Knob", name: "Gain", idx: 0, id: 0, type: 1, default: 30, min: 0, max: 100, step: 1 }] }] }],
};
const XML_PATH = ["Resource", "GP-200", "File", "algorithm.xml"];

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gp200-cat-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

async function place(...parts: string[]): Promise<string> {
  const path = join(root, ...parts);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, XML);
  return path;
}

describe("finding the GP-200 editor's algorithm.xml", () => {
  it("Linux: the editor installed in $WINEPREFIX", async () => {
    const path = await place("prefix", "drive_c", "Program Files (x86)", "Valeton", "GP-200", ...XML_PATH);
    const candidates = await algorithmXmlCandidates({ platform: "linux", env: { WINEPREFIX: join(root, "prefix") }, home: join(root, "home") });
    expect(await findAlgorithmXml(candidates)).toBe(path);
  });

  it("Linux: a Bottles prefix, ~/.wine and an unpacked install in the home folder", async () => {
    const where = { platform: "linux" as const, env: {}, home: join(root, "home") };
    expect(await findAlgorithmXml(await algorithmXmlCandidates(where))).toBeNull();
    const bottle = await place("home", ".local", "share", "bottles", "bottles", "Music", "drive_c", "Program Files", "GP-200", ...XML_PATH);
    expect(await findAlgorithmXml(await algorithmXmlCandidates(where))).toBe(bottle);
    await rm(bottle);
    const wine = await place("home", ".wine", "drive_c", "Program Files", "Hotone", "GP-200", ...XML_PATH);
    expect(await findAlgorithmXml(await algorithmXmlCandidates(where))).toBe(wine);
    await rm(wine);
    const unpacked = await place("home", "GP-200", ...XML_PATH);
    expect(await findAlgorithmXml(await algorithmXmlCandidates(where))).toBe(unpacked);
  });

  it("Windows: Program Files, Program Files (x86) and per-user installs, without duplicates", async () => {
    const env = { ProgramFiles: "C:\\Program Files", ProgramW6432: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" };
    const candidates = await algorithmXmlCandidates({ platform: "win32", env, home: "C:\\Users\\me" });
    expect(candidates).toContain("C:\\Program Files\\Valeton\\GP-200\\Resource\\GP-200\\File\\algorithm.xml");
    expect(candidates).toContain("C:\\Program Files (x86)\\GP-200\\Resource\\GP-200\\File\\algorithm.xml");
    expect(candidates).toContain("C:\\Users\\me\\AppData\\Local\\Programs\\Valeton\\GP-200\\Resource\\GP-200\\File\\algorithm.xml");
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("macOS: the editor's data folder first, then the app bundle", async () => {
    const candidates = await algorithmXmlCandidates({ platform: "darwin", env: {}, home: "/Users/me" });
    expect(candidates[0]).toBe("/Library/Application Support/Valeton/GP-200/File/algorithm.xml");
    expect(candidates).toContain("/Users/me/Library/Application Support/Valeton/GP-200/File/algorithm.xml");
    expect(candidates).toContain("/Applications/GP-200.app/Contents/Resources/algorithm.xml");
  });

  it("skips a folder named algorithm.xml", async () => {
    await mkdir(join(root, "a", "algorithm.xml"), { recursive: true });
    const file = await place("b", "algorithm.xml");
    expect(await findAlgorithmXml([join(root, "a", "algorithm.xml"), join(root, "missing.xml"), file])).toBe(file);
  });
});

describe("reading algorithm.xml", () => {
  it("reads UTF-8 and UTF-16 (with or without BOM)", async () => {
    const utf8 = await place("utf8.xml");
    expect((await readAlgorithmXml(utf8)).text).toBe(XML);
    const le = join(root, "le.xml");
    await writeFile(le, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(XML, "utf16le")]));
    expect(await readAlgorithmXml(le)).toEqual({ path: le, text: XML });
    const be = join(root, "be.xml");
    await writeFile(be, Buffer.from(XML, "utf16le").swap16());
    expect((await readAlgorithmXml(be)).text).toBe(XML);
  });

  it("refuses files that are too big or no XML", async () => {
    const big = join(root, "big.xml");
    await writeFile(big, "<");
    await truncate(big, MAX_XML_BYTES + 1);
    await expect(readAlgorithmXml(big)).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/too big/) });
    const wav = join(root, "x.xml");
    await writeFile(wav, "RIFF....WAVE");
    await expect(readAlgorithmXml(wav)).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/isn't an XML file/) });
  });
});

describe("Gp200CatalogStore", () => {
  it("keeps, loads and removes the catalog in gp200/catalog.json", async () => {
    const store = new Gp200CatalogStore(root);
    expect(await store.load()).toBeNull();
    const now = new Date("2026-10-11T12:00:00Z");
    const kept = await store.save(CATALOG, "/opt/GP-200/Resource/GP-200/File/algorithm.xml", now);
    expect(kept).toEqual({ catalog: CATALOG, source: "/opt/GP-200/Resource/GP-200/File/algorithm.xml", savedAt: "2026-10-11T12:00:00.000Z" });
    expect(await readdir(join(root, "gp200"))).toEqual(["catalog.json"]);
    expect(await new Gp200CatalogStore(root).load()).toEqual(kept);
    await store.remove();
    expect(await store.load()).toBeNull();
    await store.remove();
  });

  it("refuses to keep something that is no catalog and reports a damaged file", async () => {
    const store = new Gp200CatalogStore(root);
    await expect(store.save({ modules: [] }, "x")).rejects.toMatchObject({ code: "invalid" });
    await expect(store.save({ ...CATALOG, modules: [{ module: "AMP", algs: [{ name: "x", code: "7", knobs: [] }] }] }, "x")).rejects.toMatchObject({ code: "invalid" });
    await mkdir(join(root, "gp200"));
    await writeFile(join(root, "gp200", "catalog.json"), "{ not json");
    await expect(store.load()).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/damaged/) });
    await writeFile(join(root, "gp200", "catalog.json"), JSON.stringify({ catalog: CATALOG }));
    await expect(store.load()).rejects.toMatchObject({ code: "invalid" });
  });
});
