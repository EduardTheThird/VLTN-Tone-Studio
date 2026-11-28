import type { Rc10rPatternInfo } from "../rc10r-bank";
import type { Rc10rMemorySummary } from "../rc10r-memory-map";
import type { Rc10rSystemSettings } from "../rc10r-system";

/** What one storage session read from the pedal besides the rhythm bank (specs 174, 177, 179). Read-only. */
export interface Rc10rPedalReading {
  system?: Rc10rSystemSettings;
  systemProblem?: string;
  memories?: Rc10rMemorySummary[];
  memoryProblem?: string;
  /** Total size of the pedal's ROLAND folder, and of its looper audio, in bytes. */
  storageBytes: number;
  loopBytes: number;
  /** Bytes the next backup copies (settings plus loops changed since the last backup). */
  backupCopyBytes: number;
}
/** One looper track file in the newest pedal backup (spec 178). */
export interface Rc10rLoopFile {
  memory: number;
  track: 1 | 2;
  /** Path inside the backup, for loopAudio. */
  path: string;
  bytes: number;
}
export interface Rc10rLoopLibrary {
  backup?: { id: string; date: string };
  loops: Rc10rLoopFile[];
}
export interface Rc10rBackupSummary {
  count: number;
  /** Disk space the backups take; hard-linked loops count once. */
  bytes: number;
  /** Backups "Remove older backups" would delete. */
  removable: number;
}

export interface Rc10rStorageView {
  id: string;
  patterns: Rc10rPatternInfo[];
  backupPath?: string;
  problem?: string;
  recoveries: { id: string; date: string; state: string }[];
  reading?: Rc10rPedalReading;
}
export interface Rc10rWritePlan {
  slot: number;
  memory: number | null;
  name: string;
  previous: string | null;
  backupPath: string;
}
/** Desktop storage calls use opaque leases. The renderer never supplies a filesystem path. */
export interface Rc10rApi {
  reserve(): Promise<string>;
  inspect(id: string): Promise<Rc10rStorageView>;
  plan(id: string, record: Uint8Array, slot: number, memory: number | null): Promise<Rc10rWritePlan>;
  write(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  recover(id: string, backupId: string): Promise<void>;
  eject(id: string): Promise<void>;
  release(id: string): Promise<void>;
  /** Loops in the newest complete backup. No pedal connection is needed. */
  loops(): Promise<Rc10rLoopLibrary>;
  /** One loop's WAV bytes from a backup listed by loops(). */
  loopAudio(backupId: string, path: string): Promise<Uint8Array>;
  backups(): Promise<Rc10rBackupSummary>;
  /** Keeps the five newest backups and any from an interrupted write. */
  pruneBackups(): Promise<Rc10rBackupSummary>;
}
