/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SNAPTONE as GP5_SNAPTONE, checkSnapToneFile } from "@/gp5/lib/snaptone.mjs";
import { SNAPTONE as GP200_SNAPTONE, checkGp200SnapTone } from "@/gp200/lib/snaptone.mjs";
import { snapToneFile } from "./convert";

/** The clone Valeton Suite 2.1.0 made from an A1 capture (the converter's output format). */
const clone = new Uint8Array(readFileSync(join(__dirname, "../gp5/fixtures/snaptone-a1std.clo")));

describe("snapToneFile", () => {
  it("cuts the upload file each pedal family takes from one clone", () => {
    const gp5 = snapToneFile(clone, "gp50");
    expect(gp5.length).toBe(GP5_SNAPTONE.FILE_SIZE);
    expect(checkSnapToneFile(gp5)).toBeNull();
    const gp200 = snapToneFile(clone, "gp200jr");
    expect(gp200.length).toBe(GP200_SNAPTONE.BLOB_SIZE);
    expect(checkGp200SnapTone(gp200)).toBeNull();
    // Both keep the clone's header and amp curve; the GP-200 keeps more impulse-response taps.
    expect(gp200.subarray(0x88, gp5.length)).toEqual(gp5.subarray(0x88));
  });
});
