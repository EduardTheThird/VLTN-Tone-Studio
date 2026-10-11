// The device store in mock mode over every registry model: models with a driver connect, sync and lay out their slots
// from the profile; models without one fail cleanly with "unsupported-model" and nothing connected.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DEVICE_KEYS, profileFor } from "@shared/devices";
import { getDriver, useDevice } from "./device";
import { refineConnectionError } from "./connection-error";
import { hasDriver } from "./driver/types";
import type { DeviceHostStatus } from "@shared/host/device";

// The simulator loads the bundled backup by URL; serve those URLs from disk (paths are relative to the app root).
vi.stubGlobal("fetch", async (url: string) => new Response(readFileSync(resolve(`.${decodeURIComponent(url)}`))));
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, String(v)),
  removeItem: (k: string) => void stored.delete(k),
});

const driven = DEVICE_KEYS.filter((k) => hasDriver(profileFor(k).family));
const undriven = DEVICE_KEYS.filter((k) => !hasDriver(profileFor(k).family));

describe("device store over the registry", () => {
  afterAll(async () => {
    await useDevice.getState().disconnect();
  });

  it("covers every model: GP-5 family driven, GP-200 family not yet", () => {
    expect(driven).toEqual(["gp5", "gp50"]);
    expect(undriven).toEqual(["gp200", "gp200lt", "gp200jr"]);
  });

  it.each(driven)("%s: connects, syncs and lays out slots and blocks from its profile", async (key) => {
    const p = profileFor(key);
    await useDevice.getState().connect("mock", { mockDevice: key });
    const s = useDevice.getState();
    expect(s.status).toBe("connected");
    expect(s.device).toBe(key);
    expect(s.portName).toBe(`${p.name} (simulated)`);
    expect(s.names).toHaveLength(p.slotCount);
    expect(s.names.map((n) => n.slot)).toEqual(Array.from({ length: p.slotCount }, (_, i) => i));
    expect(s.names.map((n) => n.name.trim())).toContain(p.emptyName);
    expect(p.slotLabel(7)).toBe("07");
    expect(s.preset?.device).toBe(key);
    expect(s.preset?.blocks.map((b) => b.code)).toEqual(p.blocks);
    expect(s.preset?.prst.length).toBe(p.prst.sizes[0]);
    await useDevice.getState().sync();
    expect(useDevice.getState().names).toHaveLength(p.slotCount);
    expect(useDevice.getState().lastError).toBeNull();
    expect(await useDevice.getState().readSnapTones()).toHaveLength(p.snapTone.slots);
    expect(await useDevice.getState().readUserIRs()).toHaveLength(p.userIr.slots);
  }, 60_000);

  it.each(undriven)("%s: fails with unsupported-model and leaves nothing connected", async (key) => {
    const before = useDevice.getState().device;
    await expect(useDevice.getState().connect("mock", { mockDevice: key })).rejects.toMatchObject({ code: "unsupported-model" });
    const s = useDevice.getState();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("unsupported-model");
    expect(s.error?.message).toBe(`${profileFor(key).name} support is coming in a later version of Tone Studio. This version works with the GP-5 and GP-50.`);
    expect(getDriver()).toBeNull();
    // The remembered model is only replaced by a pedal that connected.
    expect(s.device).toBe(before);
  });

  it("names a GP-200 that is on USB without a MIDI port instead of reporting it missing", () => {
    const usb = (productId: number) => ({ usb: [{ vendorId: 0x84ef, productId, product: null }] }) as unknown as DeviceHostStatus;
    const notFound = { code: "not-found" as const, message: "No port" };
    expect(refineConnectionError(notFound, usb(0x002a))).toMatchObject({ code: "unsupported-model", message: expect.stringMatching(/^GP-200 support/) });
    expect(refineConnectionError(notFound, usb(0x002b)).code).toBe("bootloader");
    expect(refineConnectionError(notFound, usb(0x0184))).toBe(notFound);
  });
});
