import { afterAll, describe, expect, it } from "vitest";
import { BUILT_IN_CATALOG } from "@/gp200/lib/catalog-data.mjs";
import { profileFor } from "@shared/devices";
import { gp200ModelByFxid } from "@/gp200/app/catalog-adapter";
import { useGp200Catalog } from "@/gp200/app/catalog-store";
import { buildCatalogFromXml } from "@/gp200/lib/catalog.mjs";
import type { BlockCode, BlockState, ModelInfo } from "@/state/device-types";
import { defaultParamsFor, modelsFor } from "@/state/preset-codec";
import { artFor, knobsForBlock, moreControls } from "./GearFor";

const knob = (name: string, id: number, extra = "") => `      <Knob Name = "${name}" idx = "${id}" ID = "${id}" default = "0" Dmin = "0" Dmax = "100" Type = "1" step = "1" ${extra}/>`;
const toggle = (name: string, id: number) => `      <Switch Name = "${name}" idx = "${id}" ID = "${id}" default = "0" Type = "3"><Menu Name = "OFF" ID= "0" /><Menu Name = "ON" ID= "1" /></Switch>`;

// Synthetic catalog in the editor's format (written for this test; not Valeton data): a cab with an OFF-at-minimum
// knob and an OFF-at-maximum one (MinISOff plus valueType 2) and a valueType 2 knob without MinISOff; a delay with
// 11 knobs and 2 switches; a SnapTone slot (fxid 0x0F000005) in DST.
const XML = [
  "<GP-200>",
  '  <Catalog Name = "CAB">',
  '    <Alg Name="Test Cab" Module="CAB" Code="167772161" Index="0">',
  knob("Level", 1),
  '      <Knob Name = "Floor" idx = "5" ID = "5" Suffix = "Hz" MinISOff = "1" default = "19" Dmin = "19" Dmax = "2000" Type = "1" step = "1" />',
  '      <Knob Name = "Ceiling" idx = "6" ID = "6" Suffix = "Hz" MinISOff = "1" valueType = "2" default = "20001" Dmin = "2000" Dmax = "20001" Type = "1" step = "1" />',
  '      <Knob Name = "Shift" idx = "7" ID = "7" valueType = "2" default = "0" Dmin = "-24" Dmax = "0" Type = "1" step = "1" />',
  "    </Alg>",
  "  </Catalog>",
  '  <Catalog Name = "DLY">',
  '    <Alg Name="Test Echo" Module="DLY" Code="184549377" Index="0">',
  ...Array.from({ length: 11 }, (_, i) => knob(`K${i}`, i)),
  toggle("S1", 11),
  toggle("S2", 12),
  "    </Alg>",
  "  </Catalog>",
  '  <Catalog Name = "DST">',
  '    <Alg Name="Test Capture" Module="DST" Code="251658245" Index="0">',
  ...Array.from({ length: 5 }, (_, i) => knob(`C${i}`, i)),
  "    </Alg>",
  "  </Catalog>",
  "</GP-200>",
].join("\n");
const catalog = buildCatalogFromXml(XML);

const blockOf = (code: BlockCode, index: number, model: ModelInfo, params: number[]): BlockState => ({ index, code, enabled: true, fxid: model.fxid, model, params });

afterAll(() => useGp200Catalog.setState({ catalog: BUILT_IN_CATALOG }));

describe("knobsForBlock", () => {
  it("reads OFF at the minimum, or at the maximum for a knob that also has valueType 2", () => {
    useGp200Catalog.setState({ catalog });
    const cab = blockOf("CAB", 5, gp200ModelByFxid(catalog, 167772161, "CAB")!, [0, 50, 0, 0, 0, 19, 20001, 0]);
    expect(knobsForBlock(cab).map((k) => [k.label, k.off])).toEqual([
      ["Level", undefined],
      ["Floor", "min"],
      ["Ceiling", "max"],
      ["Shift", undefined],
    ]);
  });
});

describe("artFor and moreControls", () => {
  it("GP-5 family: every control fits its drawing, and only NS draws as a capture", () => {
    for (const device of ["gp5", "gp50"] as const) {
      profileFor(device).blocks.forEach((code, k) => {
        for (const m of modelsFor(device, k)) {
          const b = blockOf(code as BlockCode, k, m, defaultParamsFor(device, k, m.fxid));
          expect(moreControls(b), `${device} ${code} ${m.title}`).toEqual([]);
          expect(artFor(b) === "capture", `${device} ${code} ${m.title}`).toBe(code === "NS");
        }
      });
    }
  });

  it("GP-200: a SnapTone in DST draws as a capture with every knob in More controls; a long delay overflows", () => {
    const capture = blockOf("DST", 2, gp200ModelByFxid(catalog, 251658245, "DST")!, new Array(15).fill(0));
    expect(artFor(capture)).toBe("capture");
    expect(moreControls(capture).map((k) => k.label)).toEqual(["C0", "C1", "C2", "C3", "C4"]);
    const echo = blockOf("DLY", 8, gp200ModelByFxid(catalog, 184549377, "DLY")!, new Array(15).fill(0));
    expect(artFor(echo)).toBe("pedal");
    expect(moreControls(echo).map((k) => k.label)).toEqual(["K9", "K10"]);
  });
});
