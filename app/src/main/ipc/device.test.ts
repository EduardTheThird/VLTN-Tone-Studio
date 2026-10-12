// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { MIDI2_DRIVER_RE } from "@shared/host/device";
import { parsePs, parseTasklist, parseWindowsPnp } from "./device";

// vitest hoists this above the imports: device.ts imports electron, which has no app outside Electron.
vi.mock("electron", () => ({ app: {}, dialog: {}, ipcMain: {} }));

const AUDIO_CLASS = ["USB\\Class_01&SubClass_01&Prot_00", "USB\\Class_01&SubClass_01", "USB\\Class_01"];
const MIDI_CLASS = ["USB\\Class_01&SubClass_03&Prot_00", "USB\\Class_01&SubClass_03", "USB\\Class_01"];
const pnp = (rows: object[] | object) => JSON.stringify(rows);

describe("parseWindowsPnp", () => {
  it("reads a single object as well as an array", () => {
    const one = parseWindowsPnp(pnp({ PNPDeviceID: "USB\\VID_84EF&PID_002A\\5&1", Name: "GP-200", Service: "usbccgp", CompatibleID: null }));
    expect(one).toEqual({ usb: [{ vendorId: 0x84ef, productId: 0x002a, product: "GP-200" }], driver: null, usbInterfaces: [] });
    expect(parseWindowsPnp("").usb).toEqual([]);
  });

  it("GP-200 on the USB Audio driver: the MIDIStreaming interface names the driver", () => {
    const r = parseWindowsPnp(
      pnp([
        { PNPDeviceID: "USB\\VID_84EF&PID_002A\\5&1", Name: "GP-200", Service: "usbccgp", CompatibleID: ["USB\\COMPOSITE"] },
        { PNPDeviceID: "USB\\VID_84EF&PID_002A&MI_00\\6&1", Name: "USB Audio Device", Service: "usbaudio", CompatibleID: AUDIO_CLASS },
        { PNPDeviceID: "USB\\VID_84EF&PID_002A&MI_03\\6&2", Name: "USB Audio Device", Service: "usbaudio", CompatibleID: MIDI_CLASS },
      ]),
    );
    expect(r.driver).toBe("usbaudio, USB Audio Device");
    expect(r.usbInterfaces).toEqual([
      { productId: 0x002a, iface: 0, service: "usbaudio", name: "USB Audio Device", midi: false },
      { productId: 0x002a, iface: 3, service: "usbaudio", name: "USB Audio Device", midi: true },
    ]);
  });

  it("accepts CompatibleID as a plain string", () => {
    const r = parseWindowsPnp(pnp([{ PNPDeviceID: "USB\\VID_84EF&PID_002C&MI_02\\6&2", Name: "USB Audio Device", Service: "usbaudio", CompatibleID: "USB\\Class_01&SubClass_03&Prot_00" }]));
    // GP-200LT: no measured interface, so the MIDIStreaming class decides
    expect(r.usbInterfaces[0].midi).toBe(true);
    expect(r.driver).toBe("usbaudio, USB Audio Device");
  });

  it("GP-200 on the MIDI 2.0 driver", () => {
    const r = parseWindowsPnp(
      pnp([
        { PNPDeviceID: "USB\\VID_84EF&PID_002A&MI_00\\6&1", Name: "USB Audio Device", Service: "usbaudio", CompatibleID: AUDIO_CLASS },
        { PNPDeviceID: "USB\\VID_84EF&PID_002A&MI_03\\6&2", Name: "USB MIDI 2.0 Device", Service: "usbmidi2", CompatibleID: MIDI_CLASS },
      ]),
    );
    expect(r.driver).toMatch(MIDI2_DRIVER_RE);
  });

  it("falls back to a MIDI 2.0 driver when no interface reports the MIDI class", () => {
    const r = parseWindowsPnp(
      pnp([
        { PNPDeviceID: "USB\\VID_84EF&PID_0180&MI_00\\6&1", Name: "USB Audio Device", Service: "usbaudio", CompatibleID: null },
        { PNPDeviceID: "USB\\VID_84EF&PID_0180&MI_02\\6&2", Name: "USB MIDI 2.0 Device", Service: "usbmidi2", CompatibleID: null },
      ]),
    );
    expect(r.driver).toBe("usbmidi2, USB MIDI 2.0 Device");
  });

  it("GP-5: the measured MI_03 decides, as before", () => {
    const r = parseWindowsPnp(
      pnp([
        { PNPDeviceID: "USB\\VID_84EF&PID_0184\\5&1", Name: "GP-5", Service: "usbccgp" },
        { PNPDeviceID: "USB\\VID_84EF&PID_0184&MI_00\\6&1", Name: "Speakers", Service: "usbaudio" },
        { PNPDeviceID: "USB\\VID_84EF&PID_0184&MI_03\\6&2", Name: "USB MIDI 2.0 Device", Service: "usbmidi2" },
      ]),
    );
    expect(r.usb).toEqual([{ vendorId: 0x84ef, productId: 0x0184, product: "GP-5" }]);
    expect(r.driver).toBe("usbmidi2, USB MIDI 2.0 Device");
  });

  it("an updater (no pedal) names no driver", () => {
    const r = parseWindowsPnp(pnp([{ PNPDeviceID: "USB\\VID_84EF&PID_002B&MI_00\\6&1", Name: "HID", Service: "HidUsb", CompatibleID: MIDI_CLASS }]));
    expect(r.driver).toBeNull();
    expect(r.usb).toEqual([{ vendorId: 0x84ef, productId: 0x002b, product: null }]);
  });
});

describe("parseTasklist", () => {
  const list = (...images: string[]) => images.map((i, n) => `"${i}","${1000 + n}","Console","1","10,000 K"`).join("\r\n");

  it("finds the GP-200 editor and Valeton Suite by image name", () => {
    expect(parseTasklist(list("explorer.exe", "GP-200.exe"))).toEqual({ suite: false, gp200Editor: true });
    expect(parseTasklist(list("Valeton Suite.exe"))).toEqual({ suite: true, gp200Editor: false });
  });

  it("ignores Tone Studio and the Tone Desk launcher", () => {
    expect(parseTasklist(list("VLTN Tone Studio.exe", "GP-200 Tone Desk.exe"))).toEqual({ suite: false, gp200Editor: false });
  });
});

describe("parsePs", () => {
  it("finds the GP-200 editor as a macOS bundle and under Wine", () => {
    expect(parsePs("/sbin/launchd\n/Applications/GP-200.app/Contents/MacOS/GP-200\n")).toEqual({ suite: false, gp200Editor: true });
    expect(parsePs("wine C:\\Program Files\\Valeton\\GP-200\\GP-200.exe\n")).toEqual({ suite: false, gp200Editor: true });
  });

  it("ignores Tone Studio and the Tone Desk launcher, finds Suite", () => {
    expect(parsePs("/Applications/VLTN Tone Studio.app/Contents/MacOS/VLTN Tone Studio\nC:\\x\\GP-200 Tone Desk.exe\n")).toEqual({ suite: false, gp200Editor: false });
    expect(parsePs("/Applications/Valeton Suite.app/Contents/MacOS/Valeton Suite\n")).toEqual({ suite: true, gp200Editor: false });
  });
});
