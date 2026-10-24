import { Button } from "@/components/ui/button";
import { useSong } from "@/song/store";
import { useSongLibrary } from "@/song/library";
import { useSession, type PerformanceSession } from "@/song/performance/session";
import { ClockOverDuration, PositionSlider } from "./PlaybackDisplay";

const field = "rounded border border-seam bg-transparent p-2";

export interface MetronomeSettings {
  metronome: boolean;
  onMetronome: (value: boolean) => void;
  firstBeat: number;
  onFirstBeat: (value: number) => void;
  beats: number;
  onBeats: (value: number) => void;
  volume: number;
  onVolume: (value: number) => void;
}

/** Playlist controls, library messages, play/seek and the tempo and metronome settings. */
export function PerformanceTransport({
  session,
  stage,
  bpm,
  onBpm,
  metronome,
}: {
  session: PerformanceSession;
  stage: boolean;
  bpm: number;
  onBpm: (value: number) => void;
  metronome: MetronomeSettings;
}) {
  const library = useSongLibrary();
  const source = useSong((s) => s.source);
  const player = useSession(session, (s) => s.player);
  const playing = useSession(session, (s) => s.playing);
  const queued = useSession(session, (s) => s.queued);
  const parseError = useSession(session, (s) => s.parseError);
  const tempoOnStart = useSession(session, (s) => s.tempoOnStart);
  const clock = useSession(session, (s) => s.clock);
  const duration = player?.duration ?? 0;
  const { firstBeat, onFirstBeat } = metronome;
  return (
    <>
      {queued && (
        <div aria-label="Playlist transport" className="flex flex-wrap items-center gap-3 rounded border border-seam p-3">
          <strong>{library.index.songs.find((s) => s.id === source?.libraryId)?.title}</strong>
          <span>
            {library.position + 1} / {library.queue.length}
          </span>
          <Button variant="outline" disabled={library.busy || library.position <= 0} onClick={() => session.skip(-1)}>
            Previous song
          </Button>
          <Button variant="outline" disabled={library.busy || library.position + 1 >= library.queue.length} onClick={() => session.skip(1)}>
            Next song
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              session.pause();
              library.pausePlaylist();
            }}
          >
            Stop playlist
          </Button>
          <span>
            {library.busy ? "Loading next song..." : library.playlistPlaying ? "Playlist playing" : "Playlist paused"} · Next:{" "}
            {library.index.songs.find((s) => s.id === library.queue[library.position + 1])?.title ?? "End of set"}
          </span>
          <p className="w-full text-sm text-silkscreen-3">
            Songs advance automatically while the playlist is playing. MIDI output stays armed for this set while the same device remains connected.
          </p>
        </div>
      )}
      {library.error && (
        <p role="alert" className="text-red-400">
          {library.error}
        </p>
      )}
      {queued && library.notice === "Playlist finished." && <p role="status">Playlist finished.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!player || !!parseError || library.busy} onClick={() => (playing ? session.pause() : session.startPlayback())}>
          {playing ? "Pause" : queued && library.queue.length > 1 ? "Play playlist" : "Play song"}
        </Button>
        <Button variant="outline" disabled={!player || stage} onClick={() => void session.seek(0)}>
          Rewind
        </Button>
        <ClockOverDuration duration={duration} />
        <PositionSlider label="Song position" duration={duration} onSeek={(value) => void session.seek(value)} />
        {!source && <span>Open a song in Stems to perform.</span>}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
          <label>
            Song BPM{" "}
            <input
              className={field + " w-20"}
              aria-label="BPM"
              title="Set the recording’s BPM while stopped. Audio speed and cue timestamps stay unchanged."
              type="number"
              min="30"
              max="300"
              disabled={playing}
              value={bpm}
              onChange={(e) => onBpm(Math.max(30, Math.min(300, Number(e.target.value) || 120)))}
            />
          </label>
          <label>
            <input type="checkbox" checked={metronome.metronome} onChange={(e) => metronome.onMetronome(e.target.checked)} /> Metronome
          </label>
          <details className="relative">
            <summary className="cursor-pointer">Metronome settings</summary>
            <div className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-xl border border-seam bg-background p-4 shadow-xl">
              <p>Follows song playback. On/off is remembered for all songs.</p>
              <label className="block">
                First beat (seconds){" "}
                <input
                  aria-label="First beat (seconds)"
                  className={field + " w-24"}
                  type="number"
                  min="0"
                  step="0.001"
                  disabled={playing}
                  value={firstBeat}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0) onFirstBeat(n);
                  }}
                />
              </label>
              <Button variant="outline" disabled={!player || playing} onClick={() => onFirstBeat(Math.round(Math.max(0, player?.position ?? 0) * 1000) / 1000)}>
                Set first beat here
              </Button>
              <Button variant="outline" disabled={playing || firstBeat === 0} onClick={() => onFirstBeat(0)}>
                Reset first beat
              </Button>
              <p className="text-xs">
                While stopped, seek to the first downbeat and set it here. Clicks begin there; song audio and MIDI cue timestamps stay unchanged.
              </p>
              <label className="block">
                Beats{" "}
                <select aria-label="Beats" className={field} value={metronome.beats} onChange={(e) => metronome.onBeats(Number(e.target.value))}>
                  {[2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                Metronome volume{" "}
                <input
                  aria-label="Metronome volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={metronome.volume}
                  onChange={(e) => metronome.onVolume(Number(e.target.value))}
                />
              </label>
              <p>Set BPM to match the recording. Beat one is at the start of the audio; this does not detect tempo or stretch audio.</p>
            </div>
          </details>
          <label>
            <input
              type="checkbox"
              aria-label="MIDI Clock (24 PPQN)"
              disabled={tempoOnStart}
              checked={clock}
              onChange={(e) => session.setClock(e.target.checked)}
            />{" "}
            Send MIDI Clock
          </label>
        </div>
      </div>
    </>
  );
}
