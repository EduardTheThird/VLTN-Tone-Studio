// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ToneSearchParams } from "@shared/host/tones";
import { HostError } from "@shared/ipc";
import { normalizeSearch, searchPath, T3kClient } from "./api";
import type { TokenManager } from "./tokens";

const base: ToneSearchParams = { query: "", sort: "best-match", gears: [], format: null, architecture: null };

describe("normalizeSearch", () => {
  it("falls back to defaults for junk", () => {
    expect(normalizeSearch(null)).toEqual(base);
    expect(normalizeSearch({ query: 5, sort: "x", gears: "amp", format: "wav", architecture: "9" })).toEqual(base);
  });
  it("trims and caps the query, keeps only known gears", () => {
    const p = normalizeSearch({ query: `  ${"a".repeat(300)} `, sort: "newest", gears: ["amp", "bogus", "pedal"], format: "nam", architecture: "2" });
    expect(p.query).toHaveLength(100);
    expect(p).toMatchObject({ sort: "newest", gears: ["amp", "pedal"], format: "nam", architecture: "2" });
  });
});

describe("searchPath", () => {
  it("joins gears with underscores and omits empty filters", () => {
    expect(searchPath({ ...base, query: "plexi & co", gears: ["amp", "amp-cab"], format: "nam" }, 2)).toBe(
      "/tones/search?page=2&page_size=25&sort=best-match&query=plexi+%26+co&gears=amp_amp-cab&format=nam",
    );
    expect(searchPath({ ...base }, 1)).toBe("/tones/search?page=1&page_size=25&sort=best-match");
  });
});

describe("T3kClient.search", () => {
  const tokens = { accessToken: async () => "t", forceRefresh: async () => "t" } as unknown as TokenManager;
  it("maps the page", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 1 }], page: 2, page_size: 25, total: 60, total_pages: 3 })));
    const res = await new T3kClient(tokens, fetchFn).search(base, 2);
    expect(res).toEqual({ tones: [{ id: 1 }], page: 2, totalPages: 3, total: 60 });
  });
  it("turns 403 into unsupported, not a sign-in problem", async () => {
    const c = new T3kClient(tokens, async () => new Response("", { status: 403 }));
    await expect(c.search(base, 1)).rejects.toMatchObject({ code: "unsupported" });
    await expect(c.search(base, 1)).rejects.toBeInstanceOf(HostError);
  });
  it("keeps 429 as a network error", async () => {
    const c = new T3kClient(tokens, async () => new Response("", { status: 429, headers: { "retry-after": "30" } }));
    await expect(c.search(base, 1)).rejects.toMatchObject({ code: "network", message: expect.stringContaining("30 s") });
  });
});
