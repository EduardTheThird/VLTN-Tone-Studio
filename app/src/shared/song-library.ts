/** Where a saved track came from. Legacy entries carry none: the source track is `source` and every other one a `stem`. */
export const TRACK_KINDS = ["source", "stem", "user"] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];
/** The buses a track can be sent to. They match the performance outputs (see song/audio/outputs.ts). */
export const TRACK_BUSES = ["main", "click", "aux1", "aux2"] as const;
/** Mute groups are numbered 1 to MUTE_GROUPS_MAX. Tracks in the same group are exclusive: unmuting one mutes the rest. */
export const MUTE_GROUPS_MAX = 6;
/** Imported tracks per song. The song's source track is one more entry in the audio list. */
export const USER_TRACKS_MAX = 32;

/** Tracks a v1 library stored as raw float32 files, one per channel. They have no `file`; the store converts them to FLAC in the background. */
export interface LibraryAudio {
  name: string;
  sampleRate: number;
  frames: number;
  channels: number;
  /** v2: the single file holding every channel, e.g. `vocals.flac`. v3 imported tracks use `track<n>.flac`. */
  file?: string;
  codec?: "flac";
  /** v2: size of `file` in bytes. */
  bytes?: number;
  /** v2: SHA-256 of `file`, lowercase hex. */
  sha256?: string;
  /** v3: where the track came from. Missing on older saves, which read as `source` or `stem` (see `withTrackKinds`). */
  kind?: TrackKind;
  /** v3: the colour shown in the mixer, as `#rrggbb` */
  color?: string;
  /** v3: the bus the track plays on. Missing means Main. */
  bus?: (typeof TRACK_BUSES)[number];
  /** v3: whether the track follows the song's pitch shift. Missing keeps the default for the track. */
  transpose?: boolean;
  /** v3: the track's starting volume, 0 to 2. Missing means 1. */
  gain?: number;
  /** v3: the track's starting pan, -1 (left) to 1 (right). Missing means centre. */
  pan?: number;
  /** v3: the mute groups the track belongs to, 1 to MUTE_GROUPS_MAX. */
  muteGroups?: number[];
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
  /** 3 once any song has been saved with per-track settings; v1 and v2 indexes are still read and upgraded in memory. */
  version: 1 | 2 | 3;
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
  /** Songs left out of a restore because their audio was already in the library. */
  skipped?: number;
}
/** What a backup holds, shown before the user chooses how to restore it. */
export interface LibraryBackupPreview {
  fileName: string;
  songs: number;
  playlists: number;
  /** Songs whose source audio is already in the library. */
  duplicates: number;
}
/** "skip" leaves out songs already in the library; "copy" imports everything as new songs. */
export type RestoreMode = "skip" | "copy";
export interface LibraryPreflightSong {
  id: string;
  song?: LibrarySong;
  errors: string[];
}
export interface SongLibraryApi {
  preflight(ids: string[]): Promise<LibraryPreflightSong[]>;
  exportBackup(): Promise<LibraryTransferResult | null>;
  /** Opens the file picker and reads the chosen backup's index. Null when cancelled. The path stays in the main process. */
  inspectBackup(): Promise<LibraryBackupPreview | null>;
  /** Restores the backup chosen by `inspectBackup`. */
  restoreBackup(mode: RestoreMode): Promise<LibraryTransferResult>;
  onTransferProgress(callback: (progress: LibraryTransferProgress) => void): () => void;
  index(): Promise<SongLibrary>;
  save(song: LibrarySong, assets: { name: string; bytes: Uint8Array }[]): Promise<void>;
  /** `app://library/...` URLs of the song's files, keyed by track name. The renderer fetches them directly. */
  audioUrls(id: string): Promise<Record<string, string>>;
  playlists(playlists: Playlist[]): Promise<void>;
  remove(id: string): Promise<void>;
  /** Merges the changed entries into a saved song's settings; an empty value removes one. */
  updateSettings(id: string, patch: Record<string, string>): Promise<void>;
}
export const emptyLibrary = (): SongLibrary => ({ version: 3, songs: [], playlists: [] });
export const validId = (id: string): boolean => /^[a-f0-9-]{36}$/.test(id);
export const TRACK_NAMES = ["source", "drums", "bass", "other", "vocals", "guitar", "piano"];
/** Imported tracks are stored under a fixed file name, so any track name is safe on disk. */
export const USER_TRACK_FILE = /^track(3[01]|[12]\d|\d)\.flac$/;
export const assetName = (name: string, channel: number): string => `${name}-${channel}.f32`;
export const flacName = (name: string): string => `${name}.flac`;
export const userFileName = (index: number): string => `track${index}.flac`;
export const isFlacTrack = (track: LibraryAudio): boolean => track.codec === "flac";
/** Whether a file name is one a saved song may hold: a legacy track, or an imported one. */
export const isTrackFileName = (file: string): boolean => USER_TRACK_FILE.test(file) || TRACK_NAMES.some((name) => file === flacName(name));

/**
 * The key a track is known by everywhere in the player: its mix, its bus, its pitch choice and its render. It is the file's name without
 * the extension, so a legacy stem keeps its name ("drums") and an imported track keeps its own ("track3"). Raw v1 tracks use their name.
 */
export const trackKey = (track: LibraryAudio): string => (track.file ?? track.name).replace(/\.flac$/, "");

/** The track's kind, reading a save from before v3 as the source or a stem. */
export const trackKindOf = (track: LibraryAudio): TrackKind => track.kind ?? (track.name === "source" ? "source" : "stem");

/** A v2 track brought up to the v3 model. Nothing that was saved changes: only the kind is written down. */
export function withTrackKind(track: LibraryAudio): LibraryAudio {
  return track.kind === undefined ? { ...track, kind: trackKindOf(track) } : track;
}

/** An index read from an older version, with every track in the v3 model. The version is written on the next publish. */
export function upgradeIndex<T extends SongLibrary>(index: T): T {
  if (index.version === 3) return index;
  return { ...index, version: 3, songs: index.songs.map((song) => ({ ...song, audio: song.audio.map(withTrackKind) })) };
}

/** The files that make up one track and the size each must have. */
export function trackFiles(track: LibraryAudio): { file: string; bytes: number; sha256?: string }[] {
  if (isFlacTrack(track)) return [{ file: track.file!, bytes: track.bytes!, sha256: track.sha256 }];
  return Array.from({ length: track.channels }, (_, c) => ({ file: assetName(track.name, c), bytes: track.frames * 4 }));
}
/** Whether a song still has raw float32 tracks waiting to be converted. */
export const isLegacySong = (song: LibrarySong): boolean => song.audio.some((a) => !isFlacTrack(a));

const TRACK_NAME = /^[^\u0000-\u001f\u007f]{1,60}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;

/** The optional per-track settings, checked. Nothing here can make a song unplayable: an odd value is refused, not guessed at. */
function validateTrackSettings(track: LibraryAudio): void {
  if (track.color !== undefined && !COLOUR.test(track.color)) throw new Error("Invalid track colour.");
  if (track.bus !== undefined && !(TRACK_BUSES as readonly string[]).includes(track.bus)) throw new Error("Invalid track bus.");
  if (track.transpose !== undefined && typeof track.transpose !== "boolean") throw new Error("Invalid track pitch setting.");
  if (track.gain !== undefined && (!Number.isFinite(track.gain) || track.gain < 0 || track.gain > 2)) throw new Error("Invalid track volume.");
  if (track.pan !== undefined && (!Number.isFinite(track.pan) || track.pan < -1 || track.pan > 1)) throw new Error("Invalid track pan.");
  const groups = track.muteGroups;
  if (
    groups !== undefined &&
    (!Array.isArray(groups) ||
      groups.length > MUTE_GROUPS_MAX ||
      new Set(groups).size !== groups.length ||
      groups.some((group) => !Number.isInteger(group) || group < 1 || group > MUTE_GROUPS_MAX))
  )
    throw new Error("Invalid track mute group.");
}

export function validateSong(song: LibrarySong): void {
  if (!validId(song.id) || !song.title.trim() || song.title.length > 300 || !Number.isFinite(song.duration) || song.duration <= 0)
    throw new Error("Invalid saved song.");
  if (!song.audio.length || song.audio[0].name !== "source" || song.audio.length > USER_TRACKS_MAX + 1)
    throw new Error("Invalid song tracks.");
  const keys = new Set(song.audio.map(trackKey));
  // Keys are file names, so they must be unique. Imported tracks may share a name, such as two "Click" tracks.
  if (keys.size !== song.audio.length) throw new Error("Invalid song tracks.");
  if (song.audio.filter((a) => trackKindOf(a) === "user").length > USER_TRACKS_MAX) throw new Error("Invalid song tracks.");
  for (const a of song.audio) {
    const kind = trackKindOf(a);
    const legacyName = TRACK_NAMES.includes(a.name);
    const userNamed = kind === "user" && TRACK_NAME.test(a.name);
    if (
      !(legacyName || userNamed) ||
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
      const fileOk = kind === "user" ? USER_TRACK_FILE.test(a.file ?? "") : a.file === flacName(a.name);
      if (a.codec !== "flac" || !fileOk || !Number.isSafeInteger(a.bytes) || a.bytes! < 1 || !/^[a-f0-9]{64}$/.test(a.sha256 ?? ""))
        throw new Error("Invalid song audio file.");
    } else if (kind === "user") throw new Error("Invalid song audio file.");
    validateTrackSettings(a);
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
