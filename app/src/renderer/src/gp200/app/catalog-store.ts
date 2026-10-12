// The GP-200 effect catalog in the renderer: the built-in one (gp200/lib/catalog-data.mjs, from gp200-studio), or the
// user's algorithm.xml when they imported it (built here with gp200/lib/catalog.mjs, kept by the host:
// shared/host/gp200-catalog.ts). An imported list adds what the built-in one lacks: units, menu wire values (TrueID),
// MinISOff and Auto CAB Match. Screens read it with useGp200Catalog(selector); load() picks up a kept import.
import { create } from "zustand";
import { buildCatalogFromXml, type Gp200Catalog } from "@/gp200/lib/catalog.mjs";
import { BUILT_IN_CATALOG } from "@/gp200/lib/catalog-data.mjs";
import type { StoredGp200Catalog } from "@shared/host/gp200-catalog";
import { host } from "@/host";

export interface Gp200CatalogCounts {
  /** Distinct models (fxids) */
  uniqueModels: number;
  /** Knobs, switches and menus */
  controls: number;
  /** Models per block code */
  perBlock: Readonly<Record<string, number>>;
}

interface Gp200CatalogState {
  /** Reading or importing a list; `catalog` stays usable meanwhile */
  loading: boolean;
  catalog: Gp200Catalog;
  /** Where the imported algorithm.xml came from (path, or file name in the browser); null = the built-in list */
  source: string | null;
  /** ISO time of the import; null = the built-in list */
  savedAt: string | null;
  counts: Gp200CatalogCounts;
  /** Plain-language reason the last action failed or found nothing; the catalog in use stays usable */
  error: string | null;
  /** load() ran (successfully or not) */
  loaded: boolean;
  /** Read the kept import, if any. */
  load(): Promise<void>;
  /** Import from the GP-200 editor's install folder. False when no editor was found. */
  findAutomatically(): Promise<boolean>;
  /** Import from a file the user picks. False when the picker was cancelled. */
  chooseFile(): Promise<boolean>;
  /** Build the catalog from algorithm.xml text and keep it (replaces the list in use). */
  importXml(text: string, source: string): Promise<void>;
  /** Forget the import and go back to the built-in list. */
  remove(): Promise<void>;
}

export const NOT_FOUND =
  "Tone Studio couldn't find the GP-200 editor on this computer. Install Valeton's GP-200 editor, or choose its algorithm.xml yourself.";

function countsOf(catalog: Gp200Catalog): Gp200CatalogCounts {
  const { uniqueCodes, controls, perModule } = catalog.meta.counts;
  return { uniqueModels: uniqueCodes, controls, perBlock: { ...perModule } };
}

const BUILT_IN = { catalog: BUILT_IN_CATALOG, source: null, savedAt: null, counts: countsOf(BUILT_IN_CATALOG) } as const;

function importedState(kept: StoredGp200Catalog) {
  // the host checked the shape (isCatalogShape) when it read the file
  const catalog = kept.catalog as Gp200Catalog;
  return { catalog, source: kept.source, savedAt: kept.savedAt, counts: countsOf(catalog), error: null };
}

export const useGp200Catalog = create<Gp200CatalogState>((set, get) => {
  /** Run a catalog action with `loading` set; on failure the list in use stays and `error` says why. */
  const run = async <T>(action: () => Promise<T>): Promise<T> => {
    set({ loading: true, error: null });
    try {
      return await action();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      set({ loading: false });
    }
  };

  /** File text → kept catalog → state; null = nothing to import (`nothing` says why, when it's worth saying). */
  const importFile = async (file: { path: string; text: string } | null, nothing: string | null): Promise<boolean> => {
    if (!file) {
      set({ error: nothing });
      return false;
    }
    await get().importXml(file.text, file.path);
    return true;
  };

  return {
    ...BUILT_IN,
    loading: false,
    error: null,
    loaded: false,
    /** Never rejects: a failure keeps the built-in list, with the reason in `error` (shown by the catalog panel). */
    async load() {
      await run(async () => {
        const kept = await host.gp200Catalog.load();
        set(kept ? importedState(kept) : { ...BUILT_IN, error: null });
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
        set(importedState(await host.gp200Catalog.save(catalog, source)));
      });
    },
    async remove() {
      await run(() => host.gp200Catalog.remove());
      set({ ...BUILT_IN, error: null });
    },
  };
});
