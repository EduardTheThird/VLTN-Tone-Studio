import { create } from "zustand";
import { host } from "@/host";
import { useSong } from "./store";
import { useNav } from "@/state/nav";
import {
  emptyLibrary,
  flacName,
  trackKey,
  trackKindOf,
  type LibraryAudio,
  type LibraryBackupPreview,
  type LibrarySong,
  type Playlist,
  type RestoreMode,
  type SongLibrary,
} from "@shared/song-library";
import { decodeTrack, encodeTrack } from "./codec/flac-client";
import { migrateLyricsJob } from "./performance/lyrics-jobs";
import { playerShape, shapeFromOptions } from "./performance/song-shape";
import { sharedPlaybackEngine } from "./audio/playback-engine";
import { StemPlayer, yieldToMain } from "./stems/player";
import { RenderQueue, isPlainSpeed } from "./audio/render-queue";
import { speedFromOptions } from "./performance/speed";
import { flushSettings, forgetSettings, migrateLocalSettings, performanceKey, readSettings, seedSettings, writeSettings } from "./performance/settings";
import type { PcmAudio, SongSource, Stems } from "./types";
import { mergeTrackDefaults, savedSettingsOf, trackInfoOf, type TrackInfo } from "./tracks";
import { mixDown } from "./import/align";

/**
 * A playlist song loaded ahead of time: its audio, and a player whose buffers are already built on the shared engine. The library
 * owns the player until the session takes the song over; the session then owns it.
 */
export interface PreparedSong {
  id: string;
  title: string;
  source: SongSource;
  stems: Stems;
  settings: Record<string, string>;
  /** Each track that is not the source, by key: its mixer name and its saved settings */
  tracks: Record<string, TrackInfo>;
  /** Tracks that could not be read, by name. The song plays without them. */
  skipped: string[];
  player: StemPlayer;
}

interface LibraryState {
  index: SongLibrary;
  busy: boolean;
  error: string;
  notice: string;
  transfer: string;
  exportBackup(): Promise<void>;
  /** The backup waiting for the user to choose how to restore it, when some of its songs are already in the library. */
  backupPreview: LibraryBackupPreview | null;
  /** Picks a backup. Restores it at once when nothing in it is already saved; otherwise sets `backupPreview` for the dialog. */
  restoreBackup(): Promise<void>;
  /** Answers the dialog: restore with the chosen mode, or null to cancel. */
  finishRestore(mode: RestoreMode | null): Promise<void>;
  queue: string[];
  position: number;
  playlistPlaying: boolean;
  midiSession: { access: MIDIAccess | null; portId: string; inputId: string; armed: boolean; output: unknown } | null;
  playPlaylist(queue: string[], position?: number): Promise<void>;
  advancePlaylist(): Promise<void>;
  skipPlaylist(offset: number): Promise<void>;
  resumePlaylist(): void;
  pausePlaylist(): void;
  rememberMidi(session: LibraryState["midiSession"]): void;
  refresh(): Promise<void>;
  save(title: string, artist: string): Promise<void>;
  load(id: string, queue?: string[], position?: number): Promise<void>;
  playlists(value: Playlist[]): Promise<void>;
  remove(id: string): Promise<void>;
  /** Copies the saved track settings of the open song onto the saved songs that have the same imported tracks. */
  applyTrackSettings(): Promise<void>;
  /** The playlist's next song, loaded in the background. Null until it has loaded, or when there is none. */
  prepared: PreparedSong | null;
  /** The prepared song, when it is the one after the current song */
  preparedNext(): PreparedSong | null;
  /** Makes the prepared song `id` the current one without a gap. Returns false, and changes nothing, when it is not ready. */
  advanceToPrepared(id: string): boolean;
}
/** Songs whose speed or pitch render was built in advance, by id. A song that is not here plays at its own speed until its render is ready. */
const renderedAhead = new Set<string>();

/** Whether the song's speed or pitch render was built in advance. */
export function isRenderedAhead(id: string): boolean {
  return renderedAhead.has(id);
}

const hex = (digest: ArrayBuffer) => Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
/** The notice after a song is ready. Tracks that could not be read are named, so the song's gaps are not a mystery. */
function readyNotice(title: string, skipped: string[]): string {
  if (!skipped.length) return `${title} ready.`;
  return `${title} ready. Skipped ${skipped.join(", ")}: missing or damaged audio.`;
}

/** Fetches a saved track straight from the app protocol and decodes it in a worker; nothing is copied through IPC. */
async function loadTrack(url: string, track: LibraryAudio): Promise<PcmAudio> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Missing or damaged ${track.name} audio.`);
  const file = await response.arrayBuffer();
  if (track.bytes !== undefined && file.byteLength !== track.bytes) throw new Error(`Missing or damaged ${track.name} audio.`);
  const audio = await decodeTrack(file);
  if (audio.channels.length !== track.channels || audio.channels[0].length !== track.frames || audio.sampleRate !== track.sampleRate)
    throw new Error(`Missing or damaged ${track.name} audio.`);
  return audio;
}
/**
 * Loads a song's audio from the library, without changing anything in the app. A track that cannot be read is left out and named in
 * `skipped`, so the song still plays. When the source is the track that cannot be read, the source is rebuilt from the tracks that can.
 */
async function fetchSong(index: SongLibrary, id: string): Promise<Omit<PreparedSong, "player">> {
  const song = index.songs.find((s) => s.id === id);
  if (!song) throw new Error("Song is missing from the library.");
  const urls = await api().audioUrls(id);
  const skipped: string[] = [];
  const loaded = await Promise.all(
    song.audio.map(async (track) => {
      try {
        return [track, await loadTrack(urls[trackKey(track)], track)] as const;
      } catch {
        skipped.push(track.name);
        return null;
      }
    }),
  );
  const found = loaded.filter((entry) => entry !== null);
  const sourceEntry = found.find(([track]) => trackKindOf(track) === "source");
  const playable = found.filter(([track]) => trackKindOf(track) !== "source");
  if (!sourceEntry && !playable.length) throw new Error("Missing or damaged audio: none of this song's tracks can be read.");
  let source: PcmAudio;
  if (sourceEntry) source = sourceEntry[1];
  else {
    const frames = Math.max(...playable.map(([, pcm]) => pcm.channels[0].length));
    source = { sampleRate: playable[0][1].sampleRate, channels: mixDown(playable.map(([, pcm]) => pcm.channels), frames) };
  }
  const stems: Record<string, PcmAudio> = {};
  const tracks: Record<string, TrackInfo> = {};
  for (const [track, pcm] of playable) {
    stems[trackKey(track)] = pcm;
    tracks[trackKey(track)] = trackInfoOf(track);
  }
  // A track's saved pitch choice is a default: the song's own choice, if it has one, wins.
  const options = song.settings[":options"] ?? "";
  const merged = mergeTrackDefaults(options, tracks);
  return {
    id,
    title: song.title,
    source: { name: song.sourceName, libraryId: song.id, audio: source },
    stems: stems as Stems,
    settings: merged === options ? song.settings : { ...song.settings, ":options": merged },
    tracks,
    skipped,
  };
}
/** Reads the index after moving any settings an earlier version left in localStorage into the library. */
async function readIndex(): Promise<SongLibrary> {
  const index = await api().index();
  // A failed move leaves the localStorage copies for the next start; it must not hide the library.
  await migrateLocalSettings(index.songs).catch((e) => console.error("Could not move song settings into the library", e));
  return index;
}
const api = () => {
  if (!host.song.library) throw new Error("Saved songs are available in the desktop app.");
  return host.song.library;
};
export const useSongLibrary = create<LibraryState>((set, get) => {
  let loadGeneration = 0;
  let prefetchGeneration = 0;
  /** The id of the song being loaded in the background, if any */
  let prefetching: string | null = null;
  const run = async (task: () => Promise<void>) => {
    if (get().busy) return;
    set({ busy: true, error: "", notice: "" });
    try {
      await task();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), playlistPlaying: false });
    } finally {
      set({ busy: false });
    }
  };
  const restore = async (mode: RestoreMode) => {
    const service = api();
    set({ transfer: "Checking library backup…" });
    const unsubscribe = service.onTransferProgress((p) => set({ transfer: `${p.phase} · ${p.completed} / ${p.total} files` }));
    try {
      const result = await service.restoreBackup(mode);
      set({
        index: await service.index(),
        queue: [],
        position: -1,
        playlistPlaying: false,
        midiSession: null,
        notice:
          mode === "skip"
            ? `Restored ${result.songs} songs and ${result.playlists} playlists. Skipped ${result.skipped ?? 0} songs already in the library.`
            : `Restored ${result.songs} songs and ${result.playlists} playlists as new copies. Existing songs were kept.`,
      });
      prefetchNext();
    } finally {
      unsubscribe();
      set({ transfer: "" });
    }
  };
  /**
   * Loads the playlist's next song in the background, so that it can start on the same clock as the current one. Only one is held
   * besides the current song. A failure is a notice: the next song then loads after the current one, as before.
   */
  /** Releases the prepared song that is held, if any. Once a song has been taken over, the library no longer holds it. */
  const dropPrepared = () => {
    const { prepared } = get();
    if (!prepared) return;
    set({ prepared: null });
    void prepared.player.dispose();
  };
  const prefetchNext = () => {
    const { index, queue, position, playlistPlaying, prepared } = get();
    const id = playlistPlaying ? queue[position + 1] : undefined;
    if (!id) {
      prefetchGeneration++;
      prefetching = null;
      dropPrepared();
      return;
    }
    if (prepared?.id === id || prefetching === id) return;
    dropPrepared();
    const generation = ++prefetchGeneration;
    prefetching = id;
    fetchSong(index, id)
      .then(async (next) => {
        // The buffers are built here, well before the join, a channel at a time. The join then only starts them.
        // A song saved at another speed or pitch is rendered here too, so the join plays it without waiting for a render.
        const options = next.settings[":options"] ?? "";
        const speed = speedFromOptions(options);
        let stems = next.stems;
        if (!isPlainSpeed(speed)) {
          stems = (await new RenderQueue().render(next.stems, speed)) ?? next.stems;
          renderedAhead.add(next.id);
        }
        const player = await StemPlayer.create(stems, sharedPlaybackEngine(), playerShape(shapeFromOptions(options)), yieldToMain, speed.rate);
        if (generation !== prefetchGeneration) {
          await player.dispose();
          return;
        }
        set({ prepared: { ...next, player } });
      })
      .catch((e) => {
        if (generation === prefetchGeneration) set({ notice: `The next song could not be loaded in advance. ${e instanceof Error ? e.message : String(e)}` });
      })
      .finally(() => {
        if (generation === prefetchGeneration) prefetching = null;
      });
  };
  const load = async (id: string, queue: string[], position: number, playlist: boolean) => {
    const generation = ++loadGeneration;
    if (!playlist) set({ playlistPlaying: false, midiSession: null });
    // Switching songs mid-set must not wait on a failed write; the edits stay queued and are retried.
    await flushSettings().catch((e) => console.error("Could not save song settings", e));
    const index = await readIndex(),
      song = index.songs.find((s) => s.id === id);
    if (!song) throw new Error("Song is missing from the library.");
    // Keep the performance controls visible while advancing; Stop can cancel an in-flight load.
    if (!playlist) useNav.getState().go("song", "songs");
    useSong.getState().cancel();
    const next = await fetchSong(index, id);
    if (generation !== loadGeneration) return;
    seedSettings(song.id, song.settings);
    set({ index, queue: [...queue], position, playlistPlaying: playlist, notice: readyNotice(song.title, next.skipped) });
    useSong.setState({
      source: next.source,
      stems: Object.keys(next.stems).length ? next.stems : null,
      tracks: next.tracks,
      lastSplit: null,
      status: { kind: "idle" },
    });
    useNav.getState().go("song", "performance");
    prefetchNext();
  };
  return {
    index: emptyLibrary(),
    busy: false,
    error: "",
    notice: "",
    transfer: "",
    queue: [],
    position: -1,
    playlistPlaying: false,
    midiSession: null,
    prepared: null,
    preparedNext: () => {
      const { prepared, queue, position, playlistPlaying } = get();
      return playlistPlaying && prepared && queue[position + 1] === prepared.id ? prepared : null;
    },
    advanceToPrepared: (id) => {
      const { prepared, queue, position, playlistPlaying } = get();
      if (!prepared || prepared.id !== id || !playlistPlaying || queue[position + 1] !== id) return false;
      loadGeneration++;
      seedSettings(prepared.id, prepared.settings);
      useSong.getState().cancel();
      set({ position: position + 1, prepared: null, notice: readyNotice(prepared.title, prepared.skipped) });
      useSong.setState({
        source: prepared.source,
        stems: Object.keys(prepared.stems).length ? prepared.stems : null,
        tracks: prepared.tracks,
        lastSplit: null,
        status: { kind: "idle" },
      });
      prefetchNext();
      return true;
    },
    exportBackup: () =>
      run(async () => {
        const service = api();
        set({ transfer: "Preparing library backup…" });
        const unsubscribe = service.onTransferProgress((p) => set({ transfer: `${p.phase} · ${p.completed} / ${p.total} files` }));
        try {
          await flushSettings();
          const result = await service.exportBackup();
          set({ notice: result ? `Exported ${result.songs} songs and ${result.playlists} playlists to ${result.fileName}.` : "Backup export cancelled." });
        } finally {
          unsubscribe();
          set({ transfer: "" });
        }
      }),
    backupPreview: null,
    restoreBackup: () =>
      run(async () => {
        const service = api();
        const preview = await service.inspectBackup();
        if (!preview) {
          set({ notice: "Backup restore cancelled." });
          return;
        }
        if (preview.duplicates) {
          set({ backupPreview: preview });
          return;
        }
        await restore("copy");
      }),
    finishRestore: (mode) =>
      run(async () => {
        set({ backupPreview: null });
        if (!mode) {
          set({ notice: "Backup restore cancelled." });
          return;
        }
        await restore(mode);
      }),
    rememberMidi: (midiSession) => set({ midiSession }),
    pausePlaylist: () => {
      loadGeneration++;
      set({ playlistPlaying: false });
      prefetchNext();
    },
    resumePlaylist: () => {
      if (!get().busy && get().queue.length) set({ playlistPlaying: true, error: "", notice: "" });
      prefetchNext();
    },
    playPlaylist: (queue, position = 0) =>
      run(async () => {
        if (!queue.length || !queue[position]) throw new Error("This playlist is empty.");
        set({ playlistPlaying: true, midiSession: null });
        await load(queue[position], queue, position, true);
      }),
    advancePlaylist: () =>
      run(async () => {
        const { queue, position, playlistPlaying } = get();
        if (!playlistPlaying) return;
        if (position + 1 >= queue.length) {
          set({ playlistPlaying: false, notice: "Playlist finished." });
          return;
        }
        const nextId = queue[position + 1];
        if (get().advanceToPrepared(nextId)) return;
        const loading = prefetching === nextId;
        await load(nextId, queue, position + 1, true);
        if (loading) set({ notice: "The next song was still loading, so it started after a gap." });
      }),
    skipPlaylist: (offset) =>
      run(async () => {
        const { queue, position, playlistPlaying } = get(),
          next = position + offset;
        if (next < 0 || next >= queue.length) return;
        await load(queue[next], queue, next, playlistPlaying);
      }),
    refresh: () =>
      run(async () => {
        set({ index: await readIndex() });
      }),
    save: (title, artist) =>
      run(async () => {
        const state = useSong.getState(),
          source = state.source;
        if (!source || ["decoding", "model", "splitting"].includes(state.status.kind)) throw new Error("Wait for the song to finish loading or splitting.");
        const id = source.libraryId ?? crypto.randomUUID();
        const tracks: [string, PcmAudio][] = [
          ["source", source.audio],
          ...Object.entries(state.stems ?? {}).filter((entry): entry is [string, PcmAudio] => entry[1] !== undefined),
        ];
        // One track at a time keeps the encoder's copy of the audio to a single track.
        const assets: { name: string; bytes: Uint8Array }[] = [],
          audioInfo: LibraryAudio[] = [];
        for (const [key, audio] of tracks) {
          const bytes = await encodeTrack(audio);
          const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
          const info = key === "source" ? undefined : state.tracks[key];
          assets.push({ name: flacName(key), bytes });
          audioInfo.push({
            name: info?.name ?? key,
            sampleRate: audio.sampleRate,
            frames: audio.channels[0].length,
            channels: audio.channels.length,
            file: flacName(key),
            codec: "flac",
            bytes: bytes.length,
            sha256,
            kind: key === "source" ? "source" : (info?.kind ?? "stem"),
            ...savedSettingsOf(info),
          });
        }
        const song: LibrarySong = {
          id,
          title: title.trim() || source.name,
          artist: artist.trim(),
          sourceName: source.name,
          duration: source.audio.channels[0].length / source.audio.sampleRate,
          audio: audioInfo,
          settings: readSettings(performanceKey(source)),
          updated: new Date().toISOString(),
        };
        await api().save(song, assets);
        if (useSong.getState().source === source) {
          const saved = { ...source, libraryId: id };
          // Background transcription/key analysis can finish while audio is being copied.
          // Promote the latest settings, not the snapshot taken before the async save.
          const latest = readSettings(performanceKey(source));
          seedSettings(id, song.settings);
          writeSettings(performanceKey(saved), latest);
          migrateLyricsJob(performanceKey(source), performanceKey(saved));
          if (!source.libraryId) useSong.setState({ source: saved });
          await flushSettings();
        }
        set({ index: await api().index(), notice: `Saved ${song.title}, including audio, stems and performance settings.` });
      }),
    load: (id, queue = [id], position = 0) => run(() => load(id, queue, position, false)),
    playlists: (playlists) =>
      run(async () => {
        await api().playlists(playlists);
        set({ index: await api().index(), notice: "Playlist saved." });
      }),
    applyTrackSettings: () =>
      run(async () => {
        const id = useSong.getState().source?.libraryId;
        if (!id) throw new Error("Save the song before applying its track settings.");
        const changed = await api().applyTrackSettings(id);
        set({
          index: await api().index(),
          notice: changed ? `Applied the track settings to ${changed} similar song${changed === 1 ? "" : "s"}.` : "No other saved song has the same imported tracks.",
        });
      }),
    remove: (id) =>
      run(async () => {
        const source = useSong.getState().source;
        // A song that is still open keeps its settings, now as an unsaved song.
        const kept = source?.libraryId === id ? readSettings(performanceKey(source)) : null;
        await api().remove(id);
        forgetSettings(id);
        if (source && kept) {
          const detached = { ...source, libraryId: undefined };
          writeSettings(performanceKey(detached), kept);
          useSong.setState({ source: detached });
        }
        set({
          index: await api().index(),
          queue: [],
          position: -1,
          playlistPlaying: false,
          midiSession: null,
          notice: "Song removed from the library and playlists.",
        });
        prefetchNext();
      }),
  };
});
