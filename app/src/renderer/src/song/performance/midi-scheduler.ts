import type { Cue } from "./chart";
import { CHASE_LEAD_MS, computeChaseState } from "./midi-chase";

export interface ScheduledMessage {
  bytes: number[];
  due: number;
  label: string;
  /** Song position in seconds the message belongs to. Unlike `due`, it is unaffected by a resync. */
  time?: number;
}
export interface SchedulerConfig {
  cues: Cue[];
  position: number;
  duration: number;
  origin: number;
  bpm: number;
  clock: boolean;
  tempo: number[][] | null;
  /** Clock time (the same clock as `origin`) the start tempo is due. Defaults to song position zero, which a count-in puts later than the start. */
  tempoAt?: number;
  /** Seconds of cues to emit ahead of the audio position. Defaults to the Bluetooth value. */
  lookahead?: number;
}
/** A planned jump: from clock time `at` the song is at `position`. */
export interface SchedulerJump {
  at: number;
  position: number;
}
export type SchedulerReply =
  | { type: "batch"; messages: ScheduledMessage[]; dropped?: ScheduledMessage[] }
  | { type: "resync"; position: number }
  | { type: "fault"; error: string }
  | { type: "ready" }
  | { type: "started" }
  | { type: "heartbeat" };
export type SchedulerRequest =
  | { type: "start"; config: SchedulerConfig }
  | { type: "sync"; position: number; at: number }
  | { type: "plan"; cap: number | null; jump: SchedulerJump | null }
  | { type: "stop" };

/** USB / system MIDI: Web MIDI queues timestamped messages on the browser's MIDI thread, so renderer jank cannot delay them. */
export const SYSTEM_LOOKAHEAD = 1;
/** Bluetooth MIDI has no receiver-side timestamping, so cues are held in renderer timers and must stay close to their due time. */
export const BLUETOOTH_LOOKAHEAD = 0.12;
/** A message later than this is dropped instead of sent out of place. */
export const STALE_MS = 250;
/** This many resyncs inside RESYNC_WINDOW_MS means timing is not recovering and the session is faulted. */
const MAX_RESYNCS = 3;
const RESYNC_WINDOW_MS = 5000;
/** The audio position must advance at least this often while playing. */
const AUDIO_STALL_MS = 1000;

/** What to do with a message that is already past STALE_MS. Note-offs are always sent so notes cannot hang. */
export function lateAction(bytes: number[]): "send" | "drop" | "ignore" {
  const status = bytes[0] & 240;
  if (bytes[0] === 248) return "ignore";
  if (status === 128 || (status === 144 && bytes[2] === 0)) return "send";
  return "drop";
}

/** Independent of React and audio analysis. All times are epoch milliseconds. */
export class MidiSchedule {
  private next: number;
  private pulse: number;
  /** Clock time of pulse zero. It stays put across a jump, so the 24-pulse clock never gaps or bursts. */
  private pulseOrigin: number;
  private lastTick: number;
  private heartbeat: number;
  private config: SchedulerConfig;
  private resyncs: number[] = [];
  private lastPosition: number;
  private lastAdvance: number;
  private stopped = false;
  private tempo: number[][] | null;
  private cues: Cue[];
  /** Starting after the first cue means the pedals have to be brought to the state they would be in. */
  private chasePending = true;
  /** Cues after this song time are held back. A planned jump sets it so the old passage stops at the boundary. */
  private cap = Infinity;
  private pendingJump: SchedulerJump | null = null;
  /** Checkpoints taken before this clock time were taken before the last jump, so they describe the old passage. */
  private jumpAt = -Infinity;
  constructor(
    config: SchedulerConfig,
    now: number,
    private emit: (reply: SchedulerReply) => void,
  ) {
    // A resync moves the origin, so keep the caller's object untouched.
    this.config = { ...config };
    this.cues = config.cues.filter((c) => c.messages.length && c.time <= config.duration).sort((a, b) => a.time - b.time);
    this.next = this.cursorAt(config.position);
    this.pulse = Math.ceil(((Math.max(0, config.position) * config.bpm) / 60) * 24);
    this.pulseOrigin = config.origin;
    this.lastTick = now;
    this.heartbeat = config.origin + config.position * 1000;
    this.lastPosition = config.position;
    this.lastAdvance = now;
    this.tempo = config.tempo;
  }
  stop() {
    this.stopped = true;
  }
  /** Index of the first cue at or after `position`. */
  private cursorAt(position: number): number {
    let next = 0;
    while (next < this.cues.length && this.cues[next].time < position - 0.001) next++;
    return next;
  }
  /**
   * Holds cues after song time `cap` (null lifts the hold). With a `jump`, the schedule moves to `jump.position` at clock time
   * `jump.at`. Cues in the skipped span are never sent; the pedals get the state they would have had at the new position.
   * Setting a new plan replaces the old one, so a cancelled jump is a plan with no jump.
   */
  plan(cap: number | null, jump: SchedulerJump | null) {
    if (this.stopped) return;
    this.cap = cap ?? Infinity;
    this.pendingJump = jump;
  }
  /** The audio position is a checkpoint. A frozen audio clock is fatal; a drifted or late one re-anchors the schedule. */
  sync(position: number, at: number, now: number) {
    if (this.stopped) return;
    if (!Number.isFinite(position) || !Number.isFinite(at)) {
      this.fault("MIDI timing interrupted: invalid audio checkpoint.");
      return;
    }
    if (at < this.jumpAt) return;
    const advanced = position > this.lastPosition + 0.001;
    if (advanced) {
      this.lastPosition = position;
      this.lastAdvance = at;
    } else if (at - this.lastAdvance > AUDIO_STALL_MS) {
      this.fault("MIDI timing interrupted: the audio clock stopped advancing.");
      return;
    }
    this.heartbeat = Math.max(this.heartbeat, at);
    // A late checkpoint is still a consistent (position, time) pair, so it can re-anchor the origin.
    // A frozen position can't anchor anything; it is judged by the stall check above instead.
    if (advanced && Math.abs(at - (this.config.origin + position * 1000)) > STALE_MS) {
      const shift = at - position * 1000 - this.config.origin;
      this.config.origin += shift;
      this.pulseOrigin += shift;
      this.resync(now, position);
    }
  }
  private resync(now: number, position: number) {
    this.resyncs = this.resyncs.filter((t) => now - t < RESYNC_WINDOW_MS);
    this.resyncs.push(now);
    this.lastTick = now;
    this.heartbeat = Math.max(this.heartbeat, now);
    if (this.resyncs.length >= MAX_RESYNCS) {
      this.fault("MIDI timing could not recover after repeated stalls: cues disarmed. Check the pedal state before rearming.");
      return;
    }
    this.emit({ type: "resync", position });
  }
  private fault(
    error = "MIDI timing interrupted: cues disarmed and pending commands cleared. Audio continues. Pause and check the pedal state before rearming.",
  ) {
    if (this.stopped) return;
    this.stopped = true;
    this.emit({ type: "fault", error });
  }
  /** Moves the schedule to the planned position. The audio jumped at the same boundary, so the audio checkpoint restarts here too. */
  private jump() {
    const jump = this.pendingJump!;
    this.pendingJump = null;
    this.config.origin = jump.at - jump.position * 1000;
    this.config.position = jump.position;
    this.next = this.cursorAt(jump.position);
    this.cap = Infinity;
    this.lastPosition = jump.position;
    this.lastAdvance = jump.at;
    this.jumpAt = jump.at;
    this.chasePending = true;
  }
  /** Clock time of pulse `k`: 24 pulses per beat, from `pulseOrigin`. */
  private pulseDue(k: number): number {
    return this.pulseOrigin + ((k / 24) * 60 * 1000) / this.config.bpm;
  }
  tick(now: number) {
    if (this.stopped) return;
    if (this.pendingJump && now >= this.pendingJump.at) this.jump();
    let position = (now - this.config.origin) / 1000;
    if (now - this.lastTick > STALE_MS || now - this.heartbeat > STALE_MS) {
      this.resync(now, position);
      if (this.stopped) return;
    }
    this.lastTick = now;
    position = (now - this.config.origin) / 1000;
    const lookahead = this.config.lookahead ?? BLUETOOTH_LOOKAHEAD;
    const until = Math.min(this.cap, this.config.duration, position + lookahead),
      candidates: ScheduledMessage[] = [];
    while (this.next < this.cues.length && this.cues[this.next].time <= until) {
      const cue = this.cues[this.next++];
      for (const bytes of cue.messages) candidates.push({ bytes, due: this.config.origin + cue.time * 1000, label: cue.label || "Song cue", time: cue.time });
    }
    if (this.tempo) {
      for (const bytes of this.tempo)
        candidates.push({
          bytes,
          due: this.config.tempoAt ?? this.config.origin + Math.max(0, this.config.position) * 1000,
          label: "Song tempo",
          time: Math.max(0, this.config.position),
        });
      this.tempo = null;
    }
    if (this.config.clock) {
      // The clock runs on its own clock time, not on the song's, so a jump does not change its phase.
      const horizon = Math.min(now + lookahead * 1000, this.config.origin + this.config.duration * 1000);
      while (this.pulseDue(this.pulse) < horizon) candidates.push({ bytes: [248], due: this.pulseDue(this.pulse++), label: "MIDI clock" });
    }
    const messages: ScheduledMessage[] = [],
      dropped: ScheduledMessage[] = [];
    for (const message of candidates) {
      if (now - message.due <= STALE_MS) messages.push(message);
      else {
        const action = lateAction(message.bytes);
        if (action === "send") messages.push(message);
        else if (action === "drop") dropped.push(message);
      }
    }
    // Dropped patch or controller changes leave the pedals in the wrong state, so they are replayed as a chase too.
    const lostState = dropped.some((m) => m.bytes[0] >= 176 && m.bytes[0] < 208) || dropped.some((m) => m.bytes[0] === 240);
    if (this.chasePending || lostState) {
      const chasePosition = this.chasePending ? this.config.position : position;
      this.chasePending = false;
      const sent = new Set(messages.map((m) => m.bytes.join(",")));
      const chase = computeChaseState(this.cues, chasePosition)
        .filter((m) => !sent.has(m.bytes.join(",")))
        .map((m) => ({ bytes: m.bytes, due: Math.max(now, this.config.origin + chasePosition * 1000 - CHASE_LEAD_MS), label: "Chase state", time: m.time }));
      messages.unshift(...chase);
    }
    if (messages.length || dropped.length) this.emit({ type: "batch", messages, ...(dropped.length ? { dropped } : {}) });
  }
}
