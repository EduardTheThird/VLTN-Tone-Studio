/** Tracks a v1 library stored as raw float32 files, one per channel. They have no `file`; the store converts them to FLAC in the background. */
export interface LibraryAudio {
  name: string;
  sampleRate: number;
  frames: number;
  channels: number;
  /** v2: the single file holding every channel, e.g. `vocals.flac`. */
  file?: string;
  codec?: "flac";
  /** v2: size of `file` in bytes. */
  bytes?: number;
  /** v2: SHA-256 of `file`, lowercase hex. */
  sha256?: string;
}
export interface LibrarySong {
  id: string;
  title: string;
  artist: string;
  sourceName: string;
  duration: number;
  audio: LibraryAudio[];
  settings: Record<string, string>;
  updated: string;
}
export interface Playlist {
  id: string;
  name: string;
  songs: string[];
}
export interface SongLibrary {
  /** 2 once any song has been saved or converted by this version; a v1 index is still read. */
  version: 1 | 2;
  songs: LibrarySong[];
  playlists: Playlist[];
}
export interface LibraryTransferProgress {
  phase: string;
  completed: number;
  total: number;
}
export interface LibraryTransferResult {
  songs: number;
  playlists: number;
  fileName: string;
}
export interface LibraryPreflightSong {
  id: string;
  song?: LibrarySong;
  errors: string[];
}
export interface SongLibraryApi {
  preflight(ids: string[]): Promise<LibraryPreflightSong[]>;
  exportBackup(): Promise<LibraryTransferResult | null>;
  restoreBackup(): Promise<LibraryTransferResult | null>;
  onTransferProgress(callback: (progress: LibraryTransferProgress) => void): () => void;
  index(): Promise<SongLibrary>;
  save(song: LibrarySong, assets: { name: string; bytes: Uint8Array }[]): Promise<void>;
  /** `app://library/...` URLs of the song's files, keyed by track name. The renderer fetches them directly. */
  audioUrls(id: string): Promise<Record<string, string>>;
  playlists(playlists: Playlist[]): Promise<void>;
  remove(id: string): Promise<void>;
  settings(id: string, values: Record<string, string>): Promise<void>;
}
export const emptyLibrary = (): SongLibrary => ({ version: 2, songs: [], playlists: [] });
export const validId = (id: string): boolean => /^[a-f0-9-]{36}$/.test(id);
export const TRACK_NAMES = ["source", "drums", "bass", "other", "vocals", "guitar", "piano"];
export const assetName = (name: string, channel: number): string => `${name}-${channel}.f32`;
export const flacName = (name: string): string => `${name}.flac`;
export const isFlacTrack = (track: LibraryAudio): boolean => track.codec === "flac";
/** The files that make up one track and the size each must have. */
export function trackFiles(track: LibraryAudio): { file: string; bytes: number; sha256?: string }[] {
  if (isFlacTrack(track)) return [{ file: track.file!, bytes: track.bytes!, sha256: track.sha256 }];
  return Array.from({ length: track.channels }, (_, c) => ({ file: assetName(track.name, c), bytes: track.frames * 4 }));
}
/** Whether a song still has raw float32 tracks waiting to be converted. */
export const isLegacySong = (song: LibrarySong): boolean => song.audio.some((a) => !isFlacTrack(a));
export function validateSong(song: LibrarySong): void {
  if (!validId(song.id) || !song.title.trim() || song.title.length > 300 || !Number.isFinite(song.duration) || song.duration <= 0)
    throw new Error("Invalid saved song.");
  if (!song.audio.length || song.audio[0].name !== "source" || song.audio.length > 7 || new Set(song.audio.map((a) => a.name)).size !== song.audio.length)
    throw new Error("Invalid song tracks.");
  for (const a of song.audio) {
    if (
      !TRACK_NAMES.includes(a.name) ||
      !Number.isInteger(a.channels) ||
      a.channels < 1 ||
      a.channels > 2 ||
      !Number.isInteger(a.frames) ||
      a.frames < 1 ||
      !Number.isFinite(a.sampleRate) ||
      a.sampleRate < 8000 ||
      a.sampleRate > 192000
    )
      throw new Error("Invalid song audio.");
    if (a.codec !== undefined || a.file !== undefined || a.bytes !== undefined || a.sha256 !== undefined) {
      if (a.codec !== "flac" || a.file !== flacName(a.name) || !Number.isSafeInteger(a.bytes) || a.bytes! < 1 || !/^[a-f0-9]{64}$/.test(a.sha256 ?? ""))
        throw new Error("Invalid song audio file.");
    }
  }
  if (Object.entries(song.settings).some(([k, v]) => !["", ":bpm", ":lyrics", ":options"].includes(k) || typeof v !== "string"))
    throw new Error("Invalid song settings.");
}
export function validatePlaylists(playlists: Playlist[], songs: LibrarySong[]): void {
  const ids = new Set(songs.map((s) => s.id));
  if (
    new Set(playlists.map((p) => p.id)).size !== playlists.length ||
    playlists.some((p) => !validId(p.id) || !p.name.trim() || p.name.length > 300 || p.songs.some((id) => !ids.has(id)))
  )
    throw new Error("Playlist contains an invalid or missing song.");
}
