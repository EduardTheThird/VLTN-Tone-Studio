import { create } from "zustand";
export interface MidiTimingEvent {
  label: string;
  intended: number;
  queued: number;
  lateMs: number;
  bytes: number[];
  byteCount?: number;
}
const empty = () => ({
  queued: 0,
  late: 0,
  maxLateMs: 0,
  failures: 0,
  lastFailure: "",
  recent: [] as MidiTimingEvent[],
  /** Late commands that were not sent. Kept (bounded) so a later chase can resend the state that should be current. */
  dropped: 0,
  droppedMessages: [] as MidiTimingEvent[],
  resyncs: 0,
  clockTempo: new Map<string, { min: number; max: number }>(),
});
export const useMidiDiagnostics = create<
  ReturnType<typeof empty> & {
    record: (event: MidiTimingEvent) => void;
    recordClockTempo: (songKey: string, bpm: number) => void;
    drop: (events: MidiTimingEvent[]) => void;
    resync: () => void;
    fault: (error: string) => void;
    reset: () => void;
  }
>((set) => ({
  ...empty(),
  record(event) {
    set((s) => ({
      queued: s.queued + 1,
      late: s.late + (event.lateMs > 5 ? 1 : 0),
      maxLateMs: Math.max(s.maxLateMs, event.lateMs),
      recent:
        event.bytes[0] === 248 || event.bytes[0] === 241
          ? s.recent
          : [{ ...event, bytes: event.bytes.slice(0, 32), byteCount: event.bytes.length }, ...s.recent].slice(0, 30),
    }));
  },
  recordClockTempo(songKey, bpm) {
    set((s) => {
      const previous = s.clockTempo.get(songKey);
      if (previous && bpm >= previous.min && bpm <= previous.max) return s;
      const clockTempo = new Map(s.clockTempo);
      clockTempo.set(songKey, { min: Math.min(bpm, previous?.min ?? bpm), max: Math.max(bpm, previous?.max ?? bpm) });
      return { clockTempo };
    });
  },
  drop(events) {
    set((s) => ({
      dropped: s.dropped + events.length,
      droppedMessages: [...events.map((e) => ({ ...e, bytes: e.bytes.slice(0, 32), byteCount: e.bytes.length })).reverse(), ...s.droppedMessages].slice(0, 30),
    }));
  },
  resync() {
    set((s) => ({ resyncs: s.resyncs + 1 }));
  },
  fault(error) {
    set((s) => ({ failures: s.failures + 1, lastFailure: error }));
  },
  reset() {
    set(empty());
  },
}));
