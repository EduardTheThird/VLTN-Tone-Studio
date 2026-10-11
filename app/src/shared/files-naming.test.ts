// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  backupDirName,
  collectionDirName,
  commonModel,
  isSafePresetFileName,
  parseBackupDirName,
  parseCollectionId,
  parseSlotFileName,
  presetFileName,
  sanitizeFileName,
  slotFileName,
  uniqueFileName,
} from "./files-naming";

describe("sanitizeFileName", () => {
  it("keeps spaces, dashes and case like the pedal's own backups", () => {
    expect(sanitizeFileName("Neo Soul")).toBe("Neo Soul");
    expect(sanitizeFileName("Shatte-GT1")).toBe("Shatte-GT1");
  });
  it("replaces characters Windows forbids and trims trailing dots and spaces", () => {
    expect(sanitizeFileName('A/B\\C:D*E?F"G<H>I|J')).toBe("A_B_C_D_E_F_G_H_I_J");
    expect(sanitizeFileName("Lead...  ")).toBe("Lead");
    expect(sanitizeFileName("..hidden")).toBe("hidden");
  });
  it("prefixes reserved device names and falls back when nothing is left", () => {
    expect(sanitizeFileName("CON")).toBe("_CON");
    expect(sanitizeFileName("lpt1.prst")).toBe("_lpt1.prst");
    expect(sanitizeFileName("   ")).toBe("Preset");
    expect(sanitizeFileName("...", "GP-5")).toBe("GP-5");
  });
});

describe("slot files", () => {
  it("names backup files <slot label>-Name.prst, blank names after the model's empty slot", () => {
    expect(slotFileName(0, "GreatPedal", "gp5")).toBe("00-GreatPedal.prst");
    expect(slotFileName(97, "FF/CC", "gp5")).toBe("97-FF_CC.prst");
    expect(slotFileName(64, "", "gp5")).toBe("64-GP-5.prst");
    expect(slotFileName(64, "", "gp50")).toBe("64-GP-50.prst");
    expect(slotFileName(46, "Lead", "gp200")).toBe("12-C-Lead.prst");
    expect(slotFileName(255, "", "gp200")).toBe("64-D-GP-200.prst");
  });
  it("parses them back with the model's slot labels", () => {
    expect(parseSlotFileName("07-Blues Man.prst", "gp5")).toEqual({ slot: 7, name: "Blues Man" });
    expect(parseSlotFileName("07-A-B.prst", "gp5")).toEqual({ slot: 7, name: "A-B" });
    expect(parseSlotFileName("Puppy.prst", "gp5")).toBeNull();
    expect(parseSlotFileName("7-Blues.prst", "gp5")).toBeNull();
    expect(parseSlotFileName("12-C-Lead.prst", "gp200")).toEqual({ slot: 46, name: "Lead" });
    expect(parseSlotFileName("12-Lead.prst", "gp200")).toBeNull();
    expect(parseSlotFileName("64-D-X.prst", "gp200jr")).toBeNull();
  });
  it("uses the slot prefix only when the preset came from a slot of a known model", () => {
    expect(presetFileName("Puppy", 65, "gp5")).toBe("65-Puppy.prst");
    expect(presetFileName("US Lead", null, "gp50")).toBe("US Lead.prst");
    expect(presetFileName("Odd", 3, null)).toBe("Odd.prst");
  });
});

describe("backup folders", () => {
  const day = new Date(2026, 9, 7, 14, 32);
  it("uses the local date and numbers repeats of the same day", () => {
    expect(backupDirName(day, [], "gp5")).toBe("gp5-2026-10-07");
    expect(backupDirName(day, ["gp5-2026-10-07"], "gp5")).toBe("gp5-2026-10-07-2");
    expect(backupDirName(day, ["gp5-2026-10-07", "GP5-2026-10-07-2"], "gp5")).toBe("gp5-2026-10-07-3");
    expect(backupDirName(day, ["gp5-2026-10-06"], "gp5")).toBe("gp5-2026-10-07");
  });
  it("names GP-50 backups gp50-…, numbered apart from GP-5 backups", () => {
    expect(backupDirName(day, ["gp5-2026-10-07"], "gp50")).toBe("gp50-2026-10-07");
    expect(backupDirName(day, ["gp50-2026-10-07"], "gp50")).toBe("gp50-2026-10-07-2");
  });
  it("reads the date and model back and ignores foreign folders", () => {
    expect(parseBackupDirName("gp5-2026-10-07-2")).toMatchObject({ device: "gp5" });
    expect(parseBackupDirName("gp5-2026-10-07-2")?.date.getDate()).toBe(7);
    expect(parseBackupDirName("gp50-2026-10-07")).toMatchObject({ device: "gp50" });
    expect(parseBackupDirName("gp50-2026-10-07")?.date.getMonth()).toBe(9);
    expect(parseBackupDirName("gp200lt-2026-10-07")).toMatchObject({ device: "gp200lt" });
    expect(parseBackupDirName("gp5-2026-02-31")).toBeNull();
    expect(parseBackupDirName("gp500-2026-10-07")).toBeNull();
    expect(parseBackupDirName("photos")).toBeNull();
  });
  it("names GP-200 backups gp200-…", () => {
    expect(backupDirName(day, ["gp5-2026-10-07"], "gp200")).toBe("gp200-2026-10-07");
  });
});

describe("preset models", () => {
  const head = (text: string, length: number) => {
    const b = new Uint8Array(length);
    b.set(new TextEncoder().encode(text), 0);
    return b;
  };
  it("finds the one model of a set of presets", () => {
    expect(commonModel([head("GP-50", 552), head("GP-50", 552)])).toBe("gp50");
    expect(commonModel([head("GP-5", 507), head("GP-50", 552)])).toBeNull();
    expect(commonModel([new Uint8Array(507)])).toBeNull();
    expect(commonModel([])).toBeNull();
  });
});

describe("unique names", () => {
  it("adds (n) before the extension, case-insensitively", () => {
    expect(uniqueFileName("Puppy.prst", [])).toBe("Puppy.prst");
    expect(uniqueFileName("Puppy.prst", ["puppy.prst"])).toBe("Puppy (2).prst");
    expect(uniqueFileName("Puppy.prst", ["Puppy.prst", "Puppy (2).prst"])).toBe("Puppy (3).prst");
  });
  it("never gives a user collection a reserved folder", () => {
    expect(collectionDirName("Imported", [])).toBe("Imported (2)");
    expect(collectionDirName("Rehearsal set", ["Rehearsal set"])).toBe("Rehearsal set (2)");
    expect(collectionDirName("a/b", [])).toBe("a_b");
  });
});

describe("collection ids", () => {
  it("accepts one folder under backups or library", () => {
    expect(parseCollectionId("backups/gp5-2026-10-07")).toEqual({ root: "backups", dir: "gp5-2026-10-07" });
    expect(parseCollectionId("library/Rehearsal set")).toEqual({ root: "library", dir: "Rehearsal set" });
  });
  it("rejects traversal and other roots", () => {
    expect(parseCollectionId("backups/..")).toBeNull();
    expect(parseCollectionId("library/a/b")).toBeNull();
    expect(parseCollectionId("library/..\\x")).toBeNull();
    expect(parseCollectionId("/etc")).toBeNull();
    expect(parseCollectionId("settings/x")).toBeNull();
  });
  it("accepts only plain .prst file names inside a collection", () => {
    expect(isSafePresetFileName("65-Puppy.prst")).toBe(true);
    expect(isSafePresetFileName("../x.prst")).toBe(false);
    expect(isSafePresetFileName("a.txt")).toBe(false);
  });
});
