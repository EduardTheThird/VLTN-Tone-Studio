import type { ClockGrid } from "./beat-clock";
import type { PreparationSequence } from "./preparation-sequence";
import { StemPlayer } from "@/song/stems/player";
import type { SpeedSettings } from "./speed";
import type { Cue } from "@/song/performance/chart";
import type { TriggerCc } from "@/song/performance/midi-chase";
import { configuredPedals, usePedalLibrary } from "@/song/performance/pedal-library";
import type { PreparationSettings } from "./start-preparation";
import type { SchedulerJump } from "@/song/performance/midi-scheduler";
import type { TimecodeSetting } from "@/song/performance/timecode";
import type { Section, SectionLive } from "@/song/performance/sections";
import type { PortChoice } from "@/song/performance/midi-configuration";
import type { BleMidiConnection } from "@/bluetooth/connection";
import type { ActionHost, ViewHost } from "./actions";
import type { Binding } from "./bindings";
import type { PerformanceSession } from "./session";

export type MidiOutput = MIDIOutput | BleMidiConnection;

export const BLUETOOTH_PORT_ID = "bluetooth-midi";

export interface LateNotice {
  dropped: number;
  position: number;
  resynced: boolean;
  at: number;
}

/** What one song carries to the next: the access, ports and input, and whether the outputs were armed. */
export interface CarriedMidi {
  access: MIDIAccess | null;
  portId: string;
  inputId: string;
  armed: boolean;
  output: unknown;
}

/**
 * The MIDI a song takes from the one before it. Arming carries only into a playlist that is playing, so a song loaded by hand
 * starts disarmed and its cues wait for the user to arm them.
 */
export function carriedInto(midi: CarriedMidi | null, next: { queued: boolean; playlistPlaying: boolean }): CarriedMidi | null {
  if (!midi) return null;
  return { ...midi, armed: midi.armed && next.queued && next.playlistPlaying };
}

/** The lead-in before a start: whole bars of count-in, beats of pre-roll, and a delay before either (seconds). */
export interface Timing {
  countInBars: number;
  beatsPerBar: number;
  preRollBeats: number;
  startDelay: number;
}

export const NO_TIMING: Timing = { countInBars: 0, beatsPerBar: 4, preRollBeats: 0, startDelay: 0 };

export interface SessionState {
  player: StemPlayer | null;
  playing: boolean;
  access: MIDIAccess | null;
  portId: string;
  inputId: string;
  /** Arming belongs to this exact connection object, never just a reusable port ID. */
  armedOutput: MidiOutput | null;
  /** Whether the session armed itself from the remembered Send cues preference, rather than the user arming it just now. */
  armedByPreference: boolean;
  clock: boolean;
  /** A usable grid when the song follows its beats. */
  clockGrid: ClockGrid | null;
  midiStatus: string;
  error: string;
  lateNotice: LateNotice | null;
  portsVersion: number;
  /** Inputs owned by other parts of the app, pushed in with `update()`. */
  bluetooth: BleMidiConnection | null;
  tempoOnStart: boolean;
  tempoChannel: number;
  savedOutput: PortChoice | null;
  savedInput: PortChoice | null;
  queued: boolean;
  playlistPlaying: boolean;
  busy: boolean;
  cues: Cue[];
  parseError: string;
  bpm: number;
  /** Quarter-note tempo resolved by the managed rhythm plan. Null uses the ordinary song tempo. */
  rhythmTempo: number | null;
  rhythmRestart: boolean;
  preparationSettings: PreparationSettings | null;
  preparing: { label: string; until: number; commands: number; step?: number } | null;
  preparationPlan: PreparationSequence | null;
  pedalsReady: boolean;
  preparationOnceUsed: number;
  lastTempo: { bpm: number; channel: number; output: string } | null;
  timing: Timing;
  /** A start is waiting: the start delay, or the scheduler worker. A Play press cancels it. */
  starting: boolean;
  /** The song's sections, from its options */
  sections: Section[];
  /** What the performer has asked for about sections since the song started */
  sectionLive: SectionLive;
  /** The song's speed and pitch, as the player plays them */
  speed: SpeedSettings;
  /** Tracks rendered out of the tracks in the render, while a render is being built */
  rendering: { done: number; total: number } | null;
  /** The decided boundary that is still to take effect: a jump (to `target`) or a pause, and the song time it lands at */
  sectionNext: { kind: "jump" | "pause"; target: string | null; at: number } | null;
  /** What each MIDI message or key runs. Saved with the MIDI configuration. */
  bindings: Binding[];
  /** MIDI timecode: on or off, the rate, and the song's offset (see timecode.ts). Timecode replaces app clock while it is on. */
  timecode: TimecodeSetting;
}

export type SessionInputs = Pick<
  SessionState,
  "bluetooth" | "tempoOnStart" | "tempoChannel" | "savedOutput" | "savedInput" | "queued" | "playlistPlaying" | "busy" | "cues" | "parseError" | "bpm"
> &
  Partial<Pick<SessionState, "timing" | "sections" | "bindings" | "timecode" | "rhythmTempo" | "preparationSettings" | "clockGrid">>;

/** The actions the session carries out itself: transport, songs, sections and arming. The screen supplies the rest (see `setView`). */
export type SessionHost = Omit<ActionHost, keyof ViewHost>;

/** Shown when the remembered output is back and Send cues arms it again. */
export const REARMED_STATUS = "MIDI output reconnected. Send cues is on.";

/** Shown after a sleep re-enumerated the port and the session was armed: the cues must be armed again to send. */
export const RECONNECTED_STATUS = "MIDI output reconnected after sleep. Send cues to arm again.";

/**
 * A port that can no longer take messages. Only a port whose state is not "connected" is dead. A Web MIDI output starts with
 * connection "closed" until it is opened or first sent to, and sending opens it, so that is not a dead port.
 */
export function portIsDead(output: MidiOutput | undefined): boolean {
  return !output || output.state !== "connected";
}

export function selectOutput(s: Pick<SessionState, "portId" | "bluetooth" | "access">): MidiOutput | undefined {
  return (s.portId === BLUETOOTH_PORT_ID ? s.bluetooth : s.access?.outputs.get(s.portId)) ?? undefined;
}

export function selectArmed(s: Pick<SessionState, "portId" | "bluetooth" | "access" | "armedOutput">): boolean {
  const output = selectOutput(s);
  return !!s.armedOutput && s.armedOutput === output && output?.state === "connected";
}

/**
 * A boundary the session has decided and is waiting for. `before` is the live state it was decided from, put back if the decision
 * is cancelled. `schedule` is what the MIDI scheduler was told, so it can be told again if the scheduler restarts.
 */
export interface SectionPlan {
  kind: "continue" | "pause" | "jump";
  /** Audio time at which the boundary takes effect */
  ctxAt: number;
  before: SectionLive;
  /** The sections the decision was made on. Editing them drops the decision. */
  sections: Section[];
  schedule: { cap: number; jump: SchedulerJump | null } | null;
}

/** The values `panic` needs, captured when a stop is scheduled rather than when it runs. */
export interface PanicContext {
  output: MidiOutput | undefined;
  armed: boolean;
  clock: boolean;
}

export interface Effect {
  deps: (s: SessionState) => unknown[];
  run: (s: SessionState) => void | (() => void);
  last?: unknown[];
  cleanup?: void | (() => void);
}

export interface SessionOptions {
  initial: SessionInputs;
  /** Arming handed over by the previous playlist song. */
  carried: CarriedMidi | null;
  initialClock: boolean;
}

export function parseOptions(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The trigger controllers of every configured pedal, which a chase never replays (see midi-chase.ts). */
export function chaseTriggers(): TriggerCc[] {
  return configuredPedals(usePedalLibrary.getState()).flatMap((pedal) => pedal.triggers);
}

/**
 * What a part of the session may use of the session: its state, the shared fields and the methods other parts and the transport
 * provide. The parts see only this, never the session class itself.
 */
export type SessionCore = Pick<
  PerformanceSession,
  | "armRemembered"
  | "armed"
  | "autoplayPending"
  | "bandExtras"
  | "baseStems"
  | "batch"
  | "batchDepth"
  | "behaviourOf"
  | "cancelPendingStart"
  | "cancelSectionJump"
  | "chained"
  | "clockOf"
  | "context"
  | "countInMs"
  | "crossfadeNext"
  | "deadOutput"
  | "degraded"
  | "disarm"
  | "dropChained"
  | "dropSectionPlan"
  | "drummerCounts"
  | "endingIntoSet"
  | "exitBars"
  | "fail"
  | "flushing"
  | "handingOver"
  | "incomingTail"
  | "invalidatePreparation"
  | "joining"
  | "jumpSectionNow"
  | "loadedSongId"
  | "locked"
  | "openMidi"
  | "openingPrepared"
  | "output"
  | "panic"
  | "panicAndDisarm"
  | "passing"
  | "pause"
  | "pendingRelease"
  | "pendingRender"
  | "planNext"
  | "play"
  | "playCues"
  | "playPending"
  | "playRequest"
  | "playedRecorded"
  | "portLost"
  | "preparationHistory"
  | "preparePedals"
  | "prepared"
  | "previousBluetooth"
  | "readySetup"
  | "readyWorker"
  | "receiveMidi"
  | "releaseSectionLoop"
  | "rememberedFor"
  | "remote"
  | "renderRequest"
  | "renderSwap"
  | "renders"
  | "restartingLoop"
  | "saveResume"
  | "scheduler"
  | "section"
  | "sectionAt"
  | "sectionOrder"
  | "seek"
  | "sendCues"
  | "sendPerformance"
  | "sendPlan"
  | "sendTriggers"
  | "set"
  | "setArmed"
  | "setInputId"
  | "setMidiStatus"
  | "setPortId"
  | "setSpeed"
  | "shown"
  | "skip"
  | "songSettingsKey"
  | "speedPreparation"
  | "startPlay"
  | "startPlayback"
  | "startPosition"
  | "startTempo"
  | "state"
  | "stepSection"
  | "stoppedOn"
  | "store"
  | "tapSection"
  | "tempoMessages"
  | "terminateWorker"
  | "tickSections"
  | "toggleSectionLoop"
  | "transportAt"
  | "triggerBytes"
  | "unloadCurrentSong"
  | "view"
  | "wirePlayer"
>;
