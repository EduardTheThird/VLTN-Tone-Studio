import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "@shared/ipc";
import type { T3kTone, ToneSearchParams } from "@shared/host/tones";
import { loadSearch, useTones } from "./store";

const fake = vi.hoisted(() => ({ calls: [] as { p: unknown; page: number }[], reply: null as null | ((page: number) => Promise<unknown>) }));

vi.mock("@/host", () => ({
  host: { tones: { search: (p: ToneSearchParams, page: number) => (fake.calls.push({ p, page }), fake.reply!(page)), account: async () => ({}) } },
}));
vi.mock("@/state/device", () => ({ useDevice: { getState: () => ({ device: "gp5" }) } }));

const tone = (id: number) => ({ id }) as T3kTone;
const page = (ids: number[], p: number, totalPages: number) => ({ tones: ids.map(tone), page: p, totalPages, total: 50, fetchedAt: 1 });

beforeEach(() => {
  fake.calls = [];
  useTones.setState({ format: "all", search: { query: "plexi", sort: "newest", gears: ["amp"], architecture: null } });
  useTones.setState((s) => ({ found: { ...s.found, tones: [], page: 0, totalPages: 1, loaded: false, loading: false, error: null } }));
});

describe("loadSearch", () => {
  it("sends the filters plus the format toggle and appends the next page without duplicates", async () => {
    fake.reply = async (p) => (p === 1 ? page([1, 2], 1, 2) : page([2, 3], 2, 2));
    useTones.setState({ format: "nam" });
    await loadSearch();
    await loadSearch({ more: true });
    expect(fake.calls[0]).toEqual({ p: { query: "plexi", sort: "newest", gears: ["amp"], architecture: null, format: "nam" }, page: 1 });
    expect(fake.calls[1].page).toBe(2);
    expect(useTones.getState().found.tones.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("keeps the error for the Browse fallback", async () => {
    fake.reply = async () => {
      throw new HostError("unsupported", "TONE3000 doesn't allow search for this app key.");
    };
    await loadSearch();
    expect(useTones.getState().found).toMatchObject({ loading: false, loaded: false, error: "TONE3000 doesn't allow search for this app key." });
  });

  it("ignores a slow older search that finishes after a newer one", async () => {
    let release!: () => void;
    fake.reply = (p) => (fake.calls.length === 1 ? new Promise((r) => (release = () => r(page([9], p, 1)))) : Promise.resolve(page([1], p, 1)));
    const older = loadSearch();
    await loadSearch();
    release();
    await older;
    expect(useTones.getState().found.tones.map((t) => t.id)).toEqual([1]);
  });

  it("does not ask for more pages while the last search failed", async () => {
    fake.reply = async () => {
      throw new HostError("network", "slow down");
    };
    await loadSearch();
    await loadSearch({ more: true });
    expect(fake.calls).toHaveLength(1);
  });
});
