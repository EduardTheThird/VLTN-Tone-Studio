import { usePlaybackClock } from "@/song/performance/playback-clock";

/** Index of the song beat that is sounding, or -1 while stopped or before the first beat. Only a change of beat re-renders. */
function useBeatIndex(bpm: number, firstBeat: number): number {
  return usePlaybackClock((s) => (s.playing && bpm > 0 ? Math.max(-1, Math.floor(((s.position - firstBeat) * bpm) / 60 + 1e-6)) : -1));
}

/**
 * A dot that flashes on each beat of the song grid, in the accent colour on the downbeat. The dot is remounted on every beat, so the
 * flash plays again each time. Count-in beats are not shown: the displayed clock starts at zero.
 */
export function BeatIndicator({ bpm, beats, firstBeat }: { bpm: number; beats: number; firstBeat: number }) {
  const beat = useBeatIndex(bpm, firstBeat);
  const downbeat = beat >= 0 && beat % beats === 0;
  return (
    <span role="img" aria-label={beat < 0 ? "Beat" : downbeat ? "Downbeat" : "Beat"} className="relative inline-flex size-4 items-center justify-center">
      <span className="absolute inline-flex size-full rounded-full border border-seam" />
      {beat >= 0 && (
        <span key={beat} className={`absolute inline-flex size-full animate-ping rounded-full ${downbeat ? "bg-amber-400" : "bg-sky-400"} opacity-75`} />
      )}
    </span>
  );
}
