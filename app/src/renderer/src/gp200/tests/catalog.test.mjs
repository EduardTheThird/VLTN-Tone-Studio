import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCatalogFromXml,
  clampParam,
  defaultParams,
  describePatch,
  modelByFxid,
  modelsForBlock,
  optionValues,
  parseXml,
  tempoSyncBinding,
} from "../lib/catalog.mjs";
import { encodePatchImage, parsePatch } from "../lib/prst.mjs";

// Synthetic file in the editor's format (written for this test; not Valeton data). CRLF, comments, entities, a
// non-integer ID, a text default, a TrueID combox, a tempo-sync pair and an fxid shared by two modules.
const XML = [
  '<?xml version="1.0" encoding="utf-8" ?>',
  "<GP-200>",
  "  <!-- test catalog -->",
  '  <Catalog Name = "PRE">',
  '    <Alg Name="Test Boost" Module="PRE" Code="26" Index="1">',
  '      <Knob  Name = "Gain"  idx = "0" ID = "0" default = "20" Dmin = "0" Dmax = "100" Type = "1" step = "1" />',
  "    </Alg>",
  '    <Alg Name="Test Wah" Module="PRE" Code="16777231" Index="0">',
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
  '      <Knob  Name = "Wow &amp; Flutter"  idx = "0" ID = "1.0" default = "50.0" Dmin = "0" Dmax = "100" Type = "1" step = "1.0" />',
  '      <Combox Name = "Mode" default = "0" idx = "1" ID = "3" Type = "2">',
  '        <Menu Name = "Clean" ID= "0" TrueID = "1"/>',
  '        <Menu Name = "OD" ID= "1" TrueID = "2" />',
  "      </Combox>",
  "    </Alg>",
  "  </Catalog>",
  '  <Catalog Name = "AMP">',
  '    <Alg Name="Test Amp" Module="AMP" Code="117440513" Index="0" CABCode="167772162">',
  '      <Knob  Name = "Detune"  idx = "0" ID = "0" Suffix = "cents" default = "-25 Cents" Dmin = "-50" Dmax = "50" Type = "1" step = "1.0" />',
  '      <Slider Name = "Level" default = "0" idx = "1" ID = "2"  Dmin = "-50" Dmax = "50" Type = "1" step = "1.0" />',
  '      <Knob  Name = "Low Cut"  idx = "2" ID = "5" Suffix = "Hz" MinISOff = "1" default = "19" Dmin = "19" Dmax = "2000" Type = "1" step = "1.0" />',
  "    </Alg>",
  "  </Catalog>",
  "</GP-200>",
].join("\r\n");

test("builder: shape, counts and XML attribute semantics", () => {
  const c = buildCatalogFromXml(XML);
  assert.deepEqual(c.meta.counts, { algEntries: 5, uniqueCodes: 4, perModule: { PRE: 2, DST: 2, AMP: 1 }, controls: 9 });
  const amp = c.modules[2].algs[0];
  assert.deepEqual(
    { ...amp, knobs: undefined },
    { name: "Test Amp", module: "AMP", code: 0x07000001, index: 0, cabCode: 0x0a000002, knobs: undefined },
  );
  assert.deepEqual(amp.knobs[0], { kind: "Knob", name: "Detune", idx: 0, id: 0, type: 1, default: -25, defaultRaw: "-25 Cents", min: -50, max: 50, step: 1, suffix: "cents" });
  assert.deepEqual(amp.knobs[1], { kind: "Slider", name: "Level", idx: 1, id: 2, type: 1, default: 0, min: -50, max: 50, step: 1 });
  assert.equal(amp.knobs[2].minIsOff, 1);
  const od = c.modules[1].algs[1];
  assert.equal(od.knobs[0].name, "Wow & Flutter");
  assert.equal(od.knobs[0].id, 1, 'ID "1.0" is param 1');
  assert.deepEqual(od.knobs[1].options, [
    { name: "Clean", value: 0, trueId: 1 },
    { name: "OD", value: 1, trueId: 2 },
  ]);
  const sync = c.modules[0].algs[1].knobs[1];
  assert.deepEqual(sync, {
    kind: "Switch",
    name: "Sync",
    idx: 1,
    id: 6,
    type: 3,
    default: 0,
    bind: 0,
    subType: "Power",
    options: [
      { name: "OFF", value: 0 },
      { name: "ON", value: 1 },
    ],
  });
  assert.equal(c.modules[0].algs[1].knobs[0].valueType, 1);
});

test("lookups: shared fxids per block, list order", () => {
  const c = buildCatalogFromXml(XML);
  assert.equal(modelByFxid(c, 26, "DST").knobs[0].default, 35);
  assert.equal(modelByFxid(c, 26, 0).knobs[0].default, 20);
  assert.equal(modelByFxid(c, 26).module, "PRE");
  assert.equal(modelByFxid(c, 0xdeadbeef), undefined);
  assert.deepEqual(modelsForBlock(c, "PRE").map((m) => m.name), ["Test Wah", "Test Boost"], "editor list order (Index)");
});

test("values: defaults with TrueID, clamping, tempo-sync pair", () => {
  const c = buildCatalogFromXml(XML);
  assert.deepEqual(defaultParams(c, 50331681, "DST"), [0, 50, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(defaultParams(c, 0x07000001).slice(0, 6), [-25, 0, 0, 0, 0, 19]);
  const knob = (fxid, name) => modelByFxid(c, fxid).knobs.find((k) => k.name === name);
  const mode = knob(50331681, "Mode");
  assert.deepEqual(optionValues(mode), [1, 2]);
  assert.equal(clampParam(mode, 2), 2);
  assert.throws(() => clampParam(mode, 0), RangeError);
  const rate = knob(16777231, "Rate");
  assert.equal(clampParam(rate, 20), 10);
  assert.equal(clampParam(rate, 0.123), 0.1);
  const wah = modelByFxid(c, 16777231);
  const pair = tempoSyncBinding(wah, rate);
  assert.equal(pair.sync.name, "Sync");
  assert.equal(pair.target, rate);
  assert.equal(tempoSyncBinding(wah, wah.knobs[1]).target, rate);
  assert.equal(tempoSyncBinding(modelByFxid(c, 26), modelByFxid(c, 26).knobs[0]), null);
});

test("describePatch names models and params", () => {
  const c = buildCatalogFromXml(XML);
  const img = encodePatchImage({ blocks: { 2: { fxid: 50331681, enabled: true, params: defaultParams(c, 50331681, "DST") } } });
  const d = describePatch(c, parsePatch(img));
  assert.deepEqual(d[2], { block: "DST", enabled: true, fxid: "0x03000021", model: "Mode OD", params: { "Wow & Flutter": 50, Mode: 1 } });
  assert.equal(d[0].model, "unknown");
});

test("errors: not a catalog, broken XML, out-of-range param ID", () => {
  assert.throws(() => buildCatalogFromXml("<root><x/></root>"), /no GP-200 effect catalogs/);
  assert.throws(() => buildCatalogFromXml(""), /empty/);
  assert.throws(() => parseXml("<a><b></a>"), /unexpected <\/a>/);
  assert.throws(() => parseXml("<a>"), /not closed/);
  const bad = XML.replace('ID = "5"', 'ID = "15"');
  assert.throws(() => buildCatalogFromXml(bad), /param ID 15/);
});
