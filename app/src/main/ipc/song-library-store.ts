import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { exportBackup, readBackup, readBackupIndex } from "./song-library-backup";
import { decodeFlac, encodeFlac, quantize } from "@shared/flac";
import {
  assetName,
  emptyLibrary,
  flacName,
  isFlacTrack,
  isLegacySong,
  trackFiles,
  validId,
  validatePlaylists,
  TRACK_NAMES,
  validateSong,
  type LibrarySong,
  type Playlist,
  type SongLibrary,
  type LibraryTransferProgress,
  type LibraryBackupPreview,
  type RestoreMode,
} from "@shared/song-library";

export type DiskIndex = SongLibrary & { revisions: Record<string, string> };
/** A save session or staging folder older than this is abandoned: the renderer crashed or the user gave up. */
export const ORPHAN_AGE_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
/** Songs with the same source audio are the same song. Older saves and raw-float songs carry no digest and never match. */
export const contentHash = (song: LibrarySong): string | undefined => song.audio.find((a) => a.name === "source")?.sha256;
/** Audio is staged before publishing a new index. An interrupted save leaves the previous song intact. */
export class SongLibraryStore {
  private pending = new Map<string, { song: LibrarySong; created: number }>();
  /** Folders being written by a conversion, which runs outside `serial()`. The sweep must not take them. */
  private converting = new Set<string>();
  private tail: Promise<unknown> = Promise.resolve();
  private sweeper: ReturnType<typeof setInterval> | undefined;
  constructor(
    private root: string,
    private now: () => number = Date.now,
  ) {}
  /** Sweeps now and then every 10 minutes. */
  startSweeping(): void {
    const sweep = () => void this.sweep().catch((e) => console.error("Song library sweep failed", e));
    sweep();
    this.sweeper = setInterval(sweep, SWEEP_INTERVAL_MS);
    this.sweeper.unref?.();
  }
  stopSweeping(): void {
    clearInterval(this.sweeper);
  }
  /**
   * Drops save sessions older than an hour and deletes folders in the library root that no revision refers to. Runs inside `serial()`, so no
   * commit or restore is publishing while it looks, and only deletes what is also older than an hour, so a fresh save is never touched.
   */
  async sweep(): Promise<void> {
    return this.serial(async () => {
      const cutoff = this.now() - ORPHAN_AGE_MS;
      for (const [token, { created }] of this.pending) {
        if (created > cutoff) continue;
        this.pending.delete(token);
        await rm(join(this.root, token), { recursive: true, force: true }).catch(() => {});
      }
      let index: DiskIndex, names: string[];
      try {
        index = await this.read();
        names = await readdir(this.root);
      } catch {
        return;
      }
      const live = new Set(Object.values(index.revisions));
      for (const name of names) {
        const folder = validId(name) || name.startsWith(".restore-"),
          temp = name.startsWith("index-") && name.endsWith(".tmp");
        if ((!folder && !temp) || live.has(name) || this.pending.has(name) || this.converting.has(name)) continue;
        const info = await stat(join(this.root, name)).catch(() => null);
        if (info && info.mtimeMs <= cutoff) await rm(join(this.root, name), { recursive: true, force: true }).catch(() => {});
      }
    });
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.tail.then(fn, fn);
    this.tail = job.catch(() => {});
    return job;
  }
  private async read(): Promise<DiskIndex> {
    try {
      const index = JSON.parse(await readFile(join(this.root, "library.json"), "utf8")) as DiskIndex;
      if ((index.version !== 1 && index.version !== 2) || !index.revisions) throw new Error("Unsupported song library.");
      return index;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { ...emptyLibrary(), revisions: {} };
      throw e;
    }
  }
  private async publish(index: DiskIndex): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const temp = join(this.root, `index-${randomUUID()}.tmp`);
    // Saving or converting a song makes this a v2 library; an older app refuses to open it instead of misreading the FLAC files.
    await writeFile(temp, JSON.stringify({ ...index, version: 2 }));
    await rename(temp, join(this.root, "library.json"));
  }
  async preflight(ids: string[]): Promise<import("@shared/song-library").LibraryPreflightSong[]> {
    if (!Array.isArray(ids) || ids.length > 10000 || ids.some((id) => typeof id !== "string" || !validId(id))) throw new Error("Invalid playlist song IDs.");
    return this.serial(async () => {
      const index = await this.read();
      const results: import("@shared/song-library").LibraryPreflightSong[] = [];
      for (const id of new Set(ids)) {
        const song = index.songs.find((s) => s.id === id),
          errors: string[] = [];
        if (!song) {
          results.push({ id, errors: ["Song is missing from the library."] });
          continue;
        }
        try {
          validateSong(song);
        } catch {
          results.push({ id, errors: ["Saved song metadata is invalid."] });
          continue;
        }
        const revision = index.revisions[id];
        if (!revision || !validId(revision)) errors.push("Saved audio revision is missing.");
        else
          for (const track of song.audio)
            for (const { file, bytes } of trackFiles(track)) {
              try {
                const info = await stat(join(this.root, revision, file));
                if (!info.isFile() || info.size !== bytes) errors.push(`${file}: audio file has an invalid size or type.`);
              } catch {
                errors.push(`${file}: audio file is missing or inaccessible.`);
              }
            }
        results.push({ id, song, errors });
      }
      return results;
    });
  }
  async index(): Promise<SongLibrary> {
    const { revisions: _, ...index } = await this.read();
    return index;
  }
  async begin(song: LibrarySong): Promise<string> {
    validateSong(song);
    if (!song.audio.every(isFlacTrack)) throw new Error("Songs are saved as FLAC.");
    const token = randomUUID();
    await mkdir(join(this.root, token), { recursive: true });
    this.pending.set(token, { song, created: this.now() });
    return token;
  }
  async write(token: string, name: string, bytes: Uint8Array): Promise<void> {
    const song = this.pending.get(token)?.song;
    const track = song?.audio.find((a) => a.file === name);
    if (!track || bytes.byteLength !== track.bytes || createHash("sha256").update(bytes).digest("hex") !== track.sha256)
      throw new Error("Invalid song audio asset.");
    await writeFile(join(this.root, token, name), bytes);
  }
  async commit(token: string): Promise<void> {
    return this.serial(async () => {
      const song = this.pending.get(token)?.song;
      if (!song) throw new Error("Save session expired.");
      for (const a of song.audio) {
        if ((await stat(join(this.root, token, a.file!))).size !== a.bytes) throw new Error("Incomplete song save.");
      }
      const index = await this.read();
      const old = index.revisions[song.id];
      index.songs = [...index.songs.filter((s) => s.id !== song.id), song];
      index.revisions[song.id] = token;
      await this.publish(index);
      this.pending.delete(token);
      if (old && validId(old)) await rm(join(this.root, old), { recursive: true, force: true }).catch(() => {});
    });
  }
  async abort(token: string): Promise<void> {
    if (!this.pending.delete(token) || !validId(token)) return;
    await rm(join(this.root, token), { recursive: true, force: true });
  }
  /** The renderer fetches these straight from the `app` protocol, so audio never travels over IPC. */
  async audioUrls(id: string): Promise<Record<string, string>> {
    return this.serial(async () => {
      const index = await this.read(),
        song = index.songs.find((s) => s.id === id),
        rev = index.revisions[id];
      if (!song || !rev || !validId(rev)) throw new Error("Song audio not found.");
      if (isLegacySong(song)) throw new Error("This song is still being converted to the compact library format. Try again in a moment.");
      return Object.fromEntries(song.audio.map((a) => [a.name, `app://library/${rev}/${a.file}`]));
    });
  }
  async playlists(playlists: Playlist[]): Promise<void> {
    return this.serial(async () => {
      const index = await this.read();
      validatePlaylists(playlists, index.songs);
      index.playlists = playlists;
      await this.publish(index);
    });
  }
  /** Merges the changed entries into the song's settings. An empty value removes the entry. */
  async updateSettings(id: string, patch: Record<string, string>): Promise<void> {
    if (!validId(id) || !patch || typeof patch !== "object" || Object.values(patch).some((v) => typeof v !== "string"))
      throw new Error("Invalid song settings.");
    return this.serial(async () => {
      const index = await this.read(),
        song = index.songs.find((s) => s.id === id);
      if (!song) throw new Error("Saved song not found.");
      const merged = Object.fromEntries(Object.entries({ ...song.settings, ...patch }).filter(([, value]) => value));
      const updated = { ...song, settings: merged, updated: new Date().toISOString() };
      validateSong(updated);
      index.songs = index.songs.map((s) => (s.id === id ? updated : s));
      await this.publish(index);
    });
  }
  async exportBackup(path: string, progress?: (p: LibraryTransferProgress) => void): Promise<{ songs: number; playlists: number }> {
    return this.serial(async () => {
      const index = await this.read();
      // Materialize the empty index too, so even an empty backup has a complete format.
      await this.publish(index);
      await exportBackup(this.root, index, path, progress);
      return { songs: index.songs.length, playlists: index.playlists.length };
    });
  }
  /** Reads just the library index of a backup, so the user can choose how to restore before any audio is extracted. */
  async inspectBackup(path: string): Promise<Omit<LibraryBackupPreview, "fileName">> {
    const backup = await readBackupIndex(path),
      known = new Set((await this.serial(() => this.read())).songs.map(contentHash).filter(Boolean));
    const duplicates = backup.songs.filter((song) => known.has(contentHash(song))).length;
    return { songs: backup.songs.length, playlists: backup.playlists.length, duplicates };
  }
  /**
   * "copy" gives every song and playlist in the backup a new ID. "skip" leaves out songs whose source audio is already in the library, points
   * playlist entries at the existing songs, and leaves out playlists that already exist with the same name and songs.
   */
  async restoreBackup(
    path: string,
    progress?: (p: LibraryTransferProgress) => void,
    mode: RestoreMode = "copy",
  ): Promise<{ songs: number; playlists: number; skipped?: number }> {
    return this.serial(async () => {
      const stage = join(this.root, ".restore-" + randomUUID()),
        moved: string[] = [];
      try {
        const backup = await readBackup(path, stage, progress),
          current = await this.read();
        const existing = new Map<string, string>();
        if (mode === "skip") for (const song of current.songs) if (contentHash(song)) existing.set(contentHash(song)!, song.id);
        const ids = new Map<string, string>(),
          fresh: LibrarySong[] = [];
        for (const song of backup.songs) {
          const same = existing.get(contentHash(song) ?? "");
          if (same) ids.set(song.id, same);
          else {
            ids.set(song.id, randomUUID());
            fresh.push(song);
          }
        }
        const revisions: Record<string, string> = { ...current.revisions };
        for (const song of fresh) {
          const revision = randomUUID(),
            target = join(this.root, revision);
          await rename(join(stage, backup.revisions[song.id]), target);
          moved.push(target);
          revisions[ids.get(song.id)!] = revision;
        }
        const songs = fresh.map((song) => ({ ...song, id: ids.get(song.id)! }));
        let playlists = backup.playlists.map((playlist) => ({ ...playlist, id: randomUUID(), songs: playlist.songs.map((id) => ids.get(id)!) }));
        if (mode === "skip") {
          const key = (p: Playlist) => JSON.stringify([p.name, p.songs]);
          const have = new Set(current.playlists.map(key));
          playlists = playlists.filter((p) => !have.has(key(p)));
        }
        await this.publish({ version: 2, songs: [...current.songs, ...songs], playlists: [...current.playlists, ...playlists], revisions });
        moved.length = 0;
        const result = { songs: songs.length, playlists: playlists.length };
        return mode === "skip" ? { ...result, skipped: backup.songs.length - songs.length } : result;
      } finally {
        await rm(stage, { recursive: true, force: true }).catch(() => {});
        for (const path of moved) await rm(path, { recursive: true, force: true }).catch(() => {});
      }
    });
  }
  /**
   * Converts v1 songs (raw float32 per channel) to FLAC, one song at a time. The v1 revision stays on disk until the FLAC revision has been
   * decoded back and compared sample for sample, so an interruption or a failure leaves the song playable. Running it again resumes.
   */
  async migrate(progress: (p: LibraryTransferProgress) => void = () => {}): Promise<{ converted: number; failed: number }> {
    const todo = (await this.serial(() => this.read())).songs.filter(isLegacySong).map((s) => s.id);
    let converted = 0,
      failed = 0;
    for (const id of todo) {
      progress({ phase: "Converting saved songs", completed: converted + failed, total: todo.length });
      try {
        if (await this.migrateSong(id)) converted++;
      } catch {
        failed++;
      }
    }
    if (todo.length) progress({ phase: "Conversion complete", completed: todo.length, total: todo.length });
    return { converted, failed };
  }
  private async migrateSong(id: string): Promise<boolean> {
    const { song, revision } = await this.serial(async () => {
      const index = await this.read(),
        found = index.songs.find((s) => s.id === id);
      return { song: found, revision: index.revisions[id] };
    });
    if (!song || !isLegacySong(song) || !validId(revision ?? "")) return false;
    const target = randomUUID(),
      audio: LibrarySong["audio"] = [];
    await mkdir(join(this.root, target), { recursive: true });
    this.converting.add(target);
    try {
      for (const track of song.audio) {
        if (isFlacTrack(track)) {
          audio.push(track);
          continue;
        }
        const channels: Float32Array[] = [];
        for (let c = 0; c < track.channels; c++) {
          const raw = await readFile(join(this.root, revision, assetName(track.name, c)));
          if (raw.byteLength !== track.frames * 4) throw new Error("Damaged saved audio.");
          channels.push(new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
        }
        const bytes = await encodeFlac({ sampleRate: track.sampleRate, channels });
        const check = await decodeFlac(bytes);
        const same =
          check.channels.length === channels.length &&
          check.channels.every((ch, c) => ch.length === track.frames && ch.every((v, i) => Math.round(v * (2 ** 23 - 1)) === quantize(channels[c][i])));
        if (!same || check.sampleRate !== track.sampleRate) throw new Error("Converted audio did not match the original.");
        await writeFile(join(this.root, target, flacName(track.name)), bytes);
        audio.push({ ...track, file: flacName(track.name), codec: "flac", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      }
      return await this.serial(async () => {
        const index = await this.read(),
          now = index.songs.find((s) => s.id === id);
        // The song may have been replaced or removed while it was being converted. Settings edits are kept; only the audio changes.
        if (!now || index.revisions[id] !== revision) throw new Error("Song changed during conversion.");
        index.songs = index.songs.map((s) => (s.id === id ? { ...now, audio } : s));
        index.revisions[id] = target;
        await this.publish(index);
        await rm(join(this.root, revision), { recursive: true, force: true }).catch(() => {});
        return true;
      });
    } catch (e) {
      await rm(join(this.root, target), { recursive: true, force: true }).catch(() => {});
      throw e;
    } finally {
      this.converting.delete(target);
    }
  }
  async remove(id: string): Promise<void> {
    return this.serial(async () => {
      const index = await this.read(),
        rev = index.revisions[id];
      index.songs = index.songs.filter((s) => s.id !== id);
      index.playlists.forEach((p) => {
        p.songs = p.songs.filter((s) => s !== id);
      });
      delete index.revisions[id];
      await this.publish(index);
      if (rev && validId(rev)) await rm(join(this.root, rev), { recursive: true, force: true }).catch(() => {});
    });
  }
}

const FILE_NAME = new RegExp(`^(${TRACK_NAMES.join("|")})\\.flac$`);
/** Maps `app://library/<revision>/<track>.flac` to a path inside the library root, or null for anything else. */
export function libraryFilePath(root: string, url: string): string | null {
  const parsed = new URL(url),
    [, revision, file, ...rest] = decodeURIComponent(parsed.pathname).split("/");
  if (parsed.host !== "library" || rest.length || !validId(revision ?? "") || !FILE_NAME.test(file ?? "")) return null;
  return join(root, revision, file);
}
