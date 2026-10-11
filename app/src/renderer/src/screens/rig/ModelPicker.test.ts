import { afterAll, describe, expect, it } from "vitest";
import { useGp200Catalog } from "@/gp200/app/catalog-store";
import { buildCatalogFromXml } from "@/gp200/lib/catalog.mjs";
import { tilesFor } from "./ModelPicker";

// Synthetic catalog in the editor's format (written for this test; not Valeton data): a drive and two SnapTone slots
// (fxids 0x0F000005, 0x0F000006) in DST, a factory cab and the first User IR slot (fxid 0x0A100000) in CAB.
const alg = (name: string, module: string, code: number) =>
  `<Alg Name="${name}" Module="${module}" Code="${code}" Index="0"><Knob Name = "Level" idx = "0" ID = "0" default = "50" Dmin = "0" Dmax = "100" Type = "1" step = "1" /></Alg>`;
const XML = `<GP-200>
  <Catalog Name = "DST">${alg("Test Drive", "DST", 50331649)}${alg("Capture", "DST", 251658245)}${alg("Capture", "DST", 251658246)}</Catalog>
  <Catalog Name = "CAB">${alg("Test Cab", "CAB", 167772161)}${alg("Slot", "CAB", 168820736)}</Catalog>
</GP-200>`;

afterAll(() => useGp200Catalog.setState({ catalog: null }));

describe("model picker tiles", () => {
  it("GP-200: SnapTones by slot name, empty by the pedal's flag; nothing under plain models; User IRs by fxid", () => {
    useGp200Catalog.setState({ catalog: buildCatalogFromXml(XML) });
    const snapTones = [
      { slot: 5, name: "Mine", kind: "user" as const },
      { slot: 6, name: "Mine too", kind: "empty" as const },
    ];
    expect(tilesFor(2, "gp200", snapTones, null).map(({ title, sub, empty, capture }) => ({ title, sub, empty, capture }))).toEqual([
      { title: "Test Drive", sub: "", empty: undefined, capture: undefined },
      { title: "5 Mine", sub: "User slot", empty: false, capture: true },
      // an empty slot's name is the pedal's placeholder: the slot shows instead
      { title: "SnapTone 6", sub: "Empty user slot", empty: true, capture: true },
    ]);
    expect(tilesFor(2, "gp200", null, null)[1].title).toBe("SnapTone 5");
    const cabs = tilesFor(5, "gp200", null, [{ slot: 0, name: "Room" }]);
    expect(cabs.map((t) => [t.title, !!t.ir])).toEqual([
      ["Test Cab", false],
      ["IR 1 Room", true],
    ]);
  });

  it("GP-5: NS slots keep the name rule and the catalog's User IR titles", () => {
    const ns = tilesFor(9, "gp5", [{ slot: 50, name: "Empty", kind: "user" }], null);
    expect(ns.find((t) => t.title === "50 Empty")).toMatchObject({ sub: "Empty user slot", empty: true, capture: true });
    expect(ns[0]).toMatchObject({ title: "SnapTone 0", sub: "Factory slot" });
    const irs = tilesFor(4, "gp5", null, [{ slot: 2, name: "Bright" }]).filter((t) => t.ir);
    expect(irs).toHaveLength(20);
    expect(irs[2].title).toBe("IR 3 Bright");
  });
});
