import { create } from 'zustand';
import { host } from '@/host';
import { useSong } from './store';
import { useNav } from '@/state/nav';
import { assetName, emptyLibrary, type LibrarySong, type Playlist, type SongLibrary } from '@shared/song-library';
import { migrateLyricsJob } from './performance/lyrics-jobs';
import { performanceKey, readSettings, writeSettings } from './performance/settings';
import type { PcmAudio, Stems } from './types';

interface LibraryState {
  index: SongLibrary; busy: boolean; error: string; notice: string;
  queue: string[]; position: number;
  playlistPlaying: boolean;
  midiSession: { access: MIDIAccess | null; portId: string; inputId: string; armed: boolean; output: unknown } | null;
  playPlaylist(queue: string[], position?: number): Promise<void>;
  advancePlaylist(): Promise<void>;
  skipPlaylist(offset: number): Promise<void>;
  resumePlaylist(): void;
  pausePlaylist(): void;
  rememberMidi(session: LibraryState['midiSession']): void;
  refresh(): Promise<void>;
  save(title: string, artist: string): Promise<void>;
  load(id: string, queue?: string[], position?: number): Promise<void>;
  playlists(value: Playlist[]): Promise<void>;
  remove(id: string): Promise<void>;
}
const api = () => { if (!host.song.library) throw new Error('Saved songs are available in the desktop app.'); return host.song.library; };
export const useSongLibrary = create<LibraryState>((set, get) => {
  let loadGeneration = 0;
  const run = async (task: () => Promise<void>) => {
    if (get().busy) return;
    set({ busy: true, error: '', notice: '' });
    try { await task(); } catch (e) { set({ error: e instanceof Error ? e.message : String(e), playlistPlaying: false }); }
    finally { set({ busy: false }); }
  };
  const load = async (id: string, queue: string[], position: number, playlist: boolean) => {
    const generation = ++loadGeneration;
    if (!playlist) set({ playlistPlaying: false, midiSession: null });
    const current = useSong.getState().source;
    if (current?.libraryId) await api().settings(current.libraryId, readSettings(performanceKey(current)));
    const index = await api().index(), song = index.songs.find(s => s.id === id);
    if (!song) throw new Error('Song is missing from the library.');
    // Keep the performance controls visible while advancing; Stop can cancel an in-flight load.
    if (!playlist) useNav.getState().go('song', 'songs');
    useSong.getState().cancel();
    const tracks: Record<string, PcmAudio> = {};
    for (const track of song.audio) {
      const channels: Float32Array[] = [];
      for (let c = 0; c < track.channels; c++) {
        const bytes = await api().audio(id, assetName(track.name, c));
        if (generation !== loadGeneration) return;
        if (bytes.byteLength !== track.frames * 4) throw new Error(`Missing or damaged ${track.name} audio.`);
        channels.push(new Float32Array(bytes.slice().buffer));
      }
      tracks[track.name] = { sampleRate: track.sampleRate, channels };
    }
    if (generation !== loadGeneration) return;
    const source = { name: song.sourceName, libraryId: song.id, audio: tracks.source };
    writeSettings(performanceKey(source), song.settings);
    const stems = Object.fromEntries(Object.entries(tracks).filter(([name]) => name !== 'source')) as Stems;
    set({ index, queue: [...queue], position, playlistPlaying: playlist, notice: `${song.title} ready.` });
    useSong.setState({ source, stems: Object.keys(stems).length ? stems : null, lastSplit: null, status: { kind: 'idle' } });
    useNav.getState().go('song', 'performance');
  };
  return {
    index: emptyLibrary(), busy: false, error: '', notice: '', queue: [], position: -1,
    playlistPlaying: false, midiSession: null,
    rememberMidi: midiSession => set({ midiSession }),
    pausePlaylist: () => { loadGeneration++; set({ playlistPlaying: false }); },
    resumePlaylist: () => { if (!get().busy && get().queue.length) set({ playlistPlaying: true, error: '', notice: '' }); },
    playPlaylist: (queue, position = 0) => run(async () => {
      if (!queue.length || !queue[position]) throw new Error('This playlist is empty.');
      set({ playlistPlaying: true, midiSession: null });
      await load(queue[position], queue, position, true);
    }),
    advancePlaylist: () => run(async () => {
      const { queue, position, playlistPlaying } = get();
      if (!playlistPlaying) return;
      if (position + 1 >= queue.length) { set({ playlistPlaying: false, notice: 'Playlist finished.' }); return; }
      await load(queue[position + 1], queue, position + 1, true);
    }),
    skipPlaylist: offset => run(async () => {
      const { queue, position, playlistPlaying } = get(), next = position + offset;
      if (next < 0 || next >= queue.length) return;
      await load(queue[next], queue, next, playlistPlaying);
    }),
    refresh: () => run(async () => { set({ index: await api().index() }); }),
    save: (title, artist) => run(async () => {
      const state = useSong.getState(), source = state.source;
      if (!source || ['decoding', 'model', 'splitting'].includes(state.status.kind)) throw new Error('Wait for the song to finish loading or splitting.');
      const id = source.libraryId ?? crypto.randomUUID();
      const tracks: [string, PcmAudio][] = [['source', source.audio], ...Object.entries(state.stems ?? {})];
      const song: LibrarySong = {
        id, title: title.trim() || source.name, artist: artist.trim(), sourceName: source.name,
        duration: source.audio.channels[0].length / source.audio.sampleRate,
        audio: tracks.map(([name, audio]) => ({ name, sampleRate: audio.sampleRate, frames: audio.channels[0].length, channels: audio.channels.length })),
        settings: readSettings(performanceKey(source)), updated: new Date().toISOString(),
      };
      // Views avoid duplicating the entire in-memory song before IPC copies one channel at a time.
      const assets = tracks.flatMap(([name, audio]) => audio.channels.map((channel, c) => ({ name: assetName(name, c), bytes: new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength) })));
      await api().save(song, assets);
      if (useSong.getState().source === source) {
        const saved = { ...source, libraryId: id };
        writeSettings(performanceKey(saved), song.settings);
        migrateLyricsJob(performanceKey(source), performanceKey(saved));
        if (!source.libraryId) useSong.setState({ source: saved });
      }
      set({ index: await api().index(), notice: `Saved ${song.title}, including audio, stems and performance settings.` });
    }),
    load: (id, queue = [id], position = 0) => run(() => load(id, queue, position, false)),
    playlists: playlists => run(async () => { await api().playlists(playlists); set({ index: await api().index(), notice: 'Playlist saved.' }); }),
    remove: id => run(async () => {
      await api().remove(id);
      const source = useSong.getState().source;
      if (source?.libraryId === id) { const detached = { ...source, libraryId: undefined }; writeSettings(performanceKey(detached), readSettings(performanceKey(source))); useSong.setState({ source: detached }); }
      set({ index: await api().index(), queue: [], position: -1, playlistPlaying: false, midiSession: null, notice: 'Song removed from the library and playlists.' });
    }),
  };
});
