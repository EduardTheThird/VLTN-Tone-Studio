// The device store in mock mode over every registry model: each connects, syncs and lays out its slots, blocks and
// switches from its profile.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DEVICE_KEYS, profileFor } from "@shared/devices";
import { useDevice } from "./device";
import { hasDriver } from "./driver/types";

// The simulator loads the bundled backup by URL; serve those URLs from disk (paths are relative to the app root).
vi.stubGlobal("fetch", async (url: string) => new Response(readFileSync(resolve(`.${decodeURIComponent(url)}`))));
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, String(v)),
  removeItem: (k: string) => void stored.delete(k),
});

describe("device store over the registry", () => {
  afterAll(async () => {
    await useDevice.getState().disconnect();
  });

  it("has a driver for every model", () => {
    expect(DEVICE_KEYS.filter((k) => hasDriver(profileFor(k).family))).toEqual(DEVICE_KEYS);
  });

  it.each(DEVICE_KEYS)("%s: connects, syncs and lays out slots, blocks and switches from its profile", async (key) => {
    const p = profileFor(key);
    await useDevice.getState().connect("mock", { mockDevice: key });
    const s = useDevice.getState();
    expect(s.status).toBe("connected");
    expect(s.device).toBe(key);
    expect(s.portName).toBe(`${p.name} (simulated)`);
    expect(s.names).toHaveLength(p.slotCount);
    expect(s.names.map((n) => n.slot)).toEqual(Array.from({ length: p.slotCount }, (_, i) => i));
    if (p.emptyName) expect(s.names.map((n) => n.name.trim())).toContain(p.emptyName);
    expect(s.preset?.device).toBe(key);
    expect(s.preset?.blocks.map((b) => b.code)).toEqual(p.blocks);
    expect(s.preset?.footswitches).toHaveLength(p.ctrls);
    expect(s.preset?.prst.length).toBe(p.prst.sizes[0]);
    await useDevice.getState().sync();
    expect(useDevice.getState().names).toHaveLength(p.slotCount);
    expect(useDevice.getState().lastError).toBeNull();
    expect(await useDevice.getState().readSnapTones()).toHaveLength(p.snapTone.slots);
    expect(await useDevice.getState().readUserIRs()).toHaveLength(p.userIr.slots);
  }, 60_000);
});
