import { afterAll, describe, expect, it } from "vitest";
import { gp200ModelByFxid } from "@/gp200/app/catalog-adapter";
import { useGp200Catalog } from "@/gp200/app/catalog-store";
import { buildCatalogFromXml } from "@/gp200/lib/catalog.mjs";
import type { BlockState } from "@/state/device-types";
import { knobsForBlock } from "./GearFor";

// Synthetic catalog in the editor's format (written for this test; not Valeton data): a cab with an OFF-at-minimum
// knob and an OFF-at-maximum one (MinISOff plus valueType 2), and a valueType 2 knob without MinISOff.
const XML = [
  "<GP-200>",
  '  <Catalog Name = "CAB">',
  '    <Alg Name="Test Cab" Module="CAB" Code="167772161" Index="0">',
  '      <Knob Name = "Level" idx = "0" ID = "1" default = "50" Dmin = "0" Dmax = "100" Type = "1" step = "1" />',
  '      <Knob Name = "Floor" idx = "1" ID = "5" Suffix = "Hz" MinISOff = "1" default = "19" Dmin = "19" Dmax = "2000" Type = "1" step = "1" />',
  '      <Knob Name = "Ceiling" idx = "2" ID = "6" Suffix = "Hz" MinISOff = "1" valueType = "2" default = "20001" Dmin = "2000" Dmax = "20001" Type = "1" step = "1" />',
  '      <Knob Name = "Shift" idx = "3" ID = "7" valueType = "2" default = "0" Dmin = "-24" Dmax = "0" Type = "1" step = "1" />',
  "    </Alg>",
  "  </Catalog>",
  "</GP-200>",
].join("\n");

afterAll(() => useGp200Catalog.setState({ catalog: null }));

describe("knobsForBlock", () => {
  it("reads OFF at the minimum, or at the maximum for a knob that also has valueType 2", () => {
    const catalog = buildCatalogFromXml(XML);
    useGp200Catalog.setState({ catalog });
    const model = gp200ModelByFxid(catalog, 167772161, "CAB")!;
    const cab: BlockState = { index: 5, code: "CAB", enabled: true, fxid: 167772161, model, params: [0, 50, 0, 0, 0, 19, 20001, 0] };
    expect(knobsForBlock(cab).map((k) => [k.label, k.off])).toEqual([
      ["Level", undefined],
      ["Floor", "min"],
      ["Ceiling", "max"],
      ["Shift", undefined],
    ]);
  });
});
