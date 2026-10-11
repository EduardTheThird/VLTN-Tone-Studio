// The device store on a simulated GP-50: model detection, GP-50 presets and catalog, empty-slot names, writes.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getDriver, useDevice } from "./device";
import type { Gp5Driver } from "./driver/gp5-driver";

// The simulator loads the bundled backup by URL; serve those URLs from disk (paths are relative to the app root).
vi.stubGlobal("fetch", async (url: string) => new Response(readFileSync(resolve(`.${decodeURIComponent(url)}`))));
// The test runtime has no Web Storage; give the store one so its persistence can be checked.
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, String(v)),
  removeItem: (k: string) => void stored.delete(k),
});

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "../gp5/fixtures", name)));

describe("device store on a simulated GP-50", () => {
  afterAll(async () => {
    await useDevice.getState().disconnect();
  });

  it("detects the GP-50, reads 552-byte presets with the GP-50 catalog and remembers the model", async () => {
    await useDevice.getState().connect("mock", { mockDevice: "gp50" });
    const s = useDevice.getState();
    expect(s.status).toBe("connected");
    expect(s.device).toBe("gp50");
    expect(s.portName).toBe("GP-50 (simulated)");
    expect(s.preset?.device).toBe("gp50");
    expect(s.preset?.prst.length).toBe(552);
    expect(localStorage.getItem("gp5.device.v1")).toBe("gp50");
    expect(JSON.parse(localStorage.getItem("gp5.names.v1")!).device).toBe("gp50");
  }, 30_000);

  it("names empty slots like the GP-50 does", () => {
    const names = useDevice.getState().names.map((n) => n.name.trim());
    expect(names).toHaveLength(100);
    expect(names).toContain("GP-50");
    expect(names).not.toContain("GP-5");
  });

  it("loads GP-50-only models from the GP-50 catalog", async () => {
    await useDevice.getState().setModel(1, 0x05000008);
    expect(useDevice.getState().preset?.blocks[1].model?.name).toBe("C-Wah");
    await useDevice.getState().discard();
  }, 30_000);

  it("writes a 552-byte GP-50 preset and refuses a GP-5 one", async () => {
    await useDevice.getState().writePreset(40, fixture("gp50-US-Lead.prst"));
    const s = useDevice.getState();
    expect(s.slot).toBe(40);
    expect(s.preset).toMatchObject({ device: "gp50", name: "US Lead" });
    expect(s.names.find((n) => n.slot === 40)?.name).toBe("US Lead");
    expect((getDriver() as Gp5Driver).mock!.slots[40].body.length).toBe(511);
    await expect(useDevice.getState().writePreset(41, fixture("65-Puppy.prst"))).rejects.toThrow(/convert it first/);
  }, 60_000);

  it("reconnecting the simulator keeps the chosen model", async () => {
    await useDevice.getState().connect("mock");
    expect(useDevice.getState().device).toBe("gp50");
  }, 30_000);
});
