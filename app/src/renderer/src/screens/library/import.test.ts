import { describe, expect, it } from "vitest";
import { convertPrst, readName } from "@/gp5/lib/prst.mjs";
import { buildPrst, encodePatchImage } from "@/gp200/lib/prst.mjs";
import { blankPrst } from "@/gp150/lib/prst.mjs";
import capture from "@/gp5/fixtures/gp50_suite_write_slot0.json";
import { PRST_MODELS } from "@shared/devices";
import { checkPrst } from "./import";

// A real GP-50 file ("US Lead", reconstructed from a Valeton Suite capture) and its GP-5 conversion.
const gp50 = Uint8Array.from(atob(capture.prst_b64), (c) => c.charCodeAt(0));
const gp5 = convertPrst(gp50, "gp5", { force: true });

describe("checkPrst", () => {
  it("accepts a GP-5 preset and reads its name", () => {
    expect(checkPrst(gp5)).toEqual({ ok: true, name: readName(gp5), device: "gp5" });
  });

  it("accepts a GP-50 preset as stored (converted only when written to a GP-5)", () => {
    expect(checkPrst(gp50)).toEqual({ ok: true, name: readName(gp50), device: "gp50" });
  });

  it("rejects files of unknown length and damaged presets with a reason", () => {
    expect(checkPrst(new Uint8Array(100))).toEqual({ ok: false, reason: `Not a ${PRST_MODELS} preset.` });
    const damaged = gp5.slice();
    damaged[0x14] ^= 0xff;
    expect(checkPrst(damaged)).toEqual({ ok: false, reason: "The file is damaged (its checksum doesn't match)." });
  });

  it("accepts a GP-200 family preset and checks its byte sum", () => {
    const gp200 = buildPrst(encodePatchImage({ name: "Imported" }));
    expect(checkPrst(gp200)).toEqual({ ok: true, name: "Imported", device: "gp200" });
    const damaged = gp200.slice();
    damaged[damaged.length - 1] ^= 0xff;
    expect(checkPrst(damaged)).toEqual({ ok: false, reason: "The file is damaged (its checksum doesn't match)." });
    const headerOnly = new Uint8Array(1224);
    headerOnly.set([..."TSRP"].map((c) => c.charCodeAt(0)), 0);
    headerOnly.set([..."2-PG"].map((c) => c.charCodeAt(0)), 0x10);
    expect(checkPrst(headerOnly)).toEqual({ ok: false, reason: `Not a ${PRST_MODELS} preset.` });
  });

  it("accepts a GP-150 preset without a checksum check (its algorithm isn't known) but checks its chain", () => {
    const gp150 = blankPrst(4, "Imported");
    expect(checkPrst(gp150)).toEqual({ ok: true, name: "Imported", device: "gp150" });
    const badChain = gp150.slice();
    badChain[0x79] = badChain[0x78];
    expect(checkPrst(badChain)).toEqual({ ok: false, reason: "The file is damaged (its chain order is invalid)." });
  });
});
