import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OWNED_PEDALS, emptyPedalSettings, type PedalSettingsFile } from "@shared/pedal-settings";
import { configuredPedals, createPedalLibrary, PEDAL_LEGACY_KEY } from "./pedal-library";

afterEach(() => localStorage.clear());

function backing(initial: PedalSettingsFile | null) {
  let data = initial;
  return {
    readPedalSettings: vi.fn(async () => data),
    savePedalSettings: vi.fn(async (next: PedalSettingsFile, onlyIfMissing?: boolean) => {
      if (!onlyIfMissing || !data) data = next;
      return data;
    }),
  };
}

it("migrates the legacy key only when the song library has no file and preserves the old key", async () => {
  const old = JSON.stringify({ profiles: [], channels: { "boss-sy200": 6 }, assignments: { "boss-sy200:ctl1": 82 } });
  localStorage.setItem(PEDAL_LEGACY_KEY, old);
  const api = backing(null);
  const first = createPedalLibrary(localStorage, () => api);
  await first.getState().load();
  await first.getState().load();
  expect(api.savePedalSettings).toHaveBeenCalledExactlyOnceWith(
    {
      version: 1,
      profiles: [],
      channels: { "boss-sy200": 6 },
      assignments: { "boss-sy200:ctl1": 82 },
      presets: {},
      owned: [...DEFAULT_OWNED_PEDALS],
    },
    true,
  );
  first.getState().savePresets("boss-sy200", [{ slot: 44, name: "Pad" }]);
  await first.getState().flush();
  const second = createPedalLibrary(localStorage, () => api);
  await second.getState().load();
  expect(second.getState().presets["boss-sy200"]).toEqual([{ slot: 44, name: "Pad" }]);
  expect(api.savePedalSettings.mock.calls.filter(([, migrate]) => migrate)).toHaveLength(1);
  expect(localStorage.getItem(PEDAL_LEGACY_KEY)).toBe(old);
});

it("reads the file instead of the old key and replays edits made while initial settings are read", async () => {
  localStorage.setItem(PEDAL_LEGACY_KEY, JSON.stringify({ channels: { "boss-sy200": 6 } }));
  const api = backing({ ...emptyPedalSettings(), channels: { "boss-sy200": 4, "boss-ir200": 3 } });
  const library = createPedalLibrary(localStorage, () => api);
  library.getState().setChannel("strymon-timeline", 7);
  await library.getState().flush();
  expect(library.getState().channels).toEqual({ "boss-sy200": 4, "boss-ir200": 3, "strymon-timeline": 7 });
  expect(api.savePedalSettings.mock.calls.every(([, migrate]) => !migrate)).toBe(true);
});

it("keeps failed edits pending, retries them and reloads settings after a restore", async () => {
  const api = backing(emptyPedalSettings());
  const library = createPedalLibrary(localStorage, () => api);
  const state = library.getState();
  await state.load();
  api.savePedalSettings.mockRejectedValueOnce(new Error("Disk full"));
  state.savePresets("boss-ir200", [{ slot: 44, name: "Solo", note: "Clean" }]);
  await vi.waitFor(() => expect(library.getState().saveError).toBe("Disk full"));
  await state.flush();
  expect((await api.readPedalSettings())?.presets["boss-ir200"]).toEqual([{ slot: 44, name: "Solo", note: "Clean" }]);
  await api.savePedalSettings({ ...emptyPedalSettings(), presets: { "boss-ir200": [{ slot: 1, name: "After restore" }] } });
  await state.load(true);
  expect(library.getState().presets["boss-ir200"]).toEqual([{ slot: 1, name: "After restore" }]);
});

const pedal = (pedals: ReturnType<typeof configuredPedals>, name: string) => pedals.find((p) => p.name === name)!;

describe("configuredPedals", () => {
  it("counts the RC-10R's trigger commands as unassigned until their CCs are set", () => {
    const rc10r = pedal(configuredPedals({ profiles: [], channels: {}, assignments: {} }), "BOSS RC-10R");
    expect(rc10r).toEqual({ name: "BOSS RC-10R", channel: 2, unassigned: 15, triggers: [] });
  });
  it("turns assigned trigger commands into (channel, CC) pairs on the channel the pedal is set to", () => {
    const pedals = configuredPedals({
      profiles: [],
      channels: { "boss-rc10r": 5 },
      assignments: { "boss-rc10r:loop-start": 70, "boss-rc10r:loop-stop": 71 },
    });
    const rc10r = pedal(pedals, "BOSS RC-10R");
    expect(rc10r.channel).toBe(5);
    expect(rc10r.unassigned).toBe(13);
    expect(rc10r.triggers).toEqual([
      [5, 70],
      [5, 71],
    ]);
  });
  it("uses the fixed CC numbers of trigger commands that do not need an assignment", () => {
    const timeline = pedal(configuredPedals({ profiles: [], channels: {}, assignments: {} }), "Strymon TimeLine");
    expect(timeline.unassigned).toBe(0);
    expect(timeline.triggers).toEqual(expect.arrayContaining([[1, 93]]));
  });
});

it("persists owned-pedal changes and keeps an explicitly empty rig after reload", async () => {
  const api = backing(emptyPedalSettings());
  const library = createPedalLibrary(localStorage, () => api);
  await library.getState().load();
  for (const id of library.getState().owned) library.getState().setOwned(id, false);
  await library.getState().flush();
  const fresh = createPedalLibrary(localStorage, () => api);
  await fresh.getState().load();
  expect(fresh.getState().owned).toEqual([]);
});

it("starts a fresh rig without preselecting any pedals", async () => {
  const api = backing(null);
  const library = createPedalLibrary(localStorage, () => api);
  await library.getState().load();
  expect(library.getState().owned).toEqual([]);
});
