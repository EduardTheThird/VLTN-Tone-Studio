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
  type LibraryFolder,
  type LibrarySong,
  type Playlist,
  type RestoreMode,
  type SongLibrary,
  type SongMetaPatch,
} from "@shared/song-library";
import { songsFromHistory } from "@shared/library-history";
import { playNext, addToQueue as queueAdd, removeFromQueue as queueRemove, moveInQueue as queueMove, type QueueEdit } from "./queue";
import { decodeTrack, encodeTrack } from "./codec/flac-client";
import { migrateLyricsJob } from "./performance/lyrics-jobs";
import { playerShape, shapeFromOptions } from "./performance/song-shape";
import { sharedPlaybackEngine } from "./audio/playback-engine";
import { StemPlayer, yieldToMain } from "./stems/player";
import { RenderQueue, isPlainSpeed } from "./audio/render-queue";
import { speedFromOptions } from "./performance/speed";
import {
  changeSavedOptions,
  flushSettings,
  forgetSettings,
  migrateLocalSettings,
  performanceKey,
  readSettings,
  seedSettings,
  writeSettings,
} from "./performance/settings";
import { armAsNext, type SongTrigger } from "./performance/song-triggers";
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

/**
 * A playlist song that is already playing on the outgoing song's clock. The library holds it from the hand-over until the session for
 * the new song takes it over, which is a new session because the view is re-created for each song. `unwire` undoes the outgoing
 * session's hook-up of the song.
 */
export interface HandedOverSong {
  id: string;
  player: StemPlayer;
  /** The count-in before the song's audio, in ms */
  countInMs: number;
  unwire: () => void;
}

/** Stops a handed-over song that no session took up, and frees its player. */
const releaseSong = (handover: HandedOverSong) => {
  handover.unwire();
  void handover.player.dispose();
};

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
  /** The playlist set the playing queue was started from, or null. Recorded with each play. */
  playingSet: string | null;
  /** The chained song the session holds until it is handed over. A queue edit that changes the next song releases it first. */
  chainHold: { id: string; release(): void } | null;
  holdChain(hold: LibraryState["chainHold"]): void;
  /** Puts `id` straight after the playing song. Returns the reason when the queue did not change. */
  playNextSong(id: string): string | null;
  /** Adds songs to the end of the queue. A single song loaded on its own starts a queue that then plays on. */
  addToQueue(ids: string[]): string | null;
  /** Removes an upcoming entry. The playing song and the songs before it cannot be removed. */
  removeFromQueue(index: number): string | null;
  /** Moves an upcoming entry. Targets before the playing song go just after it. */
  moveInQueue(from: number, to: number): string | null;
  /** Records a play to its halfway point. Never blocks loading: a failure is logged and the play is not counted. */
  recordPlay(songId: string, setId?: string): void;
  /** Applies one metadata patch to the songs in a single save. */
  organiseSongs(ids: string[], patch: SongMetaPatch): Promise<void>;
  /** Replaces the folder list. Only an empty folder can be removed. */
  saveFolders(folders: LibraryFolder[]): Promise<void>;
  clearHistory(): Promise<void>;
  /** Creates a playlist from the songs played since `since`, in play order. */
  playlistFromHistory(name: string, since: string): Promise<void>;
  /** Changes a playlist's name, entries, sets or smart rules. */
  updatePlaylist(id: string, change: Partial<Pick<Playlist, "name" | "songs" | "sets" | "smart">>): Promise<void>;
  midiSession: { access: MIDIAccess | null; portId: string; inputId: string; armed: boolean; output: unknown } | null;
  playPlaylist(queue: string[], position?: number, setId?: string): Promise<void>;
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
  /** The song handed over from the outgoing session, until a session takes it over. Null when there is none. */
  handover: HandedOverSong | null;
  /** Holds a song handed over from the outgoing session. A song that is already held is released first. */
  setHandover(handover: HandedOverSong): void;
  /** Gives the held song to the session for song `id`, and returns it. A held song for any other song is released, and null returned. */
  claimHandover(id: string | undefined): HandedOverSong | null;
  /** Stops and releases the held song, when no session took it up. */
  releaseHandover(): void;
  /** Sets (or, with null, removes) the MIDI trigger a saved song loads by. The song's other options are kept. Throws for a song not in the library. */
  setSongTrigger(id: string, trigger: SongTrigger | null): void;
  /** Puts a saved song after the playing one in the playlist, for a trigger that arrives during a set. Returns a hint when it did not move. */
  armNext(id: string): string | null;
  /** The song a MIDI trigger loaded, which the next session for it starts playing. Null when none. */
  autoplayId: string | null;
  requestAutoplay(id: string): void;
  /** Takes the autoplay request when it is for song `id`. Returns true once, then false. */
  takeAutoplay(id: string | undefined): boolean;
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
      set({ error: e instanceof Error ? e.message : String(e), playlistPlaying: false, autoplayId: null });
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
    const { prepared, chainHold } = get();
    if (!prepared) return;
    // A song chained onto the outgoing one is undone first, so its player is not disposed while it is still wired in.
    if (chainHold?.id === prepared.id) {
      set({ chainHold: null });
      chainHold.release();
    }
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
  /** Applies a queue edit: the playing song is untouched, and the next song is prepared again when it has changed. */
  const queueEdit = (edit: QueueEdit, extra: Partial<LibraryState> = {}): string | null => {
    if (!edit.ok) return edit.reason;
    set({ queue: edit.queue, position: edit.position, ...extra });
    prefetchNext();
    return null;
  };
  const load = async (id: string, queue: string[], position: number, playlist: boolean) => {
    // Loading a song replaces the set, so a song held for the next one of the old set is released.
    get().releaseHandover();
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
    set({
      index,
      queue: [...queue],
      position,
      playlistPlaying: playlist,
      playingSet: playlist ? get().playingSet : null,
      notice: readyNotice(song.title, next.skipped),
    });
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
    playingSet: null,
    chainHold: null,
    midiSession: null,
    prepared: null,
    handover: null,
    autoplayId: null,
    requestAutoplay: (id) => set({ autoplayId: id }),
    takeAutoplay: (id) => {
      if (!id || get().autoplayId !== id) return false;
      set({ autoplayId: null });
      return true;
    },
    setSongTrigger: (id, trigger) => {
      const { index } = get();
      const song = index.songs.find((s) => s.id === id);
      if (!song) throw new Error("Song is missing from the library.");
      const options = changeSavedOptions(id, song.settings[":options"], (current) => ({ ...current, midiTrigger: trigger ?? undefined }));
      set({ index: { ...index, songs: index.songs.map((s) => (s.id === id ? { ...s, settings: { ...s.settings, ":options": options } } : s)) } });
    },
    armNext: (id) => {
      const { index, queue, position, playlistPlaying } = get();
      if (!playlistPlaying) return "Arming a song as next needs a playlist that is playing.";
      const title = index.songs.find((s) => s.id === id)?.title ?? "That song";
      const result = armAsNext(queue, position, id);
      if (!result.ok) {
        return {
          current: `${title} is playing.`,
          played: `${title} has already played in this set.`,
          next: `${title} is already next.`,
        }[result.reason];
      }
      set({ queue: result.queue, notice: `${title} plays next.` });
      prefetchNext();
      return null;
    },
    setHandover: (handover) => {
      get().releaseHandover();
      set({ handover });
    },
    claimHandover: (id) => {
      const { handover } = get();
      if (!handover) return null;
      set({ handover: null });
      if (handover.id === id) return handover;
      releaseSong(handover);
      return null;
    },
    releaseHandover: () => {
      const { handover } = get();
      if (!handover) return;
      set({ handover: null });
      releaseSong(handover);
    },
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
    holdChain: (chainHold) => set({ chainHold }),
    playNextSong: (id) => {
      const { queue, position } = get();
      if (position < 0) return "Load a song first.";
      return queueEdit(playNext({ queue, position }, id));
    },
    addToQueue: (ids) => {
      const { queue, position, playlistPlaying } = get();
      if (position < 0) return "Load a song first.";
      // One song loaded on its own starts the queue: the songs added after it play on when it ends.
      const starts = !playlistPlaying && queue.length === 1 && position === 0 && ids.length > 0;
      return queueEdit(queueAdd({ queue, position }, ids), starts ? { playlistPlaying: true } : {});
    },
    removeFromQueue: (index) => {
      const { queue, position } = get();
      return queueEdit(queueRemove({ queue, position }, index));
    },
    moveInQueue: (from, to) => {
      const { queue, position } = get();
      return queueEdit(queueMove({ queue, position }, from, to));
    },
    recordPlay: (songId, setId) => {
      // The count is written in the background, so a play never waits on the disk or blocks loading.
      void Promise.resolve()
        .then(() => api().organise({ kind: "played", id: songId, at: new Date().toISOString(), ...(setId ? { setId } : {}) }))
        .then(async () => set({ index: await api().index() }))
        .catch((e) => console.error("Could not record the play", e));
    },
    organiseSongs: (ids, patch) =>
      run(async () => {
        await api().organise({ kind: "songs", ids, patch });
        set({ index: await api().index(), notice: `Updated ${ids.length} song${ids.length === 1 ? "" : "s"}.` });
      }),
    saveFolders: (folders) =>
      run(async () => {
        await api().organise({ kind: "folders", folders });
        set({ index: await api().index(), notice: "Folders saved." });
      }),
    clearHistory: () =>
      run(async () => {
        await api().organise({ kind: "history", history: [] });
        set({ index: await api().index(), notice: "Play history cleared." });
      }),
    playlistFromHistory: (name, since) =>
      run(async () => {
        const trimmed = name.trim();
        if (!trimmed) throw new Error("Name the playlist first.");
        const { index } = get();
        const songs = songsFromHistory(index.songs, index.history, since);
        if (!songs.length) throw new Error("No songs were played since that date.");
        await api().playlists([...index.playlists, { id: crypto.randomUUID(), name: trimmed, songs, sets: [] }]);
        set({ index: await api().index(), notice: `Created ${trimmed} with ${songs.length} songs from the history.` });
      }),
    updatePlaylist: (id, change) =>
      run(async () => {
        const playlists = get().index.playlists.map((p) => (p.id === id ? { ...p, ...change } : p));
        await api().playlists(playlists);
        set({ index: await api().index() });
      }),
    rememberMidi: (midiSession) => set({ midiSession }),
    pausePlaylist: () => {
      loadGeneration++;
      get().releaseHandover();
      set({ playlistPlaying: false });
      prefetchNext();
    },
    resumePlaylist: () => {
      if (!get().busy && get().queue.length) set({ playlistPlaying: true, error: "", notice: "" });
      prefetchNext();
    },
    playPlaylist: (queue, position = 0, setId) =>
      run(async () => {
        if (!queue.length || !queue[position]) throw new Error("This playlist is empty.");
        set({ playlistPlaying: true, midiSession: null, playingSet: setId ?? null });
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
