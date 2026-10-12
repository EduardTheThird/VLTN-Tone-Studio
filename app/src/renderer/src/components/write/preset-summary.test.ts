import { afterEach, describe, expect, it } from "vitest";
import { useGp200Catalog } from "@/gp200/app/catalog-store";
import { buildCatalogFromXml } from "@/gp200/lib/catalog.mjs";
import { buildPrst, encodePatchImage } from "@/gp200/lib/prst.mjs";
import { ampOrSnapTone, summarize } from "./preset-summary";

// Synthetic catalog in the editor's format (written for this test; not Valeton data): one amp.
const XML = [
  '<?xml version="1.0" encoding="utf-8" ?>',
  "<GP-200>",
  '  <Catalog Name = "AMP">',
  '    <Alg Name="Test Amp" Module="AMP" Code="117440513" Index="0" />',
  "  </Catalog>",
  "</GP-200>",
].join("\r\n");

const initial = useGp200Catalog.getState();

describe("summarize", () => {
  afterEach(() => useGp200Catalog.setState(initial, true));

  it("names a GP-200 preset's models from the built-in list, and again from an imported one", () => {
    const prst = buildPrst(encodePatchImage({ name: "Cached", blocks: { 3: { fxid: 117440513, enabled: true } } }));
    expect(ampOrSnapTone(summarize(prst)!, null)).toEqual({ kind: "amp", title: "Tweedy" });
    useGp200Catalog.setState({ catalog: buildCatalogFromXml(XML) });
    expect(ampOrSnapTone(summarize(prst)!, null)).toEqual({ kind: "amp", title: "Test Amp" });
  });
});
