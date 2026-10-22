// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEVICE_KEYS,
  MAX_PRST_BYTES,
  PRST_MODELS,
  PROFILES,
  deviceForPortName,
  deviceForUsbPid,
  familyKeys,
  isDeviceKey,
  listNames,
  prstName,
  sniffPrst,
  snapToneLabel,
} from "./devices";
import { pedalOnUsb, updaterOnUsb, type DeviceHostStatus } from "./host/device";

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
function file(length: number, parts: [number, number[]][]): Uint8Array {
  const b = new Uint8Array(length);
  for (const [offset, bytes] of parts) b.set(bytes, offset);
  return b;
}
const gp5File = (model: string, length: number) => file(length, [[0, [...ascii(model), 0]]]);
const gp200File = (length: number) => file(length, [[0, ascii("TSRP")], [0x10, ascii("2-PG")]]);

describe("profiles", () => {
  it("has one profile per key, keyed by itself", () => {
    expect(DEVICE_KEYS).toEqual(["gp5", "gp50", "gp200", "gp200lt", "gp200jr", "gp150", "gp180"]);
    for (const k of DEVICE_KEYS) expect(PROFILES[k].key).toBe(k);
    expect(familyKeys("gp5")).toEqual(["gp5", "gp50"]);
    expect(familyKeys("gp200")).toEqual(["gp200", "gp200lt", "gp200jr"]);
    expect(familyKeys("gp150")).toEqual(["gp150", "gp180"]);
    expect(isDeviceKey("gp200lt")).toBe(true);
    expect(isDeviceKey("gp500")).toBe(false);
    expect(isDeviceKey(null)).toBe(false);
  });

  it("describes the GP-5 family geometry the app always used", () => {
    for (const k of ["gp5", "gp50"] as const) {
      const p = PROFILES[k];
      expect(p.slotCount).toBe(100);
      expect([p.slotLabel(0), p.slotLabel(7), p.slotLabel(99)]).toEqual(["00", "07", "99"]);
      expect(p.blocks).toEqual(["NR", "PRE", "DST", "AMP", "CAB", "EQ", "MOD", "DLY", "RVB", "NS"]);
      expect(p.snapTone).toEqual({ slots: 80, userRange: [50, 79], fxidBase: 0x0f000000 });
      expect(p.userIr).toEqual({ slots: 20, userRange: [0, 19], fxidBase: 0x0a100000, samples: 512 });
      expect(p.simulator).toBe(true);
    }
    expect([PROFILES.gp5.emptyName, PROFILES.gp50.emptyName]).toEqual(["GP-5", "GP-50"]);
  });

  it("labels GP-200 slots by bank and letter, 255 on the JR", () => {
    const p = PROFILES.gp200;
    expect([p.slotLabel(0), p.slotLabel(3), p.slotLabel(46), p.slotLabel(255)]).toEqual(["01-A", "01-D", "12-C", "64-D"]);
    expect(p.parseSlotLabel("12-C")).toBe(46);
    expect(p.parseSlotLabel("64-D")).toBe(255);
    expect(PROFILES.gp200jr.slotCount).toBe(255);
    expect(PROFILES.gp200jr.parseSlotLabel("64-D")).toBeNull();
    expect(p.parseSlotLabel("00-A")).toBeNull();
    expect(p.parseSlotLabel("07")).toBeNull();
    expect(PROFILES.gp5.parseSlotLabel("12-C")).toBeNull();
    expect(p.blocks).toEqual(["PRE", "WAH", "DST", "AMP", "NR", "CAB", "EQ", "MOD", "DLY", "RVB", "VOL"]);
    expect(p.snapTone).toEqual({ slots: 10, userRange: [0, 9], fxidBase: 0x0f000000 });
    expect(p.userIr.samples).toBe(1024);
    expect(p.emptyName).toBeNull();
    expect(p.simulator).toBe(true);
    expect(p.tempo).toEqual({ min: 40, max: 250 });
  });

  it("gives the GP-180 the GP-150's slots and file, with a third footswitch", () => {
    const [a, b] = [PROFILES.gp150, PROFILES.gp180];
    expect([b.slotCount, b.prst, b.blocks, b.snapTone]).toEqual([a.slotCount, a.prst, a.blocks, a.snapTone]);
    expect([a.ctrls, b.ctrls]).toEqual([2, 3]);
  });

  it("labels GP-150 slots 001 to 200, as the pedal counts", () => {
    const p = PROFILES.gp150;
    expect([p.slotLabel(0), p.slotLabel(41), p.slotLabel(199)]).toEqual(["001", "042", "200"]);
    expect([p.parseSlotLabel("001"), p.parseSlotLabel("200"), p.parseSlotLabel("000"), p.parseSlotLabel("201"), p.parseSlotLabel("42")]).toEqual([0, 199, null, null, null]);
  });
});

describe("USB product ids", () => {
  it("maps normal-mode pids to models", () => {
    expect(deviceForUsbPid(0x0184)).toBe("gp5");
    expect(deviceForUsbPid(0x018a)).toBe("gp50");
    expect(deviceForUsbPid(0x002a)).toBe("gp200");
    expect(deviceForUsbPid(0x002c)).toBe("gp200lt");
    expect(deviceForUsbPid(0x0180)).toBe("gp200jr");
    expect(deviceForUsbPid(0x002b)).toBeNull();
  });

  it("reports a GP-200 on USB as a GP-200, its updater as update mode", () => {
    const status = (productId: number) => ({ usb: [{ vendorId: 0x84ef, productId, product: null }] }) as unknown as DeviceHostStatus;
    expect(pedalOnUsb(status(0x002a))).toBe("gp200");
    expect(updaterOnUsb(status(0x002a))).toBe(false);
    expect(pedalOnUsb(status(0x002b))).toBeNull();
    expect(updaterOnUsb(status(0x002b))).toBe(true);
    expect(updaterOnUsb(status(0x0185))).toBe(true);
    expect(pedalOnUsb(status(0x0186))).toBe("gp150");
    expect(pedalOnUsb(status(0x0188))).toBe("gp180");
    expect(updaterOnUsb(status(0x0189))).toBe(true);
    expect(pedalOnUsb(status(0x018a))).toBe("gp50");
    expect(pedalOnUsb({ usb: [{ vendorId: 0x1234, productId: 0x0184, product: null }] } as unknown as DeviceHostStatus)).toBeNull();
  });
});

describe("MIDI port names", () => {
  it("tells the models apart", () => {
    expect(deviceForPortName("GP-5")).toBe("gp5");
    expect(deviceForPortName("GP-5 MIDI 1")).toBe("gp5");
    expect(deviceForPortName("gp-5 midi (mock)")).toBe("gp5");
    expect(deviceForPortName("GP-50 MIDI 1")).toBe("gp50");
    expect(deviceForPortName("GP-200 MIDI 1")).toBe("gp200");
    expect(deviceForPortName("GP-200LT MIDI 1")).toBe("gp200lt");
    expect(deviceForPortName("GP-200JR")).toBe("gp200jr");
    expect(deviceForPortName("GP-150 MIDI 1")).toBe("gp150");
    expect(deviceForPortName("Valeton GP-180 MIDI")).toBe("gp180");
    expect(deviceForPortName("GP-1500")).toBeNull();
    expect(deviceForPortName("GP-500")).toBeNull();
    expect(deviceForPortName("gp-200 midi 1")).toBeNull();
    expect(deviceForPortName("Midi Through Port-0")).toBeNull();
  });
});

describe(".prst sniffing", () => {
  it("needs the model's header and size", () => {
    expect(sniffPrst(gp5File("GP-5", 507))).toBe("gp5");
    expect(sniffPrst(gp5File("GP-50", 552))).toBe("gp50");
    expect(sniffPrst(gp5File("GP-5", 552))).toBeNull();
    expect(sniffPrst(gp5File("GP-500", 552))).toBeNull();
    expect(sniffPrst(new Uint8Array(507))).toBeNull();
  });

  it("reads TSRP files of both sizes as GP-200 presets", () => {
    expect(sniffPrst(gp200File(1224))).toBe("gp200");
    expect(sniffPrst(gp200File(1176))).toBe("gp200");
    expect(sniffPrst(gp200File(1200))).toBeNull();
    expect(sniffPrst(file(1224, [[0, ascii("TSRP")]]))).toBeNull();
  });

  it("reads 1128-byte files with records 0x3011 and 0x3010 as GP-150 presets", () => {
    const gp150File = (length: number) => file(length, [[0, [0x11, 0x30, 0x64, 0x04]], [8, [0x10, 0x30]]]);
    expect(sniffPrst(gp150File(1128))).toBe("gp150");
    expect(sniffPrst(gp150File(1224))).toBeNull();
    expect(sniffPrst(file(1128, [[0, [0x11, 0x30, 0x64, 0x04]]]))).toBeNull();
    expect(prstName(file(1128, [[0x2c, ascii("Foxy Clean")]]), "gp150")).toBe("Foxy Clean");
  });

  it("reads the preset name of each layout", () => {
    expect(prstName(file(507, [[0x19, ascii("Blues Man")]]), "gp5")).toBe("Blues Man");
    expect(prstName(file(1224, [[0x44, ascii("Lead 12C")]]), "gp200")).toBe("Lead 12C");
  });

  it("caps file reads at the largest preset", () => {
    expect(MAX_PRST_BYTES).toBe(1224);
    expect(PRST_MODELS).toBe("GP-5, GP-50, GP-200 or GP-150");
    expect(listNames(["gp5", "gp50"], "and")).toBe("GP-5 and GP-50");
    expect(listNames(["gp5"])).toBe("GP-5");
  });
});

describe("snapToneLabel / backupSeconds", () => {
  it("shows the 0-based SnapTone slot and keeps a backup estimate per model", () => {
    expect(snapToneLabel("gp5", 52)).toBe("SnapTone 52");
    expect(PROFILES.gp5.backupSeconds).toBe(75);
    expect(PROFILES.gp200.backupSeconds).toBeGreaterThan(PROFILES.gp5.backupSeconds);
  });
});
