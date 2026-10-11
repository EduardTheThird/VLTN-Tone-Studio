// The GP-200 effect catalog in the renderer: built here from the user's algorithm.xml (gp200/lib/catalog.mjs has no
// Node APIs) and kept by the host (shared/host/gp200-catalog.ts). Screens read it with useGp200Catalog(selector);
// call load() once (startup, or when a GP-200 connects) before relying on it.
import { create } from "zustand";
import { buildCatalogFromXml, type Gp200Catalog } from "@/gp200/lib/catalog.mjs";
import type { StoredGp200Catalog } from "@shared/host/gp200-catalog";
import { host } from "@/host";

export type Gp200CatalogStatus = "none" | "loading" | "ready" | "error";

export interface Gp200CatalogCounts {
  /** Distinct models (fxids) */
  uniqueModels: number;
  /** Knobs, switches and menus */
  controls: number;
  /** Models per block code */
  perBlock: Readonly<Record<string, number>>;
}

interface Gp200CatalogState {
  /** none: no catalog yet; loading: reading or importing; ready: `catalog` is usable; error: none usable, see `error` */
  status: Gp200CatalogStatus;
  catalog: Gp200Catalog | null;
  /** Where the algorithm.xml came from (path, or file name in the browser) */
  source: string | null;
  /** ISO time of the import */
  savedAt: string | null;
  counts: Gp200CatalogCounts | null;
  /** Plain-language reason the last action failed or found nothing; a usable catalog may still be loaded */
  error: string | null;
  /** load() ran (successfully or not) */
  loaded: boolean;
  /** Read the kept catalog. */
  load(): Promise<void>;
  /** Import from the GP-200 editor's install folder. False when no editor was found. */
  findAutomatically(): Promise<boolean>;
  /** Import from a file the user picks. False when the picker was cancelled. */
  chooseFile(): Promise<boolean>;
  /** Build the catalog from algorithm.xml text and keep it (replaces the previous one). */
  importXml(text: string, source: string): Promise<void>;
  /** Forget the kept catalog. */
  remove(): Promise<void>;
}

export const NOT_FOUND =
  "Tone Studio couldn't find the GP-200 editor on this computer. Install Valeton's GP-200 editor, or choose its algorithm.xml yourself.";

function countsOf(catalog: Gp200Catalog): Gp200CatalogCounts {
  const { uniqueCodes, controls, perModule } = catalog.meta.counts;
  return { uniqueModels: uniqueCodes, controls, perBlock: { ...perModule } };
}

const EMPTY = { status: "none", catalog: null, source: null, savedAt: null, counts: null } as const;

function readyState(kept: StoredGp200Catalog) {
  // the host checked the shape (isCatalogShape) when it read the file
  const catalog = kept.catalog as Gp200Catalog;
  return { status: "ready" as const, catalog, source: kept.source, savedAt: kept.savedAt, counts: countsOf(catalog), error: null };
}

export const useGp200Catalog = create<Gp200CatalogState>((set, get) => {
  /** Run a catalog action: "loading" meanwhile; on failure the previous catalog stays usable and `error` says why. */
  const run = async <T>(action: () => Promise<T>): Promise<T> => {
    const before = get();
    set({ status: "loading", error: null });
    try {
      return await action();
    } catch (e) {
      set({ status: before.catalog ? "ready" : "error", error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };

  /** File text → kept catalog → state; null text = nothing to import (status back to what it was). */
  const importFile = async (file: { path: string; text: string } | null, nothing: string | null): Promise<boolean> => {
    if (!file) {
      set({ status: get().catalog ? "ready" : "none", error: nothing });
      return false;
    }
    await get().importXml(file.text, file.path);
    return true;
  };

  return {
    ...EMPTY,
    error: null,
    loaded: false,
    /** Never rejects: a failure leaves status "error" with the reason in `error` (shown by the catalog panel). */
    async load() {
      await run(async () => {
        const kept = await host.gp200Catalog.load();
        set(kept ? readyState(kept) : { ...EMPTY, error: null });
      }).catch(() => {});
      set({ loaded: true });
    },
    async findAutomatically() {
      return importFile(await run(() => host.gp200Catalog.findXml()), NOT_FOUND);
    },
    async chooseFile() {
      return importFile(await run(() => host.gp200Catalog.chooseXml()), null);
    },
    async importXml(text, source) {
      await run(async () => {
        const fileName = source.split(/[\\/]/).pop() || source;
        const catalog = buildCatalogFromXml(text, { device: "GP-200", source: fileName });
        set(readyState(await host.gp200Catalog.save(catalog, source)));
      });
    },
    async remove() {
      await run(() => host.gp200Catalog.remove());
      set({ ...EMPTY, error: null });
    },
  };
});
