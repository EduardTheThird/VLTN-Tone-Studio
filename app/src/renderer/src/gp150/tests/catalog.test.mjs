import assert from "node:assert/strict";
import { test } from "node:test";
import { clampParam, defaultParams, modelByFxid, modelsForBlock } from "../lib/catalog.mjs";
import { GP150_CATALOG } from "../lib/catalog-data.mjs";
import { BLOCKS, NONE_FXID, PARAM_COUNT } from "../lib/protocol.mjs";
import { parsePrst } from "../lib/prst.mjs";
import { PRST } from "./vectors.mjs";

test("every module has models, and every module offers None", () => {
  for (const block of BLOCKS) {
    const models = modelsForBlock(GP150_CATALOG, block);
    assert.ok(models.length > 0, block);
    assert.ok(modelByFxid(GP150_CATALOG, NONE_FXID, block), `${block} None`);
  }
});

test("lookups go by module: index and code name the same module", () => {
  assert.equal(modelByFxid(GP150_CATALOG, 0x07000011, 4)?.name, modelByFxid(GP150_CATALOG, 0x07000011, "AMP")?.name);
  assert.equal(modelByFxid(GP150_CATALOG, 0x07000011, "CAB"), undefined);
});

test("every model of a factory preset is in the catalog", () => {
  for (const b of parsePrst(Uint8Array.from(Buffer.from(PRST, "hex"))).blocks) assert.ok(modelByFxid(GP150_CATALOG, b.fxid, b.index), `${b.code} 0x${b.fxid.toString(16)}`);
});

test("param ids fit the 15 slots of a module and menus name every value", () => {
  for (const m of GP150_CATALOG.modules.flatMap((x) => x.algs))
    for (const k of m.knobs) {
      assert.ok(k.id >= 0 && k.id < PARAM_COUNT, `${m.name} ${k.name}`);
      assert.ok(k.min <= k.default && k.default <= k.max, `${m.name} ${k.name} default`);
      if (k.labels) assert.equal(k.labels.length, k.max - k.min + 1, `${m.name} ${k.name} labels`);
    }
});

test("defaults fill the model's params, the rest stay 0", () => {
  const amp = modelsForBlock(GP150_CATALOG, "AMP")[1];
  const params = defaultParams(GP150_CATALOG, amp.code, "AMP");
  assert.equal(params.length, PARAM_COUNT);
  for (const k of amp.knobs) assert.equal(params[k.id], k.default);
});

test("clampParam keeps a value in range and on its step", () => {
  const knob = { kind: "Knob", name: "x", id: 0, default: 0, min: 0, max: 10, step: 0.5 };
  assert.equal(clampParam(knob, 12), 10);
  assert.equal(clampParam(knob, 3.3), 3.5);
  assert.equal(clampParam(knob, -1), 0);
});
