import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { patchRc10rBank, readRc10rBank, readRc10rRecord, RC10R_RECORD_BYTES } from "./rc10r-bank";
import { testRc10rBank, testRc10rRecord } from "./rc10r-test-data";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("native RC-10R bank preservation", () => {
  it("replaces every one of the 50 user slots while preserving all other record bytes", () => {
    const original = testRc10rBank(50),
      record = testRc10rRecord("New");
    for (let slot = 1; slot <= 50; slot++) {
      const next = patchRc10rBank(original, slot, record),
        at = 12 + (slot - 1) * RC10R_RECORD_BYTES;
      expect(hash(next.subarray(0, at))).toBe(hash(original.subarray(0, at)));
      expect(hash(next.subarray(at + RC10R_RECORD_BYTES))).toBe(hash(original.subarray(at + RC10R_RECORD_BYTES)));
      expect(readRc10rBank(next)[slot - 1].name).toBe("New");
    }
    expect(readRc10rBank(original)[0].name).toBe("User1");
  });
  it("appends only the next empty slot, including the first and last, without creating invalid gaps", () => {
    for (const count of [0, 1, 49]) expect(readRc10rBank(patchRc10rBank(testRc10rBank(count), count + 1, testRc10rRecord()))).toHaveLength(count + 1);
    for (const slot of [0, 51, 2.5, NaN, 50]) expect(() => patchRc10rBank(testRc10rBank(), slot, testRc10rRecord())).toThrow();
  });
  it("rejects malformed headers, hidden records, unsupported descriptors and invalid events", () => {
    const bank = testRc10rBank();
    expect(() => readRc10rBank(bank.slice(0, -1))).toThrow();
    const hidden = bank.slice();
    hidden[hidden.length - 1] = 1;
    expect(() => readRc10rBank(hidden)).toThrow();
    const header = bank.slice();
    header[8] = 1;
    expect(() => readRc10rBank(header)).toThrow();
    for (const offset of [0, 12, 15, 16, 18, 22, 24, 28, 32, 118, 119, 126, 128]) {
      const record = testRc10rRecord();
      record[offset] = 255;
      expect(() => readRc10rRecord(record), `offset ${offset}`).toThrow();
    }
  });
});
