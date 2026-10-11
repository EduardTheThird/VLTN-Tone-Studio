// Pure naming rules for the library on disk (main) and in IndexedDB (browser build). Owner: Library.
import type { PedalModel } from "./host/device";

/** Display name of each model; also what the pedal names an empty slot (the toolkit's DEVICES[key].name/emptyName). */
export const PEDAL_NAMES: Readonly<Record<PedalModel, string>> = { gp5: "GP-5", gp50: "GP-50" };

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** A file/folder name that is safe on Windows, macOS and Linux. Keeps spaces and case. */
export function sanitizeFileName(name: string, fallback = "Preset"): string {
  let s = name.normalize("NFC").replace(ILLEGAL, "_").replace(/\s+/g, " ").trim();
  // Windows drops trailing dots and spaces; leading dots hide files on macOS/Linux.
  s = s.replace(/[. ]+$/, "").replace(/^\.+/, "");
  if (s.length > 64) s = s.slice(0, 64).trimEnd();
  if (!s) return fallback;
  if (RESERVED.test(s.split(".")[0])) s = `_${s}`;
  return s;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `NN-Name.prst`, the naming of `backupAll` and Valeton's own backup folders. A blank name becomes the empty-slot name. */
export function slotFileName(slot: number, name: string, device: PedalModel): string {
  return `${pad2(slot)}-${sanitizeFileName(name, PEDAL_NAMES[device])}.prst`;
}

/** Inverse of slotFileName: `07-Blues Man.prst` → { slot: 7, name: "Blues Man" }. */
export function parseSlotFileName(fileName: string): { slot: number; name: string } | null {
  const m = /^(\d{2})-(.*)\.prst$/i.exec(fileName);
  if (!m) return null;
  const slot = Number(m[1]);
  return slot <= 99 ? { slot, name: m[2] } : null;
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** `gp5-YYYY-MM-DD` (GP-50: `gp50-…`), then `…-2`, `…-3` … when a backup of that model and day exists. */
export function backupDirName(date: Date, existing: Iterable<string>, device: PedalModel): string {
  const taken = new Set(Array.from(existing, (x) => x.toLowerCase()));
  const base = `${device}-${isoDay(date)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Date (local midnight) and model of a backup folder, or null for folders the app did not name. */
export function parseBackupDirName(dir: string): { date: Date; device: PedalModel } | null {
  const m = /^(gp50?)-(\d{4})-(\d{2})-(\d{2})(?:-\d+)?$/.exec(dir);
  if (!m) return null;
  const d = new Date(Number(m[2]), Number(m[3]) - 1, Number(m[4]));
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[3]) - 1 ? null : { date: d, device: m[1] as PedalModel };
}

/** Model named in a .prst header (`GP-5\0…` / `GP-50…`), or null when the bytes don't start like a preset. */
export function prstModel(prst: Uint8Array): PedalModel | null {
  const isGp5Prefix = prst.length > 4 && prst[0] === 0x47 && prst[1] === 0x50 && prst[2] === 0x2d && prst[3] === 0x35;
  if (!isGp5Prefix) return null;
  if (prst[4] === 0) return "gp5";
  return prst[4] === 0x30 && prst[5] === 0 ? "gp50" : null;
}

/** The one model all `presets` belong to; null when there are none, one is not a preset, or they mix models. */
export function commonModel(presets: Iterable<Uint8Array>): PedalModel | null {
  let model: PedalModel | null = null;
  for (const p of presets) {
    const m = prstModel(p);
    if (!m || (model && m !== model)) return null;
    model = m;
  }
  return model;
}

/** `name.ext`, then `name (2).ext` … so imports never overwrite each other. Case-insensitive like Windows/macOS. */
export function uniqueFileName(fileName: string, existing: Iterable<string>): string {
  const taken = new Set(Array.from(existing, (x) => x.toLowerCase()));
  if (!taken.has(fileName.toLowerCase())) return fileName;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Fixed library folders; user collections never take these names. */
export const RESERVED_COLLECTION_DIRS = ["imported", "replaced"] as const;

/** Folder for a new user collection: sanitized title, unique, never a reserved folder. */
export function collectionDirName(title: string, existing: Iterable<string>): string {
  const base = sanitizeFileName(title, "Collection");
  const taken = [...existing, ...RESERVED_COLLECTION_DIRS];
  return uniqueFileName(base, taken);
}

export type CollectionRoot = "backups" | "library";

/** Validate a collection id (`backups/<dir>` or `library/<dir>`); rejects anything that could leave the root. */
export function parseCollectionId(id: string): { root: CollectionRoot; dir: string } | null {
  const m = /^(backups|library)\/([^/\\]+)$/.exec(id);
  if (!m) return null;
  const dir = m[2];
  if (dir === "." || dir === ".." || dir !== sanitizeFileName(dir, "")) return null;
  return { root: m[1] as CollectionRoot, dir };
}

/** A preset file name inside a collection: one path segment, .prst. */
export function isSafePresetFileName(fileName: string): boolean {
  return /\.prst$/i.test(fileName) && fileName === sanitizeFileName(fileName, "") && !fileName.includes("/");
}

/** Default file name for a preset added to a collection (`device`: the preset's model, for blank names). */
export function presetFileName(name: string, slot: number | null | undefined, device: PedalModel): string {
  return slot === null || slot === undefined ? `${sanitizeFileName(name)}.prst` : slotFileName(slot, name, device);
}

/** `.prst` files are 507 (GP-5) or 552 (GP-50) bytes; anything far larger is not a preset. */
export const MAX_PRST_BYTES = 4096;
