import { create } from "zustand";
import { lrcTime } from "@/song/performance/chart";

/**
 * The song position for display. The audio engine owns the real clock; this store only mirrors it so that the few components which show
 * time can subscribe to exactly what they render. Selectors that return a derived value (a line index, a formatted second) keep a
 * component from re-rendering on every frame.
 */
export const usePlaybackClock = create<{ position: number; playing: boolean }>(() => ({ position: 0, playing: false }));

/** Sets the displayed position without starting the frame loop (seek, rewind, song change). */
export function setClockPosition(position: number) {
  usePlaybackClock.setState({ position: Math.max(0, position) });
}

export function clockPosition(): number {
  return usePlaybackClock.getState().position;
}

/** Mirrors `read()` into the store once per animation frame until the returned function is called. */
export function startPlaybackClock(read: () => number): () => void {
  let frame = 0;
  const tick = () => {
    const position = Math.max(0, read());
    if (position !== usePlaybackClock.getState().position) usePlaybackClock.setState({ position });
    frame = requestAnimationFrame(tick);
  };
  usePlaybackClock.setState({ playing: true });
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    usePlaybackClock.setState({ playing: false });
  };
}

/** Index of the last item that has started, or -1. Re-renders the caller only when the index changes. */
export function useActiveIndex(times: readonly number[]): number {
  return usePlaybackClock((s) => times.findLastIndex((t) => t <= s.position));
}

/** `[mm:ss.xx]` text for the current position. */
export function useClockText(): string {
  return usePlaybackClock((s) => lrcTime(s.position));
}

/** Position rounded to a tenth of a second, matching the transport slider step. */
export function useClockTenths(): number {
  return usePlaybackClock((s) => Math.round(s.position * 10) / 10);
}
