import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCatalogFromXml } from "@/gp200/lib/catalog.mjs";
import { host } from "@/host";
import { GP200_BLOCK_TYPES, gp200ModelByFxid, gp200ModelsForBlock } from "./catalog-adapter";
import { NOT_FOUND, useGp200Catalog } from "./catalog-store";

// Synthetic file in the editor's format (written for this test; not Valeton data): an fxid in two blocks, a tempo-sync
// pair, a TrueID menu, a menu with a gap in its TrueIDs, a text default, a MinISOff knob and an amp with a CAB code.
const XML = [
  '<?xml version="1.0" encoding="utf-8" ?>',
  "<GP-200>",
  '  <Catalog Name = "PRE">',
  '    <Alg Name="Test Boost" Module="PRE" Code="26" Index="1">',
  '      <Knob  Name = "Gain"  idx = "0" ID = "0" default = "20" Dmin = "0" Dmax = "100" Type = "1" step = "1" />',
  "    </Alg>",
  '    <Alg Name="Test Trem" Module="PRE" Code="16777231" Index="0">',
  '      <Knob  Name = "Rate"  idx = "0" ID = "1" Suffix = "Hz" default = "0.50" Dmin = "0.10" Dmax = "10.00" Type = "1" step = "0.1" valueType = "1" bind="1" />',
  '      <Switch Name = "Sync" default = "0" idx = "1" ID = "6" Type = "3" SubType="Power" bind="0">',
  '        <Menu Name = "OFF" ID= "0" />',
  '        <Menu Name = "ON" ID= "1" />',
  "      </Switch>",
  "    </Alg>",
  "  </Catalog>",
  '  <Catalog Name = "DST">',
  '    <Alg Name="Test Boost" Module="DST" Code="26" Index="0">',
  '      <Knob  Name = "Gain"  idx = "0" ID = "0" default = "35" Dmin = "0" Dmax = "100" Type = "1" step = "1" />',
  "    </Alg>",
  '    <Alg Name="Mode OD" Module="DST" Code="50331681" Index="1">',
  '      <Combox Name = "Mode" default = "0" idx = "1" ID = "3" Type = "2">',
  '        <Menu Name = "Clean" ID= "0" TrueID = "1"/>',
  '        <Menu Name = "OD" ID= "1" TrueID = "2" />',
  "      </Combox>",
  '      <Combox Name = "Voice" default = "1" idx = "0" ID = "4" Type = "2">',
  '        <Menu Name = "Dark" ID= "0" TrueID = "1"/>',
  '        <Menu Name = "Bright" ID= "1" TrueID = "3" />',
  "      </Combox>",
  "    </Alg>",
  "  </Catalog>",
  '  <Catalog Name = "AMP">',
  '    <Alg Name="Test Amp" Module="AMP" Code="117440513" Index="0" CABCode="167772162">',
  '      <Knob  Name = "Detune"  idx = "0" ID = "0" Suffix = "cents" default = "-25 Cents" Dmin = "-50" Dmax = "50" Type = "1" step = "1.0" />',
  '      <Knob  Name = "Low Cut"  idx = "1" ID = "5" Suffix = "Hz" MinISOff = "1" default = "19" Dmin = "19" Dmax = "2000" Type = "1" step = "1.0" />',
  "    </Alg>",
  "  </Catalog>",
  "</GP-200>",
].join("\r\n");

const SOURCE = "/home/me/.wine/drive_c/Program Files/Valeton/GP-200/Resource/GP-200/File/algorithm.xml";
const initial = useGp200Catalog.getState();
// The browser host keeps the catalog in localStorage (Node's own global shadows jsdom's here).
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, String(v)),
  removeItem: (k: string) => void stored.delete(k),
});

beforeEach(() => {
  stored.clear();
  useGp200Catalog.setState(initial, true);
});
afterEach(() => vi.restoreAllMocks());

describe("GP-200 catalog adapters", () => {
  const catalog = buildCatalogFromXml(XML);

  it("models: name, title, block, category, cab match; list order per block", () => {
    const amp = gp200ModelByFxid(catalog, 117440513, "AMP");
    expect(amp).toMatchObject({ fxid: 117440513, block: "AMP", name: "Test Amp", title: "Test Amp", type: GP200_BLOCK_TYPES.AMP, cabFxid: 167772162 });
    expect(gp200ModelsForBlock(catalog, "PRE").map((m) => m.name)).toEqual(["Test Trem", "Test Boost"]);
    expect(gp200ModelsForBlock(catalog, 2).map((m) => m.name)).toEqual(["Test Boost", "Mode OD"]);
    expect(gp200ModelByFxid(catalog, 26, 0)?.params[0].default).toBe(20);
    expect(gp200ModelByFxid(catalog, 26, "DST")?.params[0].default).toBe(35);
    expect(gp200ModelByFxid(catalog, 26, "AMP")).toBeUndefined();
    expect(gp200ModelByFxid(catalog, 117440513, 3)).toBe(amp);
  });

  it("params: index = XML ID, ranges, units, steps, OFF at minimum", () => {
    const [detune, lowCut] = gp200ModelByFxid(catalog, 117440513, "AMP")!.params;
    expect(detune).toEqual({ name: "Detune", index: 0, kind: "Knob", min: -50, max: 50, step: 1, default: -25, unit: "cents" });
    expect(lowCut).toMatchObject({ index: 5, min: 19, max: 2000, unit: "Hz", offAtMin: true });
  });

  it("params: tempo-sync switch, menus with TrueIDs (labels[value - min], values when there are gaps)", () => {
    const [rate, sync] = gp200ModelByFxid(catalog, 16777231, "PRE")!.params;
    expect(rate).toMatchObject({ index: 1, min: 0.1, max: 10, step: 0.1, unit: "Hz" });
    expect(rate.syncs).toBeUndefined();
    expect(sync).toEqual({ name: "Sync", index: 6, kind: "Switch", min: 0, max: 1, step: 1, default: 0, labels: ["OFF", "ON"], toggle: true, syncs: 1 });
    const [voice, mode] = gp200ModelByFxid(catalog, 50331681, "DST")!.params;
    expect(mode).toEqual({ name: "Mode", index: 3, kind: "Combox", min: 1, max: 2, step: 1, default: 1, labels: ["Clean", "OD"] });
    expect(voice).toEqual({ name: "Voice", index: 4, kind: "Combox", min: 1, max: 3, step: 1, default: 3, labels: ["Dark", "2", "Bright"], values: [1, 3] });
  });
});

describe("useGp200Catalog", () => {
  it("starts with no catalog; import builds, keeps and reports it; load() reads it back", async () => {
    await useGp200Catalog.getState().load();
    expect(useGp200Catalog.getState()).toMatchObject({ status: "none", catalog: null, loaded: true, error: null });

    await useGp200Catalog.getState().importXml(XML, SOURCE);
    const s = useGp200Catalog.getState();
    expect(s.status).toBe("ready");
    expect(s.source).toBe(SOURCE);
    expect(s.catalog?.meta.source).toBe("algorithm.xml");
    expect(s.counts).toEqual({ uniqueModels: 4, controls: 8, perBlock: { PRE: 2, DST: 2, AMP: 1 } });
    expect(typeof s.savedAt).toBe("string");

    useGp200Catalog.setState(initial, true);
    await useGp200Catalog.getState().load();
    const again = useGp200Catalog.getState();
    expect(again.status).toBe("ready");
    expect(again.counts).toEqual(s.counts);
    expect(again.source).toBe(SOURCE);
    expect(gp200ModelByFxid(again.catalog!, 117440513, "AMP")?.name).toBe("Test Amp");
  });

  it("a file that is no catalog fails plainly and keeps the previous catalog", async () => {
    await expect(useGp200Catalog.getState().importXml("<Other><Thing/></Other>", "other.xml")).rejects.toThrow();
    expect(useGp200Catalog.getState()).toMatchObject({ status: "error", catalog: null, error: expect.stringMatching(/no GP-200 effect catalogs/) });
    await useGp200Catalog.getState().importXml(XML, SOURCE);
    await expect(useGp200Catalog.getState().importXml("<GP-200>", "broken.xml")).rejects.toThrow();
    expect(useGp200Catalog.getState()).toMatchObject({ status: "ready", source: SOURCE });
    expect(useGp200Catalog.getState().error).not.toBeNull();
  });

  it("find automatically: imports the editor's file, or says nothing was found", async () => {
    const find = vi.spyOn(host.gp200Catalog, "findXml").mockResolvedValueOnce(null);
    expect(await useGp200Catalog.getState().findAutomatically()).toBe(false);
    expect(useGp200Catalog.getState()).toMatchObject({ status: "none", error: NOT_FOUND });
    find.mockResolvedValueOnce({ path: SOURCE, text: XML });
    expect(await useGp200Catalog.getState().findAutomatically()).toBe(true);
    expect(useGp200Catalog.getState()).toMatchObject({ status: "ready", source: SOURCE, error: null });
  });

  it("choose file: a cancelled picker changes nothing", async () => {
    const choose = vi.spyOn(host.gp200Catalog, "chooseXml").mockResolvedValueOnce(null);
    expect(await useGp200Catalog.getState().chooseFile()).toBe(false);
    expect(useGp200Catalog.getState()).toMatchObject({ status: "none", error: null });
    choose.mockResolvedValueOnce({ path: "algorithm.xml", text: XML });
    expect(await useGp200Catalog.getState().chooseFile()).toBe(true);
    expect(useGp200Catalog.getState()).toMatchObject({ status: "ready", source: "algorithm.xml" });
  });

  it("remove forgets the kept catalog", async () => {
    await useGp200Catalog.getState().importXml(XML, SOURCE);
    await useGp200Catalog.getState().remove();
    expect(useGp200Catalog.getState()).toMatchObject({ status: "none", catalog: null, counts: null, source: null });
    useGp200Catalog.setState(initial, true);
    await useGp200Catalog.getState().load();
    expect(useGp200Catalog.getState().status).toBe("none");
  });

  it("a damaged kept copy shows as an error", async () => {
    localStorage.setItem("gp200.catalog", JSON.stringify({ catalog: { modules: [] }, source: "x", savedAt: "y" }));
    await useGp200Catalog.getState().load();
    expect(useGp200Catalog.getState()).toMatchObject({ status: "error", loaded: true, error: expect.stringMatching(/damaged/) });
  });
});
