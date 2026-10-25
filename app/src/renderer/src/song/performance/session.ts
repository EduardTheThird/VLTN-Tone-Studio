import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { StemPlayer, type Lead } from "@/song/stems/player";
import { sharedPlaybackEngine } from "@/song/audio/playback-engine";
import { useSong } from "@/song/store";
import { useSongLibrary, type PreparedSong } from "@/song/library";
import { useOutputSettings } from "@/song/audio/output-settings";
import { showToast } from "@/app/notify";
import type { SongSource, Stems } from "@/song/types";
import type { Cue } from "@/song/performance/chart";
import { setClockPosition, startPlaybackClock } from "@/song/performance/playback-clock";
import { beatSeconds, countInBeats, preRollStart } from "@/song/performance/rhythm";
import { HANDOVER_LEAD_S, planTransition, type Transition } from "@/song/performance/transition";
import { readCrossfade } from "@/song/performance/crossfade";
import { getSetting, performanceKey } from "@/song/performance/settings";
import { playerShape, shapeFromOptions } from "@/song/performance/song-shape";
import { startMidiScheduler, prepareMidiScheduler, midiNow, type SchedulerDegraded } from "@/song/performance/midi-scheduler-client";
import { BLUETOOTH_LOOKAHEAD, SYSTEM_LOOKAHEAD, type SchedulerJump } from "@/song/performance/midi-scheduler";
import {
  armJump,
  cancelJump,
  clampSections,
  DECISION_LEAD_S,
  immediateJump,
  NO_LIVE,
  nextBoundary,
  releaseLoop,
  sectionIndexAt,
  sortedSections,
  startLoop,
  type Section,
  type SectionBoundary,
  type SectionLive,
} from "@/song/performance/sections";
import { useMidiDiagnostics } from "@/song/performance/midi-diagnostics";
import { rememberedPort, type PortChoice } from "@/song/performance/midi-configuration";
import type { BleMidiConnection } from "@/bluetooth/connection";

/*
 * Everything that keeps a song's MIDI cues, transport and remote input running during a performance, without React.
 * The component tree renders `state` and calls the methods; it never owns the scheduler, the arming binding or the
 * panic path. Timing-critical lifecycle code lives in `effects`, which mirror the dependency-array semantics the
 * panel used before: each effect re-runs when one of its inputs changes and its cleanup runs first.
 */

export type MidiOutput = MIDIOutput | BleMidiConnection;
export const BLUETOOTH_PORT_ID = "bluetooth-midi";

/** How often the session checks whether the next playlist song can be chained onto this one */
const CHAIN_CHECK_MS = 250;
/** The next song is chained this far before its join, so that a pause in between has time to undo it */
const CHAIN_AHEAD_S = 5;

/** The next playlist song, started on the current song's clock and waiting for the session to take it over */
interface Chained {
  id: string;
  player: StemPlayer;
  /** The count-in before the next song's audio, in ms. Its start tempo is due at the start of the count-in. */
  countInMs: number;
  /** Takes the next song off the session's outputs and events */
  unwire: () => void;
}

export interface LateNotice {
  dropped: number;
  position: number;
  resynced: boolean;
  at: number;
}

/** What a playlist carries from one song to the next so arming survives the transition. */
export interface CarriedMidi {
  access: MIDIAccess | null;
  portId: string;
  inputId: string;
  armed: boolean;
  output: unknown;
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
  clock: boolean;
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
  timing: Timing;
  /** A start is waiting: the start delay, or the scheduler worker. A Play press cancels it. */
  starting: boolean;
  /** The song's sections, from its options */
  sections: Section[];
  /** What the performer has asked for about sections since the song started */
  sectionLive: SectionLive;
  /** The decided boundary that is still to take effect: a jump (to `target`) or a pause, and the song time it lands at */
  sectionNext: { kind: "jump" | "pause"; target: string | null; at: number } | null;
}

export type SessionInputs = Pick<
  SessionState,
  "bluetooth" | "tempoOnStart" | "tempoChannel" | "savedOutput" | "savedInput" | "queued" | "playlistPlaying" | "busy" | "cues" | "parseError" | "bpm"
> &
  Partial<Pick<SessionState, "timing" | "sections">>;

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
interface SectionPlan {
  kind: "continue" | "pause" | "jump";
  /** Audio time at which the boundary takes effect */
  ctxAt: number;
  before: SectionLive;
  /** The sections the decision was made on. Editing them drops the decision. */
  sections: Section[];
  schedule: { cap: number; jump: SchedulerJump | null } | null;
}

/** The values `panic` needs, captured when a stop is scheduled rather than when it runs. */
interface PanicContext {
  output: MidiOutput | undefined;
  armed: boolean;
  clock: boolean;
}

interface Effect {
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

export class PerformanceSession {
  readonly store: StoreApi<SessionState>;
  private effects: Effect[];
  /** Stage mode: seeking is refused however it is requested. */
  locked = false;
  private bound = false;
  private flushing = false;
  private dirty = false;
  private batchDepth = 0;
  private unsubscribe: (() => void) | null = null;
  private scheduler: ReturnType<typeof startMidiScheduler> | null = null;
  private prepared: ReturnType<typeof prepareMidiScheduler> | null = null;
  private readyWorker: Worker | null = null;
  private clearedOutput: MidiOutput | undefined;
  private playRequest = 0;
  private playPending = false;
  private startTempo: number[][] | null = null;
  private startPosition: number | null = null;
  /** The count-in before the audio of the current start, in ms. The start tempo is due at its beginning. */
  private countInMs = 0;
  private cancelDelay: (() => void) | null = null;
  private noteChannels = new Set<number>();
  private previousBluetooth: BleMidiConnection | null;
  private section: SectionPlan | null = null;
  /** Whether the scheduler was last given a hold, so that clearing it is sent once */
  private planSent = false;
  /** The next playlist song, once it has been started on this song's clock */
  private chained: Chained | null = null;
  private handoverTimer: ReturnType<typeof setTimeout> | null = null;
  private clampedSections: { source: Section[]; start: number; end: number; value: Section[] } | null = null;
  /** The id of the song being handed over to, from the moment the library moves on until the session adopts it */
  private handingOver: string | null = null;

  constructor(options: SessionOptions) {
    const { initial, carried } = options;
    const bluetooth = initial.bluetooth;
    const portId =
      carried?.portId ?? (initial.savedOutput?.transport === "system" ? initial.savedOutput.id : bluetooth?.state === "connected" ? bluetooth.id : "");
    const access = carried?.access ?? null;
    const first = selectOutput({ portId, bluetooth, access });
    this.previousBluetooth = bluetooth;
    this.store = createStore<SessionState>(() => ({
      player: null,
      playing: false,
      access,
      portId,
      inputId: carried?.inputId ?? (initial.savedInput?.transport === "bluetooth" ? BLUETOOTH_PORT_ID : ""),
      armedOutput: carried?.armed && carried.output === first && first?.state === "connected" ? first : null,
      clock: options.initialClock,
      midiStatus: "",
      error: "",
      lateNotice: null,
      portsVersion: 0,
      timing: NO_TIMING,
      starting: false,
      sections: [],
      sectionLive: NO_LIVE,
      sectionNext: null,
      ...initial,
    }));
    this.effects = this.createEffects();
  }

  get state(): SessionState {
    return this.store.getState();
  }

  /** The audio engine's position, for callers that need it outside of rendering. */
  get position(): number {
    return this.state.player?.position ?? 0;
  }

  get output(): MidiOutput | undefined {
    return selectOutput(this.state);
  }

  get armed(): boolean {
    return selectArmed(this.state);
  }

  // ---- lifecycle -----------------------------------------------------------------------------------------------

  /**
   * Creates the audio player for the song, or takes over the next playlist song that is already playing on this clock. Returns the
   * cleanup, which leaves the playlist running if the source is merely replaced.
   */
  loadSong(source: SongSource | null, stems: Stems | null): () => void {
    if (!source) return () => {};
    const handover = this.takeHandover(source);
    const shape = playerShape(shapeFromOptions(getSetting(performanceKey(source), ":options")));
    const player = handover?.player ?? new StemPlayer(stems ?? { other: source.audio }, sharedPlaybackEngine(), shape);
    const stopWiring = handover ? handover.unwire : this.wirePlayer(player, source);
    if (handover) {
      this.startHandover(handover);
      // Playback carries on: the song is already running, so the transport stays as it is.
      this.batch(() => this.set({ player }));
    } else {
      this.batch(() => {
        this.set({ player, playing: false });
        setClockPosition(0);
      });
    }
    return () => {
      stopWiring();
      // A hand-over keeps the worker, which the next song's scheduler is about to use.
      if (this.handingOver === null) {
        this.cancelPendingStart();
        this.terminateWorker();
      }
      void player.dispose();
      // Leaving Performance pauses the set; replacing its source during advance does not.
      if (useSong.getState().source === source && useSongLibrary.getState().playlistPlaying) useSongLibrary.getState().pausePlaylist();
    };
  }

  /** Connects a song's player to the outputs and to the session. Returns the function that disconnects it. */
  private wirePlayer(player: StemPlayer, source: SongSource): () => void {
    player.onOutputWarning = (message) => showToast({ tone: "fault", title: "Audio output changed", body: message });
    // Outputs are applied now, and again whenever the saved outputs change. Playback keeps going through either.
    const applyOutputs = () => void player.setOutputs(useOutputSettings.getState().config);
    applyOutputs();
    const stopOutputs = useOutputSettings.subscribe((state, previous) => {
      if (state.config !== previous.config) applyOutputs();
    });
    player.onEnded = () => {
      // A song the session has let go of has nothing left to say to it.
      if (this.state.player !== player) return;
      // The next song is already playing on this clock, so the hand-over is taken now rather than at its start.
      if (this.chained) {
        this.handOver();
        return;
      }
      // A looping song reaches its end only if its loop pass was missed. It then starts again from its trimmed start.
      if (player.behaviour === "loop") {
        this.set({ playing: false });
        setClockPosition(player.start);
        void player.seek(player.start).then(() => this.play());
        return;
      }
      this.batch(() => {
        this.set({ playing: false });
        setClockPosition(player.duration);
        const library = useSongLibrary.getState();
        // A song set to stop the playlist ends it here, so the next song does not start on its own.
        if (player.behaviour === "stop") {
          library.pausePlaylist();
          return;
        }
        if (library.playlistPlaying && library.queue[library.position] === source.libraryId) void library.advancePlaylist();
      });
    };
    return stopOutputs;
  }

  /** The chained song, when `source` is the one being handed over to. Any other chained song is dropped. */
  private takeHandover(source: SongSource): Chained | null {
    const chained = this.chained;
    const handingOver = this.handingOver;
    this.chained = null;
    this.handingOver = null;
    this.clearHandoverTimer();
    if (chained && handingOver === source.libraryId && chained.id === source.libraryId) return chained;
    // The library owns a prepared song until it is taken over, so only its hook-up is undone here.
    chained?.unwire();
    return null;
  }

  /** Sets the next song's start: its cues from its own start, and its tempo message at the start of its count-in. */
  private startHandover(chained: Chained): void {
    const armed = this.armed;
    try {
      this.startTempo = this.tempoMessages(armed, this.output);
    } catch (e) {
      this.fail(e);
      this.startTempo = null;
    }
    this.startPosition = armed ? chained.player.start : null;
    this.countInMs = chained.countInMs;
  }

  /** Starts the effects. Safe to call again after `dispose()`. */
  bind() {
    this.bound = true;
    this.unsubscribe = this.store.subscribe(() => this.flush());
    this.flush();
  }

  /** Runs every effect cleanup, which stops the scheduler and sends the final panic. */
  dispose() {
    this.dropSectionPlan();
    this.dropChained();
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const effect of this.effects) {
      effect.cleanup?.();
      effect.cleanup = undefined;
      effect.last = undefined;
    }
    this.bound = false;
  }

  /** Pushes values owned by other stores. Only changed values cause effects to re-run. */
  update(inputs: Partial<SessionInputs>) {
    const changed = (Object.keys(inputs) as (keyof SessionInputs)[]).some((key) => !Object.is(this.state[key], inputs[key]));
    if (changed) this.set(inputs);
  }

  // ---- state helpers -------------------------------------------------------------------------------------------

  private set(patch: Partial<SessionState>) {
    this.store.setState(patch);
  }

  /** Several state changes made together run the effects once afterwards, as one render did. */
  private batch<T>(fn: () => T): T {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      this.batchDepth--;
      this.flush();
    }
  }

  private flush() {
    if (!this.bound || this.batchDepth > 0) return;
    if (this.flushing) {
      this.dirty = true;
      return;
    }
    this.flushing = true;
    try {
      do {
        this.dirty = false;
        for (const effect of this.effects) {
          const deps = effect.deps(this.state);
          if (effect.last && deps.every((value, i) => Object.is(value, effect.last?.[i]))) continue;
          effect.cleanup?.();
          effect.last = deps;
          try {
            effect.cleanup = effect.run(this.state);
          } catch (e) {
            // An effect must never surface as a failed Play; report it and keep the others running.
            useMidiDiagnostics.getState().fault(String(e));
            this.fail(e);
          }
        }
      } while (this.dirty);
    } finally {
      this.flushing = false;
    }
  }

  private context(): PanicContext {
    return { output: this.output, armed: this.armed, clock: this.state.clock };
  }

  private terminateWorker() {
    this.readyWorker?.terminate();
    this.readyWorker = null;
  }

  fail = (e: unknown) => this.set({ error: e instanceof Error ? e.message : String(e) });

  setMidiStatus = (midiStatus: string) => this.set({ midiStatus });
  setClock = (clock: boolean) => this.set({ clock });
  setPortId = (portId: string) => this.set({ portId });
  setInputId = (inputId: string) => this.set({ inputId });
  setAccess = (access: MIDIAccess | null) => this.set({ access });
  setArmed = (value: boolean) => this.set({ armedOutput: value ? (this.output ?? null) : null });

  /** Waits out the start delay. Cancelling resolves the wait at once. */
  private waitStartDelay(seconds: number): Promise<void> {
    if (seconds <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.cancelDelay = null;
        resolve();
      }, seconds * 1000);
      this.cancelDelay = () => {
        clearTimeout(timer);
        this.cancelDelay = null;
        resolve();
      };
    });
  }

  /** Invalidates the pending start (if any) so it does nothing when it resumes. */
  private cancelPendingStart() {
    this.playRequest++;
    this.playPending = false;
    this.set({ starting: false });
    const cancel = this.cancelDelay;
    this.cancelDelay = null;
    cancel?.();
  }

  /** Cancels a start that is still waiting (the start delay, or a worker). A second Play press does this. Once audio has begun it does nothing. */
  cancelStart = () => {
    if (this.playPending) this.cancelPendingStart();
  };

  /** Stops the scheduler and releases anything this session started. A second call for one stop does nothing. */
  panic = (context: PanicContext = this.context()) => {
    this.startPosition = null;
    this.scheduler?.stop();
    this.scheduler = null;
    const { output, armed, clock } = context;
    if (!output || this.clearedOutput === output) return;
    // Pause handlers and lifecycle cleanup can both run for one stop.
    // A second clear would cancel the BLE note releases queued by the first.
    this.clearedOutput = output;
    try {
      (output as { clear?: () => void }).clear?.();
      if (!armed || output.state !== "connected") {
        this.noteChannels.clear();
        return;
      }
      // CC64 is sustain on synths but looper Stop on the GP-150 / GP-180. Release only
      // channels where this session actually queued note messages.
      for (const ch of this.noteChannels)
        for (const bytes of [
          [176 + ch, 64, 0],
          [176 + ch, 123, 0],
        ]) {
          output.send(bytes);
          this.recordQueued(bytes, undefined, "Note cleanup");
        }
      this.noteChannels.clear();
      if (clock) {
        output.send([252]);
        this.recordQueued([252], undefined, "Transport Stop");
      }
    } catch (e) {
      useMidiDiagnostics.getState().fault(String(e));
      this.fail(e);
    }
  };

  private recordQueued(bytes: number[], timestamp?: number, label = "Manual / transport") {
    const queued = midiNow(),
      intended = (timestamp ?? performance.now()) + performance.timeOrigin;
    useMidiDiagnostics.getState().record({ label, intended, queued, lateMs: Math.max(0, queued - intended), bytes });
  }

  sendPerformance = (bytes: number[], timestamp?: number, label = "Manual / transport") => {
    this.clearedOutput = undefined;
    this.output?.send(bytes, timestamp);
    this.recordQueued(bytes, timestamp, label);
    if ((bytes[0] & 240) === 144 || (bytes[0] & 240) === 128) this.noteChannels.add(bytes[0] & 15);
  };

  private degraded = (event: SchedulerDegraded) => {
    const diagnostics = useMidiDiagnostics.getState(),
      now = midiNow();
    if (event.resynced) diagnostics.resync();
    if (event.dropped.length)
      diagnostics.drop(event.dropped.map((m) => ({ label: m.label, intended: m.due, queued: now, lateMs: Math.max(0, now - m.due), bytes: m.bytes })));
    // Events from one stall arrive separately (resync, then drops); show them as one notice.
    const n = this.state.lateNotice;
    const recent = n !== null && now - n.at < 2000;
    this.set({
      lateNotice: {
        dropped: (recent ? n.dropped : 0) + event.dropped.length,
        position: event.position,
        resynced: (recent && n.resynced) || event.resynced,
        at: now,
      },
    });
  };

  // ---- transport -----------------------------------------------------------------------------------------------

  pause = () => {
    this.batch(() => {
      const { player } = this.state;
      const wasRunning = player?.isPlaying || this.playPending;
      this.cancelPendingStart();
      this.dropSectionPlan();
      this.dropChained();
      player?.pause();
      this.set({ playing: false });
      // A pedal/THRU path can echo our Stop back into the selected input.
      // Repeated Stop while already stopped must not transmit another Stop.
      if (wasRunning) this.panic();
      if (this.state.playlistPlaying) useSongLibrary.getState().pausePlaylist();
    });
  };

  play = async () => {
    const { player } = this.state;
    if (!player || this.state.parseError || this.playPending || player.isPlaying) return;
    const request = ++this.playRequest;
    this.playPending = true;
    this.set({ starting: true });
    const armed = this.armed,
      output = this.output;
    try {
      const { bpm, timing } = this.state;
      const tempoMessages = this.tempoMessages(armed, output);
      if (armed) {
        const warm = this.prepared ?? prepareMidiScheduler();
        this.prepared = warm;
        await warm.ready;
        if (request !== this.playRequest) return;
        this.readyWorker = warm.worker;
        this.prepared = null;
      }
      await this.waitStartDelay(timing.startDelay);
      if (request !== this.playRequest) return;
      const requestedPosition = player.position >= player.duration ? 0 : Math.max(0, player.position);
      // The count-in is clicked before the audio starts, so it begins with the tempo message.
      const countIn = countInBeats(timing.countInBars, timing.beatsPerBar);
      this.countInMs = bpm > 0 ? countIn * beatSeconds(bpm) * 1000 : 0;
      await player.play({ bpm, countInBeats: countIn, preRollBeats: timing.preRollBeats });
      if (request !== this.playRequest) {
        player.pause();
        this.terminateWorker();
        return;
      }
      this.startTempo = tempoMessages;
      // Cues start from where the audio really starts: a pre-roll puts that before the requested position.
      this.startPosition = armed ? preRollStart(requestedPosition, timing.preRollBeats, bpm) : null;
      this.set({ playing: true });
    } catch (e) {
      this.terminateWorker();
      if (request === this.playRequest) {
        this.batch(() => {
          if (armed) {
            useMidiDiagnostics.getState().fault(String(e));
            this.setArmed(false);
            if (this.state.queued) useSongLibrary.getState().rememberMidi(null);
          }
          this.fail(e);
          if (this.state.playlistPlaying) useSongLibrary.getState().pausePlaylist();
        });
      }
    } finally {
      if (request === this.playRequest) {
        this.playPending = false;
        this.set({ starting: false });
      }
    }
  };

  seek = async (value: number) => {
    if (this.locked) return;
    this.pause();
    await this.state.player?.seek(value);
    setClockPosition(value);
  };

  /** Play, or start the whole playlist when the queue is at its end. */
  startPlayback = () => {
    const library = useSongLibrary.getState();
    const { player, queued } = this.state;
    if (queued && library.queue.length > 1) {
      if (player && player.position >= player.duration) {
        if (library.position === library.queue.length - 1) void library.playPlaylist(library.queue);
        else {
          library.resumePlaylist();
          void library.advancePlaylist();
        }
        return;
      }
      library.resumePlaylist();
    }
    void this.play();
  };

  skip = (offset: number) => {
    this.batch(() => {
      this.cancelPendingStart();
      this.dropSectionPlan();
      this.dropChained();
      this.state.player?.pause();
      this.set({ playing: false });
      this.panic();
      void useSongLibrary.getState().skipPlaylist(offset);
    });
  };

  /** The one-time tempo message a start sends, or null when it sends none. Throws when the tempo is out of range. */
  private tempoMessages(armed: boolean, output: MidiOutput | undefined): number[][] | null {
    const { tempoOnStart, tempoChannel, bpm } = this.state;
    if (!armed || !tempoOnStart || output?.state !== "connected") return null;
    if (bpm < 40 || bpm > 300) throw new Error("GP-150 / GP-180 one-time tempo supports 40–300 BPM.");
    const tempo = Math.round(bpm),
      status = 0xb0 + tempoChannel - 1;
    return [
      [status, 73, tempo >> 7],
      [status, 74, tempo & 127],
    ];
  }

  /** Crossfades into the next playlist song now. Returns false when no next song is ready, or a join is already planned. */
  crossfadeNext = (): boolean => {
    const { player, queued, playlistPlaying } = this.state;
    const next = useSongLibrary.getState().preparedNext();
    if (!player?.isPlaying || this.chained || !queued || !playlistPlaying || !next) return false;
    const countIn = countInBeats(this.state.timing.countInBars, this.state.timing.beatsPerBar);
    const plan = planTransition({
      now: player.audioNow,
      songEnd: player.audioTimeOf(player.duration),
      crossfade: readCrossfade(),
      ready: true,
      countIn: countIn > 0,
      manual: true,
    });
    if (plan.kind === "gap") return false;
    this.startChain(next, plan, countIn);
    return true;
  };

  /** Chains the next playlist song onto this one once its join is close, so the two play on one clock. Checked until it is chained. */
  private planNext(): void {
    const { player, queued, playlistPlaying } = this.state;
    // A song set to stop, or to loop, does not hand over to the next one.
    if (!player?.isPlaying || player.behaviour !== "next" || this.chained || !queued || !playlistPlaying) return;
    const next = useSongLibrary.getState().preparedNext();
    if (!next) return;
    const now = player.audioNow;
    const countIn = countInBeats(this.state.timing.countInBars, this.state.timing.beatsPerBar);
    const plan = planTransition({
      now,
      songEnd: player.audioTimeOf(player.duration),
      crossfade: readCrossfade(),
      ready: true,
      countIn: countIn > 0,
    });
    if (plan.kind === "gap" || plan.startAt - now > CHAIN_AHEAD_S) return;
    this.startChain(next, plan, countIn);
  }

  /** Starts `next` on this song's clock at the join, and arranges the hand-over HANDOVER_LEAD_S before it. */
  private startChain(next: PreparedSong, plan: Exclude<Transition, { kind: "gap" }>, countIn: number): void {
    const { player, bpm } = this.state;
    if (!player) return;
    // The next song's buffers were built when it was prepared, so the join only starts them.
    const incoming = next.player;
    const unwire = this.wirePlayer(incoming, next.source);
    const countInBeatsNow = plan.kind === "countIn" ? countIn : 0;
    const lead: Lead = { bpm, countInBeats: countInBeatsNow, preRollBeats: 0 };
    if (!player.chainNext(incoming, { startAt: plan.startAt, fadeLength: plan.fadeLength, stopAt: plan.stopAt, lead })) {
      unwire();
      return;
    }
    const countInMs = bpm > 0 ? countInBeatsNow * beatSeconds(bpm) * 1000 : 0;
    this.chained = { id: next.id, player: incoming, countInMs, unwire };
    this.clearHandoverTimer();
    this.handoverTimer = setTimeout(this.handOver, Math.max(0, (plan.startAt - HANDOVER_LEAD_S - player.audioNow) * 1000));
  }

  /**
   * Takes the chained song over: the library moves on, and the session adopts the song when the change reaches it. The song is
   * already playing, so this only moves the playlist and the outgoing song's events on.
   */
  private handOver = (): void => {
    const chained = this.chained;
    const outgoing = this.state.player;
    if (!chained || !outgoing || this.handingOver === chained.id) return;
    this.clearHandoverTimer();
    const library = useSongLibrary.getState();
    if (library.preparedNext()?.id !== chained.id) {
      this.dropChained();
      return;
    }
    outgoing.detachNext();
    this.handingOver = chained.id;
    library.advanceToPrepared(chained.id);
  };

  /** Undoes the chained song, if it has not been taken over: the outgoing song then runs to its own end. */
  private dropChained(): void {
    this.clearHandoverTimer();
    const chained = this.chained;
    if (!chained) return;
    this.chained = null;
    // The prepared song stays with the library: it is stopped here, and it can be chained again.
    this.state.player?.cancelChain();
    chained.unwire();
  }

  private clearHandoverTimer(): void {
    if (this.handoverTimer) clearTimeout(this.handoverTimer);
    this.handoverTimer = null;
  }

  /** Stop playback, release the output and disarm. */
  panicAndDisarm = () => {
    this.batch(() => {
      this.pause();
      this.panic();
      this.setArmed(false);
    });
    // After the flush: the carry effect would otherwise store the disarmed state over this reset.
    if (this.state.queued) useSongLibrary.getState().rememberMidi(null);
  };

  connectMidi = async () => {
    this.set({ midiStatus: "Opening USB / system MIDI…" });
    try {
      const next = await navigator.requestMIDIAccess({ sysex: true });
      const connectedOutputs = [...next.outputs.values()].filter((p) => p.state === "connected");
      this.set({
        access: next,
        midiStatus: connectedOutputs.length
          ? `USB / system MIDI ready: ${connectedOutputs.map((p) => p.name || p.id).join(", ")}. Select an output and enable Send cues.`
          : "USB / system MIDI is enabled, but no outputs are available. Connect the pedal and close other MIDI apps, then try again.",
      });
    } catch (e) {
      this.set({ midiStatus: "USB / system MIDI could not be opened." });
      this.fail(e);
    }
  };

  // ---- sections ------------------------------------------------------------------------------------------------

  private lookahead(): number {
    return this.state.portId === BLUETOOTH_PORT_ID ? BLUETOOTH_LOOKAHEAD : SYSTEM_LOOKAHEAD;
  }

  /** The MIDI clock time at which the audio clock reads `ctx`. Both clocks are in step while playing. */
  private clockOf(ctx: number): number {
    return midiNow() + (ctx - (this.state.player?.audioNow ?? 0)) * 1000;
  }

  /** The sections as they fall inside the part of the audio that plays: a trim cuts them. */
  private get playableSections(): Section[] {
    const { player, sections } = this.state;
    if (!player) return sections;
    const { start, duration } = player;
    // The same array while nothing changes, so a decision made on it is still recognised as current.
    const cached = this.clampedSections;
    if (cached && cached.source === sections && cached.start === start && cached.end === duration) return cached.value;
    const value = clampSections(sections, { start, end: duration });
    this.clampedSections = { source: sections, start, end: duration, value };
    return value;
  }

  /** Tells the scheduler the waiting plan. Called on each decision, and when a scheduler starts while a plan waits. */
  private sendPlan(): void {
    const schedule = this.section?.schedule ?? null;
    // Without sections there is never a plan to send or to clear, so the scheduler is not touched.
    if (!schedule && !this.planSent) return;
    this.planSent = schedule !== null;
    this.scheduler?.plan(schedule?.cap ?? null, schedule?.jump ?? null);
  }

  /** Takes a boundary decided by the planner: the audio jump is scheduled now, the MIDI schedule is held up to it. */
  private commitBoundary(boundary: SectionBoundary): void {
    const { player, sectionLive } = this.state;
    const sections = this.playableSections;
    if (!player) return;
    const { action } = boundary;
    if (action.kind === "jump") {
      const ctxAt = player.prepareJump(action.to, boundary.at);
      if (ctxAt === null) return;
      this.section = {
        kind: "jump",
        ctxAt,
        before: sectionLive,
        sections,
        schedule: { cap: boundary.at, jump: { at: this.clockOf(ctxAt), position: action.to } },
      };
    } else {
      this.section = {
        kind: action.kind,
        ctxAt: player.audioTimeOf(boundary.at),
        before: sectionLive,
        sections,
        schedule: action.kind === "pause" ? { cap: boundary.at, jump: null } : null,
      };
    }
    this.sendPlan();
    this.set({
      sectionLive: boundary.live,
      sectionNext: action.kind === "continue" ? null : { kind: action.kind, target: action.kind === "jump" ? action.target : null, at: boundary.at },
    });
  }

  /**
   * Puts back the decision that has not taken effect yet, and the live state it was made from. Returns false when a jump is already
   * too close to take effect to undo, and the jump then stands.
   */
  private cancelSectionPlan(): boolean {
    const plan = this.section;
    if (!plan) return true;
    if (plan.kind === "jump" && !this.state.player?.cancelJump()) return false;
    this.section = null;
    this.sendPlan();
    this.set({ sectionLive: plan.before, sectionNext: null });
    return true;
  }

  /** Forgets a decision because playback stopped. Any jump was dropped by the player, and the live state goes back to what it was. */
  private dropSectionPlan(): void {
    const plan = this.section;
    if (!plan) return;
    this.section = null;
    this.set({ sectionLive: plan.before, sectionNext: null });
  }

  /** Every 50 ms while playing: carries out a decision once its boundary has passed, and decides the next boundary when it is close. */
  private tickSections = (): void => {
    const { player, playing } = this.state;
    const sections = this.playableSections;
    if (!player || !playing) return;
    try {
      const plan = this.section;
      if (plan) {
        if (plan.sections !== sections) {
          this.cancelSectionPlan();
          return;
        }
        if (player.audioNow < plan.ctxAt) return;
        this.section = null;
        this.set({ sectionNext: null });
        if (plan.kind === "pause") this.pause();
        return;
      }
      if (!sections.length || player.position < 0) return;
      const boundary = nextBoundary(sections, player.position, this.state.sectionLive);
      if (boundary && boundary.at - player.position <= DECISION_LEAD_S) this.commitBoundary(boundary);
    } catch (e) {
      this.cancelSectionPlan();
      this.fail(e);
    }
  };

  /** A tap arms a jump to the section for the next boundary. While stopped it moves the playhead to the section's start instead. */
  tapSection = (id: string) => {
    const section = this.playableSections.find((s) => s.id === id);
    if (!section) return;
    if (!this.state.playing) {
      void this.state.player?.seek(section.start);
      setClockPosition(section.start);
      return;
    }
    this.cancelSectionPlan();
    this.set({ sectionLive: armJump(this.state.sectionLive, id) });
  };

  /** A second tap on the armed section: jumps now, after the MIDI lookahead, so queued cues still belong to the passage being left. */
  jumpSectionNow = (id: string) => {
    const { player, playing } = this.state;
    if (!player || !playing) {
      this.tapSection(id);
      return;
    }
    this.cancelSectionPlan();
    const boundary = immediateJump(this.playableSections, player.position + this.lookahead(), this.state.sectionLive, id);
    if (boundary) this.commitBoundary(boundary);
  };

  /** Loops a section until it is released; tapping the looping section releases it. */
  toggleSectionLoop = (id: string) => {
    this.cancelSectionPlan();
    const live = this.state.sectionLive;
    this.set({ sectionLive: live.loop === id ? releaseLoop(live, id) : startLoop(live, id) });
  };

  /** Releases the loop of the section being played, whether it was started live or is the section's own mode. */
  releaseSectionLoop = () => {
    const { player } = this.state;
    const ordered = sortedSections(this.playableSections);
    const current = player ? ordered[sectionIndexAt(ordered, player.position)] : undefined;
    if (!current) return;
    this.cancelSectionPlan();
    this.set({ sectionLive: releaseLoop(this.state.sectionLive, current.id) });
  };

  /** Cancels the armed jump. A decision already made for it is put back too, where that is still possible. */
  cancelSectionJump = () => {
    this.cancelSectionPlan();
    this.set({ sectionLive: cancelJump(this.state.sectionLive) });
  };

  // ---- effects -------------------------------------------------------------------------------------------------

  private createEffects(): Effect[] {
    const armedOf = (s: SessionState) => selectArmed(s);
    return [
      // A playlist song starts itself once it is the current one and nothing is loading.
      {
        deps: (s) => [s.player, s.queued, s.playlistPlaying, s.busy],
        run: (s) => {
          if (!s.queued || !s.playlistPlaying || s.busy || !s.player) return;
          if (s.parseError) {
            this.fail(s.parseError);
            useSongLibrary.getState().pausePlaylist();
            return;
          }
          void this.play();
        },
      },
      // Chains the next playlist song onto this one once its join is close, so that the two play on one clock.
      {
        deps: (s) => [s.player, s.playing, s.queued, s.playlistPlaying],
        run: (s) => {
          if (!s.playing || !s.player || !s.queued || !s.playlistPlaying) return;
          const timer = setInterval(() => this.planNext(), CHAIN_CHECK_MS);
          return () => clearInterval(timer);
        },
      },
      // Stopping the playlist from elsewhere stops this song.
      {
        deps: (s) => [s.playlistPlaying],
        run: (s) => {
          if (!s.playlistPlaying && s.player?.isPlaying && s.queued) {
            this.cancelPendingStart();
            this.dropSectionPlan();
            this.dropChained();
            s.player.pause();
            this.set({ playing: false });
            this.panic();
          }
        },
      },
      // Carry arming to the next playlist song.
      {
        deps: (s) => [s.queued, s.playlistPlaying, s.busy, s.access, s.portId, s.inputId, armedOf(s), selectOutput(s)],
        run: (s) => {
          if (s.queued && s.playlistPlaying && !s.busy)
            useSongLibrary.getState().rememberMidi({ access: s.access, portId: s.portId, inputId: s.inputId, armed: armedOf(s), output: selectOutput(s) });
        },
      },
      // Transport lifecycle is separate from tempo-dependent scheduling.
      {
        deps: (s) => [s.playing, armedOf(s), selectOutput(s), s.clock],
        run: (s) => {
          if (!s.playing) return;
          const context = this.context();
          if (context.armed && s.clock) {
            try {
              this.sendPerformance([(s.player?.position ?? 0) < 0.05 ? 250 : 251]);
            } catch (e) {
              this.fail(e);
              this.setArmed(false);
            }
          }
          return () => this.panic(context);
        },
      },
      // Warm the scheduler worker while armed and stopped, so Play does not wait for it.
      {
        deps: (s) => [armedOf(s), s.playing, s.player, selectOutput(s)],
        run: (s) => {
          if (!armedOf(s) || s.playing || !s.player) return;
          try {
            const warm = this.prepared ?? prepareMidiScheduler();
            this.prepared = warm;
            return () => {
              if (this.prepared === warm) {
                warm.cancel();
                this.prepared = null;
              }
            };
          } catch (e) {
            useMidiDiagnostics.getState().fault(String(e));
            this.setArmed(false);
            this.fail(e);
          }
        },
      },
      // Mirror the audio position into the display clock.
      {
        deps: (s) => [s.playing, s.player],
        run: (s) => {
          const player = s.player;
          if (!s.playing || !player) return;
          return startPlaybackClock(() => player.position);
        },
      },
      // Section boundaries: decided ahead and carried out on the audio clock while the song plays.
      {
        deps: (s) => [s.playing, s.player],
        run: (s) => {
          if (!s.playing || !s.player) return;
          const timer = setInterval(this.tickSections, 50);
          return () => clearInterval(timer);
        },
      },
      // The MIDI scheduler itself.
      {
        deps: (s) => [s.playing, s.player, armedOf(s), selectOutput(s), s.clock, s.bpm, s.cues],
        run: (s) => this.runScheduler(s),
      },
      // A USB output that goes away or is replaced disarms the session.
      {
        deps: (s) => [s.access, s.portId, s.armedOutput],
        run: (s) => {
          const access = s.access;
          if (!access) return;
          const update = () => {
            const { portId, armedOutput } = this.state;
            this.set({ portsVersion: this.state.portsVersion + 1 });
            if (
              portId !== BLUETOOTH_PORT_ID &&
              armedOutput &&
              (access.outputs.get(portId)?.state !== "connected" || access.outputs.get(portId) !== armedOutput)
            ) {
              useMidiDiagnostics.getState().fault("System MIDI output disconnected or replaced. Cues disarmed.");
              this.setArmed(false);
            }
          };
          access.addEventListener("statechange", update);
          return () => access.removeEventListener("statechange", update);
        },
      },
      // Restore remembered ports when they appear.
      {
        deps: (s) => [s.access, s.portsVersion],
        run: (s) => {
          const access = s.access;
          if (!access) return;
          if (!access.outputs.get(s.portId) && s.savedOutput?.transport === "system") {
            const saved = rememberedPort([...access.outputs.values()], s.savedOutput);
            if (saved) this.setPortId(saved.id);
          }
          if (!s.inputId && s.savedInput?.transport === "system") {
            const saved = rememberedPort([...access.inputs.values()], s.savedInput);
            if (saved) this.setInputId(saved.id);
          }
        },
      },
      // A replaced or lost Bluetooth connection disarms. This runs before the generic check below so the fault is reported.
      {
        deps: (s) => [s.bluetooth, s.portId, s.armedOutput],
        run: (s) => {
          if (this.previousBluetooth !== s.bluetooth && s.portId === BLUETOOTH_PORT_ID) {
            if (s.armedOutput && s.armedOutput === this.previousBluetooth)
              useMidiDiagnostics.getState().fault("Bluetooth output disconnected or replaced. Cues disarmed.");
            this.setArmed(false);
          }
          this.previousBluetooth = s.bluetooth;
        },
      },
      // Arming never survives a change of output object.
      {
        deps: (s) => [s.armedOutput, selectOutput(s)],
        run: (s) => {
          if (s.armedOutput && s.armedOutput !== selectOutput(s)) this.setArmed(false);
        },
      },
      // Remote transport input: Start/Continue/Stop, or CC80 >= 64 toggles playback.
      {
        deps: (s) => [s.access, s.inputId, s.bluetooth],
        run: (s) => {
          const receive = (data: Uint8Array) => {
            if (data[0] === 250 || data[0] === 251) this.startPlayback();
            if (data[0] === 252) this.pause();
            if ((data[0] & 240) === 176 && data[1] === 80 && data[2] >= 64) {
              if (this.state.player?.isPlaying) this.pause();
              else this.startPlayback();
            }
          };
          if (s.inputId === BLUETOOTH_PORT_ID) return s.bluetooth?.subscribe(receive);
          const input = s.access?.inputs.get(s.inputId);
          if (!input) return;
          const handler = (e: MIDIMessageEvent) => {
            if (e.data) receive(e.data);
          };
          input.addEventListener("midimessage", handler);
          return () => input.removeEventListener("midimessage", handler);
        },
      },
    ];
  }

  private runScheduler(s: SessionState): void | (() => void) {
    const player = s.player;
    if (!s.playing || !player) return;
    const output = selectOutput(s);
    if (!this.armed || output?.state !== "connected") {
      this.startPosition = null;
      this.startTempo = null;
      this.terminateWorker();
      return;
    }
    const context = this.context();
    const fault = (message: string) => {
      useMidiDiagnostics.getState().fault(message);
      this.batch(() => {
        this.panic(context);
        this.setArmed(false);
        this.fail(message);
        if (this.state.queued) useSongLibrary.getState().rememberMidi(null);
      });
    };
    this.set({ lateNotice: null });
    try {
      const position = player.position;
      // Select opening cues from the requested offset, not a later render.
      // Keep the live audio clock as the origin so overdue starts still fault.
      const cuePosition = this.startPosition ?? position;
      this.startPosition = null;
      const origin = midiNow() - position * 1000;
      const handle = startMidiScheduler(
        {
          cues: s.cues,
          position: cuePosition,
          duration: player.duration,
          origin,
          tempoAt: origin - this.countInMs,
          bpm: s.bpm,
          clock: s.clock,
          tempo: this.startTempo,
          lookahead: s.portId === BLUETOOTH_PORT_ID ? BLUETOOTH_LOOKAHEAD : SYSTEM_LOOKAHEAD,
        },
        (message) => {
          // A replaced output object (same port id) is never sent to; the statechange handler disarms.
          if (this.output !== output) return;
          this.sendPerformance(message.bytes, message.due - performance.timeOrigin, message.label);
        },
        fault,
        this.readyWorker ?? undefined,
        this.degraded,
      );
      this.readyWorker = null;
      this.startTempo = null;
      this.scheduler = handle;
      this.sendPlan();
      // Audio position is a checkpoint, not the scheduling clock. A missing or
      // frozen checkpoint makes the worker stop producing new batches.
      const timer = setInterval(() => handle.sync(player.position), 50);
      return () => {
        clearInterval(timer);
        handle.stop();
        if (this.scheduler === handle) this.scheduler = null;
      };
    } catch (e) {
      fault(e instanceof Error ? e.message : String(e));
    }
  }
}

/** Subscribes a component to the session state. */
export function useSession<T>(session: PerformanceSession, select: (state: SessionState) => T): T {
  return useStore(session.store, select);
}
