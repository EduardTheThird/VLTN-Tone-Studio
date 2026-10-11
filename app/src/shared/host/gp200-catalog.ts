// GP-200 effect catalog: the model names and param ranges come from Valeton's GP-200 editor (its `algorithm.xml`),
// which Tone Studio may not redistribute. The user's own copy is read (found in the editor's install or picked), the
// renderer builds the catalog from it (gp200/lib/catalog.mjs) and the host keeps the result in the app's user-data
// folder (browser build: this browser's storage). Nothing leaves the computer.
// Owner: renderer/src/gp200/app/catalog-store.ts. Main process: src/main/ipc/gp200-catalog.ts.
import { HostError } from "../ipc";

/** The editor's file, as read. */
export interface Gp200XmlFile {
  /** Full path (desktop) or file name (browser) */
  path: string;
  text: string;
}

/** The kept catalog. `catalog` is the gp200/lib catalog object (the host checks it with isCatalogShape). */
export interface StoredGp200Catalog {
  catalog: unknown;
  /** Where the algorithm.xml came from (path or file name) */
  source: string;
  /** ISO time of the import */
  savedAt: string;
}

export interface Gp200CatalogApi {
  /** The kept catalog, or null when none was imported yet. Throws HostError("invalid") when the kept copy is damaged. */
  load(): Promise<StoredGp200Catalog | null>;
  /** algorithm.xml from an installed GP-200 editor (usual install folders), or null when none is found. */
  findXml(): Promise<Gp200XmlFile | null>;
  /** Let the user pick algorithm.xml. Null when the picker is cancelled. */
  chooseXml(): Promise<Gp200XmlFile | null>;
  /** Keep `catalog` (replaces the previous one). Throws HostError("invalid") when it isn't a catalog. */
  save(catalog: unknown, source: string): Promise<StoredGp200Catalog>;
  /** Forget the kept catalog (no-op when there is none). */
  remove(): Promise<void>;
}

export const ALGORITHM_XML = "algorithm.xml";
/** Valeton's file is about 210 KB; anything far bigger is not it. */
export const MAX_XML_BYTES = 8 * 1024 * 1024;
/** The built catalog is about 190 KB of JSON. */
export const MAX_CATALOG_BYTES = 16 * 1024 * 1024;

/** Where the editor keeps the file, per platform (shown to the user). */
export const XML_IN_EDITOR = {
  win32: "Resource\\GP-200\\File\\algorithm.xml, in the GP-200 editor's install folder",
  darwin: "/Library/Application Support/Valeton/GP-200/File/algorithm.xml",
  linux: "Resource/GP-200/File/algorithm.xml, in the GP-200 editor's install folder (for example inside a Wine prefix)",
} as const;

/**
 * Text of an XML file: UTF-8 (with or without BOM) or UTF-16 (LE/BE, with or without BOM). Throws a plain Error
 * when the bytes are too big or are no XML text.
 */
export function decodeXmlText(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_XML_BYTES) throw new Error(`This file is too big to be the GP-200 editor's ${ALGORITHM_XML}.`);
  const [b0, b1] = bytes;
  let encoding = "utf-8";
  if (b0 === 0xff && b1 === 0xfe) encoding = "utf-16le";
  else if (b0 === 0xfe && b1 === 0xff) encoding = "utf-16be";
  else if (b0 === 0x3c && b1 === 0x00) encoding = "utf-16le";
  else if (b0 === 0x00 && b1 === 0x3c) encoding = "utf-16be";
  // TextDecoder drops a matching BOM
  const text = new TextDecoder(encoding).decode(bytes);
  if (!text.trimStart().startsWith("<")) throw new Error(`This isn't an XML file. Choose the GP-200 editor's ${ALGORITHM_XML}.`);
  return text;
}

/** One model: a name, a numeric fxid and controls with a param id. */
function isModelShape(a: unknown): boolean {
  if (typeof a !== "object" || a === null || !("name" in a) || !("code" in a) || !("knobs" in a)) return false;
  return typeof a.name === "string" && Number.isInteger(a.code) && Array.isArray(a.knobs) && a.knobs.every((k: unknown) => typeof k === "object" && k !== null && "id" in k && Number.isInteger(k.id));
}

/** Whether `v` has the shape of a gp200/lib catalog: meta with counts, modules of models (isModelShape). */
export function isCatalogShape(v: unknown): boolean {
  if (typeof v !== "object" || v === null || !("meta" in v) || !("modules" in v)) return false;
  const { meta, modules } = v;
  if (typeof meta !== "object" || meta === null || !("counts" in meta) || !Array.isArray(modules) || modules.length === 0) return false;
  return modules.every((m: unknown) => typeof m === "object" && m !== null && "module" in m && typeof m.module === "string" && "algs" in m && Array.isArray(m.algs) && m.algs.every(isModelShape));
}

const DAMAGED = `The saved GP-200 effect list is damaged. Import ${ALGORITHM_XML} again.`;

/** Text of the kept file → the kept catalog. Throws HostError("invalid") when it is damaged. */
export function parseStoredCatalog(text: string): StoredGp200Catalog {
  let kept: unknown;
  try {
    kept = JSON.parse(text);
  } catch {
    throw new HostError("invalid", DAMAGED);
  }
  if (typeof kept !== "object" || kept === null || !("catalog" in kept) || !("source" in kept) || !("savedAt" in kept)) throw new HostError("invalid", DAMAGED);
  const { catalog, source, savedAt } = kept;
  if (!isCatalogShape(catalog) || typeof source !== "string" || typeof savedAt !== "string") throw new HostError("invalid", DAMAGED);
  return { catalog, source, savedAt };
}

/** The kept catalog and its file text. Throws HostError("invalid") when `catalog` is no catalog or too big. */
export function storedCatalogFile(catalog: unknown, source: string, now: Date): { kept: StoredGp200Catalog; text: string } {
  if (!isCatalogShape(catalog) || typeof source !== "string") throw new HostError("invalid", "This isn't a GP-200 effect list.");
  const kept: StoredGp200Catalog = { catalog, source, savedAt: now.toISOString() };
  const text = JSON.stringify({ format: 1, ...kept });
  if (text.length > MAX_CATALOG_BYTES) throw new HostError("invalid", "This GP-200 effect list is too big.");
  return { kept, text };
}
