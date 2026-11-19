import { parseSections } from "./sections";
import { songCues } from "./song-cues";
import { midiFileFromOptions } from "./smf";
import { rhythmControlOverrides } from "./rhythm-automation";
import { pedalTempoMessages } from "./pedal-tempo";
import { preparationSequence, type PreparationSequence } from "./preparation-sequence";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { type ExitBar, type Lead, type RenderedBuffers, StemPlayer } from "@/song/stems/player";
import { isPlainSpeed, RenderQueue } from "@/song/audio/render-queue";
import { clampSpeed, DEFAULT_SPEED, effectiveBpm, speedFromOptions, speedOptions, type SpeedSettings } from "./speed";
import { sharedPlaybackEngine } from "@/song/audio/playback-engine";
import { type HandedOverSong, type PreparedSong, useSongLibrary } from "@/song/library";
import { playableStems } from "@/song/stems/playable";
import { extraKeysIn, type ExtrasPart, type LoadedExtras, loadExtras } from "@/song/band/extras";
import { parseBandSettings } from "@/song/band/arrangement";
import { countLeadSeconds, type DrummerCount } from "@/song/performance/drummer-count";
import { useNav } from "@/state/nav";
import { setStageBusy } from "@/state/stage-activity";
import { stageOperationActive } from "@/state/stage-operation";
import { clearResumePoint, saveResumePoint } from "./resume-point";
import { useResumeOffer } from "./resume-offer";
import { useOutputSettings } from "@/song/audio/output-settings";
import { showToast } from "@/app/notify";
import { host } from "@/host";
import type { SongSource, Stems } from "@/song/types";
import { type Cue, expandSectionCues, type MidiTrigger } from "@/song/performance/chart";
import { clockPosition, setClockPosition, startPlaybackClock } from "@/song/performance/playback-clock";
import { beatSeconds, countInBeats, preRollStart } from "@/song/performance/rhythm";
import { HANDOVER_LEAD_S, planTransition, type Transition } from "@/song/performance/transition";
import { readCrossfade } from "@/song/performance/crossfade";
import { ownLeadIn, readLeadInDefaults, resolveLeadIn, songCountIn, type SongCountIn } from "@/song/performance/lead-in";
import { getSetting, performanceKey, setSetting } from "@/song/performance/settings";
import { type EndBehaviour, playerShapeFromOptions } from "@/song/performance/song-shape";
import { midiNow, prepareMidiScheduler, type SchedulerDegraded, startMidiScheduler } from "@/song/performance/midi-scheduler-client";
import { CHASE_LEAD_MS, chaseTriggerSet, computeChaseState } from "@/song/performance/midi-chase";
import { usePedalLibrary } from "@/song/performance/pedal-library";
import { canStartRhythm, hasPedalRhythm, hasSavedPedalRhythm, RHYTHM_MEMORY_SETTLE_MS, RHYTHM_RESTART, rhythmMemory, rhythmMemoryKey } from "./rhythm-runtime";
import { PreparationHistory, preparationHistoryFor } from "./preparation-repeat";
import { savedPreparation } from "./start-preparation";
import { BLUETOOTH_LOOKAHEAD, type SchedulerJump, SYSTEM_LOOKAHEAD, type TimecodeTail } from "@/song/performance/midi-scheduler";
import { NO_TIMECODE, timecodeOffsetFrames } from "@/song/performance/timecode";
import {
  armJump,
  cancelJump,
  clampSections,
  DECISION_LEAD_S,
  immediateJump,
  nextBoundary,
  NO_LIVE,
  releaseLoop,
  type Section,
  type SectionBoundary,
  sectionIndexAt,
  sortedSections,
  startLoop,
} from "@/song/performance/sections";
import { useMidiDiagnostics } from "@/song/performance/midi-diagnostics";
import { rememberedPort, useMidiConfiguration } from "@/song/performance/midi-configuration";
import type { BleMidiConnection } from "@/bluetooth/connection";
import { countsAsPlayed } from "@shared/library-history";
import type { Hint, ViewHost } from "./actions";
import { defaultBindings, RemoteRouter } from "./bindings";
import {
  BLUETOOTH_PORT_ID,
  chaseTriggers,
  type Effect,
  type MidiOutput,
  NO_TIMING,
  type PanicContext,
  parseOptions,
  portIsDead,
  REARMED_STATUS,
  RECONNECTED_STATUS,
  type SectionPlan,
  selectArmed,
  selectOutput,
  type SessionInputs,
  type SessionOptions,
  type SessionState,
} from "./session-core";
import { SessionOutput } from "./session-output";
import { SessionRemote } from "./session-remote";
export { BLUETOOTH_PORT_ID, NO_TIMING, carriedInto, selectArmed, selectOutput } from "./session-core";
export type { CarriedMidi, LateNotice, MidiOutput, SessionHost, SessionInputs, SessionOptions, SessionState, Timing } from "./session-core";


/*
 * Everything that keeps a song's MIDI cues, transport and remote input running during a performance, without React.
 * The component tree renders `state` and calls the methods; it never owns the scheduler, the arming binding or the
 * panic path. Timing-critical lifecycle code lives in `effects`, which mirror the dependency-array semantics the
 * panel used before: each effect re-runs when one of its inputs changes and its cleanup runs first.
 */

/** How often the session checks whether the next playlist song can be chained onto this one */
const CHAIN_CHECK_MS = 250;
/** How often the place in the song is kept for a renderer crash while it plays (spec 120). */
const RESUME_SAVE_MS = 2000;
/** The next song is chained this far before its join, so that a pause in between has time to undo it */
const CHAIN_AHEAD_S = 5;
/** How often the playing song is checked for having reached its halfway point, to count it as played. */
const PLAYED_CHECK_MS = 1000;

const NOT_ON_SCREEN = (): Hint => "This control is not on screen.";
/** The view actions before the performance screen has supplied its own. */
const NO_VIEW: ViewHost = {
  scrollLyrics: NOT_ON_SCREEN,
  pdfOnScreen: () => false,
  fontSize: NOT_ON_SCREEN,
  toggleStage: NOT_ON_SCREEN,
  muteGroup: NOT_ON_SCREEN,
  toggleClick: NOT_ON_SCREEN,
  togglePart: NOT_ON_SCREEN,
  tap: NOT_ON_SCREEN,
};

/** A render swap waits at least this long (audio seconds) for its beat, so the MIDI schedule hears of it before it takes effect */
const RENDER_SWAP_LEAD_S = 0.3;

/**
 * A start with app clock and no count-in holds the audio back this long, so Start and the first clock pulses go out before it. The
 * scheduler starts about 100 ms after Play and anchors the pulses on the audio start. Without the hold, the pulses for that first
 * 100 ms are already overdue when it starts, and go out in one burst. With the hold they are due on time.
 */
const CLOCK_LEAD_MS = 150;

/** A song's options as an object. Anything that is not an object reads as empty. */
/** An exit bar plays this long before its bar begins at the latest, which is the margin the player needs to place it. */
const EXIT_LEAD_S = 0.4;
/** A pass that begins this long before its exit bar can still place it: the tick that does so runs every 50 ms. */
const EXIT_TICK_MARGIN_S = 0.1;

/** The exit bars of a song's generated parts, joined by section: one bar with each part's audio on the track that part plays on. */
function exitBarsOf(extras: Partial<Record<ExtrasPart, LoadedExtras>>): Record<string, ExitBar> {
  const bars: Record<string, ExitBar> = {};
  for (const loaded of Object.values(extras)) {
    for (const [id, exit] of Object.entries(loaded.extras.exits)) {
      const bar = (bars[id] ??= { from: exit.from, to: exit.to, tracks: {} });
      // Two parts' exits are of the same bar. A part whose bar is somewhere else is left out rather than played against the other.
      if (Math.abs(bar.from - exit.from) < 1e-3 && Math.abs(bar.to - exit.to) < 1e-3) bar.tracks[loaded.track] = exit.audio;
    }
  }
  return bars;
}

/**
 * Whether the app has moved off Performance. A remount on the same screen is not leaving. Only the panel's teardown asks this, and a
 * switch to another Song tab keeps the panel mounted, so it does not pause the set.
 */
export function leftPerformance(): boolean {
  const nav = useNav.getState();
  return nav.screen !== "song" || nav.param !== "performance";
}

export class PerformanceSession {
  readonly store: StoreApi<SessionState>;
  private readonly outputPart = new SessionOutput(this);
  private readonly remotePart = new SessionRemote(this);
  private effects: Effect[];
  /** Stage mode: seeking is refused however it is requested. */
  locked = false;
  /**
   * Whether the performance screen is on screen. Another Song tab hides it without stopping anything; while hidden, a key runs only the
   * transport and song actions, and any other key is left to the visible tab. MIDI and Bluetooth messages are not changed by this.
   */
  shown = true;
  private bound = false;
  flushing = false;
  private dirty = false;
  batchDepth = 0;
  unloadCurrentSong: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeResume: (() => void) | null = null;
  /** Set when the remembered system port was lost while armed. Its return re-acquires it, since the object from before is not trusted. */
  portLost = false;
  scheduler: ReturnType<typeof startMidiScheduler> | null = null;
  prepared: ReturnType<typeof prepareMidiScheduler> | null = null;
  readyWorker: Worker | null = null;
  playRequest = 0;
  playPending = false;
  startTempo: number[][] | null = null;
  preparationHistory = new PreparationHistory();
  readySetup: { player: StemPlayer; output: MidiOutput; key: string; opening: { position: number; messages: number[][] } } | null = null;
  openingPrepared: { position: number; messages: number[][] } | undefined;
  startPosition: number | null = null;
  /** The count-in before the audio of the current start, in ms. The start tempo is due at its beginning. */
  countInMs = 0;
  /** Epoch ms when the audio of a delayed start begins. Set only while a chase leads the audio; the transport byte goes out then. */
  transportAt: number | null = null;
  private cancelDelay: (() => void) | null = null;
  previousBluetooth: BleMidiConnection | null;
  section: SectionPlan | null = null;
  /** Whether the scheduler was last given a hold, so that clearing it is sent once */
  private planSent = false;
  /** The next playlist song, once it has been started on this song's clock */
  chained: HandedOverSong | null = null;
  /** The outgoing song's quarter frames up to its join, for the next scheduler this session starts. Consumed once. */
  incomingTail: TimecodeTail | null = null;
  private handoverTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether the playing song has been counted as played. Counted once per song, at its halfway point. */
  playedRecorded = false;
  private playedTimer: ReturnType<typeof setInterval> | null = null;
  private clampedSections: { source: Section[]; start: number; end: number; value: Section[] } | null = null;
  /** The id of the song being handed over to, from the moment the library moves on until the session that takes it over is set up */
  handingOver: string | null = null;
  /** Set when a hand-over starts this session's song on a set that is already running: the set's Start went out with its first song */
  joining = false;
  /** Set while a song that ends hands the set on to the next song: the set goes on, so the outgoing song sends no transport Stop */
  endingIntoSet = false;
  /** The output a transport Stop was last sent to, until a Start or Continue goes out. One stop sends one Stop, however many cleanups run. */
  stoppedOn: MidiOutput | undefined;
  /** Set while a song that missed its loop pass restarts from its start. The restart is a loop pass, so it sends no play trigger. */
  restartingLoop = false;
  /** The stems at 100%, which every render is made from */
  baseStems: Stems | null = null;
  /** The drummer's count and a vamp's exit bars of the loaded song's generated parts (band/extras.ts). Empty for a song without them. */
  bandExtras: Partial<Record<ExtrasPart, LoadedExtras>> = {};
  /** Whether the loaded song's settings ask for the drummer's count. A count rendered earlier is not played once the setting is off. */
  drummerCounts = false;
  /** The exit bar of each vamp of the loaded song, by section id: its audio for each generated track that has one (band/vamp.ts). */
  exitBars: Record<string, ExitBar> = {};
  /** A loop release that came too late for its pass to be the last: the section loops once more, then the release is taken. A section id. */
  pendingRelease: string | null = null;
  /** The settings key of the song loaded, under which its speed is stored */
  songSettingsKey = "";
  speedPreparation: Promise<void> | null = null;
  renders = new RenderQueue();
  /** Counts speed requests, so a render that a newer request has overtaken is dropped */
  renderRequest = 0;
  /** A built render waiting for the next beat of the song that is playing */
  pendingRender: RenderedBuffers | null = null;
  /** A render swap that is on its way: the song time it takes effect at, and the audio time, which is also the MIDI jump */
  renderSwap: { at: number; ctxAt: number; rate: number } | null = null;
  /** The `{midi@play}` messages of the start that the next scheduler sends. Cleared by any scheduler run, so a start sends them once. */
  startPlay: number[][] | null = null;
  /** The player whose `{midi@load}` messages were sent while armed. Disarming clears it, so arming again sends them again. */
  private loadedPlayer: StemPlayer | null = null;
  private loadedRhythmKey = "";
  private rhythmTestCleanup: (() => void) | null = null;
  /** The library id of the song loaded, when it is saved. A song trigger for this song does nothing. */
  loadedSongId: string | undefined;
  /** Set when a MIDI trigger asked for the loaded song to start: it starts once its player is ready and the library is idle */
  autoplayPending = false;
  /** Decides what each incoming MIDI message and key press runs, and recognises our own output coming back */
  readonly remote = new RemoteRouter();
  /** The view actions, which the performance screen supplies (see `setView`) */
  view: ViewHost = NO_VIEW;

  constructor(options: SessionOptions) {
    const { initial, carried } = options;
    const bluetooth = initial.bluetooth;
    // An empty carried id means nothing was carried, so the saved choice still applies to a song loaded by hand.
    const portId =
      carried?.portId || (initial.savedOutput?.transport === "system" ? initial.savedOutput.id : bluetooth?.state === "connected" ? bluetooth.id : "");
    const access = carried?.access ?? null;
    const first = selectOutput({ portId, bluetooth, access });
    this.previousBluetooth = bluetooth;
    this.store = createStore<SessionState>(() => ({
      player: null,
      playing: false,
      access,
      portId,
      inputId: carried?.inputId || (initial.savedInput?.transport === "bluetooth" ? BLUETOOTH_PORT_ID : ""),
      armedOutput: carried?.armed && carried.output === first && first?.state === "connected" ? first : null,
      armedByPreference: false,
      clock: options.initialClock,
      midiStatus: "",
      error: "",
      lateNotice: null,
      portsVersion: 0,
      rhythmTempo: null,
      rhythmRestart: false,
      preparationSettings: null,
      preparing: null,
      preparationPlan: null,
      pedalsReady: false,
      preparationOnceUsed: 0,
      lastTempo: null,
      timing: NO_TIMING,
      starting: false,
      sections: [],
      sectionLive: NO_LIVE,
      sectionNext: null,
      speed: DEFAULT_SPEED,
      rendering: null,
      bindings: defaultBindings(),
      timecode: NO_TIMECODE,
      ...initial,
    }));
    this.effects = this.createEffects();
    // The preference arms a new session for its remembered output, when that output is connected.
    if (!this.state.armedOutput && !this.armRemembered() && portId !== BLUETOOTH_PORT_ID && this.rememberedFor(portId) && access) this.portLost = true;
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
    const handover = this.claimHandover(source);
    if (!source) return () => {};
    this.preparationHistory = preparationHistoryFor(source.audio);
    this.set({ preparationOnceUsed: this.preparationHistory.size });
    this.loadedSongId = source.libraryId;
    this.playedRecorded = false;
    this.autoplayPending = useSongLibrary.getState().takeAutoplay(source.libraryId);
    const options = getSetting(performanceKey(source), ":options");
    const shape = playerShapeFromOptions(options);
    const speed = speedFromOptions(options);
    const saved = parseOptions(options);
    this.baseStems = playableStems(stems, source.audio, extraKeysIn(saved));
    this.bandExtras = loadExtras(saved, stems);
    this.drummerCounts = parseBandSettings(saved.band).countIn.bars > 0;
    this.exitBars = exitBarsOf(this.bandExtras);
    this.pendingRelease = null;
    this.songSettingsKey = performanceKey(source);
    this.renders.clear();
    this.pendingRender = null;
    this.renderSwap = null;
    const player = handover?.player ?? new StemPlayer(this.baseStems, sharedPlaybackEngine(), shape, "now", 1, { sharePcm: true });
    // The song is now the playing entry, so its end behaviour is the entry's override, when it has one.
    player.setEndBehaviour(this.behaviourOf(player));
    const stopWiring = this.wirePlayer(player, source);
    if (handover) {
      this.startHandover(handover);
      // Playback carries on: the song is already running, so the transport goes on as it was.
      this.batch(() => this.set({ player, playing: true, speed }));
    } else {
      this.batch(() => {
        this.set({ player, playing: false, speed, rhythmRestart: false });
        setClockPosition(0);
      });
      // A song saved at another speed is rendered now. It plays at 100% until its render is in place.
      this.speedPreparation = !isPlainSpeed(speed) ? this.renderSpeed(speed) : null;
    }
    this.playedTimer = setInterval(this.checkPlayed, PLAYED_CHECK_MS);
    const id = source.libraryId;
    let unloaded = false;
    const unload = () => {
      if (unloaded) return;
      unloaded = true;
      if (this.unloadCurrentSong === unload) this.unloadCurrentSong = null;
      this.dropChained();
      if (this.playedTimer) clearInterval(this.playedTimer);
      this.playedTimer = null;
      stopWiring();
      // A hand-over keeps the worker, which the next song's scheduler is about to use.
      if (this.handingOver === null) {
        this.cancelPendingStart();
        this.terminateWorker();
      }
      void player.dispose();
      // React callbacks and a consumed handover can outlive this song. They may keep the session object, but must not keep its audio.
      if (this.state.player === player) {
        this.view = NO_VIEW;
        this.baseStems = null;
        this.bandExtras = {};
        this.exitBars = {};
        this.renders.clear();
        this.renderRequest++;
        this.pendingRender = null;
        this.renderSwap = null;
        this.speedPreparation = null;
        this.set({ player: null, playing: false, rendering: null });
      }
      // Leaving Performance pauses the set. Checked later, so that a remount on the same screen (StrictMode's re-run, an advance) is not
      // taken for leaving: the screen is still Performance, and the set is still on this song or has moved on.
      setTimeout(() => {
        const library = useSongLibrary.getState();
        if (!leftPerformance()) return;
        if (library.playlistPlaying && library.queue[library.position] === id) library.pausePlaylist();
        // Leaving the screen stopped the music, so there is nothing to resume after a crash. A resume still on offer keeps its point.
        if (!useResumeOffer.getState().point) clearResumePoint();
      }, 0);
    };
    this.unloadCurrentSong = unload;
    return unload;
  }

  /** Connects a song's player to the outputs and to the session. Returns the function that disconnects it. */
  wirePlayer(player: StemPlayer, source: SongSource): () => void {
    player.onOutputWarning = (message) => showToast({ tone: "fault", title: "Audio output changed", body: message });
    // Outputs are applied now, and again whenever the saved outputs change. Playback keeps going through either.
    const applyOutputs = () => void player.setOutputs(useOutputSettings.getState().config);
    applyOutputs();
    const stopOutputs = useOutputSettings.subscribe((state, previous) => {
      if (state.config !== previous.config) applyOutputs();
    });
    // The player wraps a looping song on its own, so the scheduler is told the way it is for a section jump: a planned jump at the wrap.
    player.onLoopScheduled = ({ to, at, when }) => {
      if (this.state.player !== player || this.section || this.renderSwap) return;
      this.section = {
        kind: "jump",
        ctxAt: when,
        before: this.state.sectionLive,
        sections: this.playableSections,
        schedule: { cap: at, jump: { at: this.clockOf(when), position: to } },
      };
      this.sendPlan();
    };
    player.onEnded = () => {
      // A song the session has let go of has nothing left to say to it.
      if (this.state.player !== player) return;
      // A song that has handed over was ended by its hand-over, which sent its end and stop triggers.
      if (this.handingOver !== null) return;
      // The next song is already playing on this clock, so the hand-over is taken now rather than at its start.
      if (this.chained) {
        this.handOver();
        return;
      }
      // A looping song reaches its end only if its loop pass was missed. It then starts again from its trimmed start.
      if (this.behaviourOf(player) === "loop") {
        this.set({ playing: false });
        setClockPosition(player.start);
        this.restartingLoop = true;
        void player.seek(player.start).then(() => this.play());
        return;
      }
      this.batch(() => {
        // The song has reached its end, so its end and stop triggers go out before the playlist moves on. They are held until the effects
        // of this batch, which clear the output, have run.
        if (this.state.playing) {
          this.sendTriggers("end");
          this.sendTriggers("stop");
        }
        this.set({ playing: false });
        setClockPosition(player.duration);
        const library = useSongLibrary.getState();
        // A song set to stop the playlist ends it here, so the next song does not start on its own.
        if (this.behaviourOf(player) === "stop") {
          library.pausePlaylist();
          return;
        }
        if (library.playlistPlaying && library.queue[library.position] === source.libraryId) {
          // The effects run when the batch ends, so the flag is read by the transport cleanup below before it is cleared.
          this.endingIntoSet = true;
          void library.advancePlaylist();
        }
      });
      this.endingIntoSet = false;
    };
    return stopOutputs;
  }

  /**
   * The song the previous session handed over, when it is `source`: the library holds it until a session takes it up. Any other
   * held song is released there. The previous session's hook-up is undone here, and this session wires the song up again.
   */
  private claimHandover(source: SongSource | null): HandedOverSong | null {
    const handover = useSongLibrary.getState().claimHandover(source?.libraryId);
    handover?.unwire();
    return handover;
  }

  /** Whether a song this session handed over is still waiting in the library for the next session to take it up. */
  get passing(): boolean {
    return this.handingOver !== null && useSongLibrary.getState().handover?.id === this.handingOver;
  }

  /** Sets the next song's start: its cues from its own start, and its tempo message at the start of its count-in. */
  private startHandover(chained: HandedOverSong): void {
    const armed = this.armed;
    try {
      this.startTempo = this.tempoMessages(armed, this.output, chained.player.playbackRate);
    } catch (e) {
      this.fail(e);
      this.startTempo = null;
    }
    this.startPosition = armed ? chained.player.start : null;
    this.startPlay = this.triggerBytes("play");
    this.countInMs = chained.countInMs;
    this.joining = true;
    this.incomingTail = chained.timecodeTail ? { ...chained.timecodeTail, end: chained.join } : null;
  }

  /** The outgoing scheduler's quarter-frame stream, which runs to the join. Null when the outgoing song sends no timecode. */
  private outgoingTimecode(join: number): TimecodeTail | null {
    const stream = this.scheduler?.timecodeStream();
    return stream ? { ...stream, end: join } : null;
  }

  /** Starts the effects. Safe to call again after `dispose()`. */
  bind() {
    this.bound = true;
    this.unsubscribe = this.store.subscribe(() => this.flush());
    this.unsubscribeResume = host.song.onSystemResume?.(this.resumeMidi) ?? null;
    this.flush();
    // A USB output is only reachable once system MIDI is open, so a remembered Send cues for it opens it, and opening arms it.
    const { savedOutput, access } = this.state;
    if (!access && savedOutput?.transport === "system" && this.rememberedFor(savedOutput.id) && typeof navigator.requestMIDIAccess === "function")
      void this.openMidi();
  }

  /** Runs every effect cleanup, which stops the scheduler and sends the final panic. */
  dispose() {
    if (this.playPending) this.cancelPendingStart();
    this.dropSectionPlan();
    this.dropChained();
    setStageBusy(false, this);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeResume?.();
    this.unsubscribeResume = null;
    for (const effect of this.effects) {
      effect.cleanup?.();
      effect.cleanup = undefined;
      effect.last = undefined;
    }
    this.bound = false;
    this.view = NO_VIEW;
  }

  /** Pushes values owned by other stores. Only changed values cause effects to re-run. */
  update(inputs: Partial<SessionInputs>) {
    const changed = (Object.keys(inputs) as (keyof SessionInputs)[]).some((key) => !Object.is(this.state[key], inputs[key]));
    if (changed) {
      if (
        this.playPending &&
        this.state.preparing &&
        ((inputs.cues !== undefined && inputs.cues !== this.state.cues) ||
          (inputs.bpm !== undefined && inputs.bpm !== this.state.bpm) ||
          (inputs.rhythmTempo !== undefined && inputs.rhythmTempo !== this.state.rhythmTempo) ||
          (inputs.preparationSettings !== undefined && JSON.stringify(inputs.preparationSettings) !== JSON.stringify(this.state.preparationSettings)) ||
          (inputs.timecode !== undefined && JSON.stringify(inputs.timecode) !== JSON.stringify(this.state.timecode)) ||
          (inputs.tempoOnStart !== undefined && inputs.tempoOnStart !== this.state.tempoOnStart) ||
          (inputs.tempoChannel !== undefined && inputs.tempoChannel !== this.state.tempoChannel) ||
          (inputs.timing !== undefined && JSON.stringify(inputs.timing) !== JSON.stringify(this.state.timing)))
      ) {
        this.pause();
        this.fail("Song setup changed during preparation. Press Play again to prepare the updated commands.");
      }
      if (
        this.state.playing &&
        hasPedalRhythm(this.state.cues) &&
        ((inputs.cues !== undefined && inputs.cues !== this.state.cues) || (inputs.rhythmTempo !== undefined && inputs.rhythmTempo !== this.state.rhythmTempo))
      ) {
        this.pause();
        this.set({ rhythmRestart: true });
      }
      this.set(inputs);
    }
  }

  // ---- triggers ------------------------------------------------------------------------------------------------

  /**
   * The cues the scheduler and the state chase use: the chart's cues, with each section cue turned into timed cues at the start of the sections
   * it names. The same array while neither the cues nor the sections change, and the chart's own array when it has no section cues, so a chart
   * without them behaves exactly as before.
   */
  playCues(s: Pick<SessionState, "cues" | "sections">) {
    return this.outputPart.playCues(s);
  }

  /** The messages of the song's triggers of one kind, in chart order. */
  triggerBytes(kind: MidiTrigger) {
    return this.outputPart.triggerBytes(kind);
  }

  /**
   * Sends the song's `{midi@…}` messages of one kind, once each. Nothing is sent unless the session is armed, and a failed send is reported
   * rather than thrown, because a trigger must never stop the transport.
   *
   * A stop or end is sent only after the batch that caused it has run its effects. That stop clears the output, and the transport's cleanup
   * clears it again, which would drop a message still waiting in a Bluetooth buffer. So while a batch is open or its effects are running,
   * these messages are held and sent by `flush`, once the effects are done.
   */
  sendTriggers(kind: MidiTrigger, cues?: Cue[]) {
    return this.outputPart.sendTriggers(kind, cues);
  }

  /** Sends the stop and end messages held by `sendTriggers`, in the order they were queued. */
  private sendHeldTriggers() {
    return this.outputPart.sendHeldTriggers();
  }

  // ---- state helpers -------------------------------------------------------------------------------------------

  private preparationKey(state = this.state): string {
    const player = state.player;
    return JSON.stringify({
      song: this.songSettingsKey,
      position: player?.position,
      start: player?.start,
      end: player?.duration,
      rate: player?.playbackRate,
      cues: this.playCues(state),
      parseError: state.parseError,
      bpm: state.bpm,
      rhythmTempo: state.rhythmTempo,
      preparation: state.preparationSettings,
      timing: state.timing,
      tempo: state.tempoOnStart,
      channel: state.tempoChannel,
      clock: state.clock,
      timecode: state.timecode,
      speed: state.speed,
    });
  }

  private readyFor(state = this.state): boolean {
    return (
      !!this.readySetup &&
      this.readySetup.player === state.player &&
      this.readySetup.output === selectOutput(state) &&
      selectArmed(state) &&
      selectOutput(state)?.state === "connected" &&
      this.readySetup.key === this.preparationKey(state)
    );
  }

  /** Readiness describes what we sent on this connection, never a hardware acknowledgement. */
  invalidatePreparation = () => {
    if (!this.readySetup && !this.state.pedalsReady) return;
    this.readySetup = null;
    this.openingPrepared = undefined;
    this.store.setState({ pedalsReady: false });
  };

  /** Explicitly allows once commands again. It sends nothing until the next Prepare or Play. */
  resetPreparationCommands = () => {
    if (this.playPending || this.state.playing) {
      this.fail("Stop playback or cancel preparation before resetting once commands.");
      return;
    }
    this.preparationHistory.reset();
    this.invalidatePreparation();
    this.set({ preparationOnceUsed: 0 });
  };

  set(patch: Partial<SessionState>) {
    if (this.readySetup && (!this.readyFor({ ...this.state, ...patch }) || patch.playing)) {
      this.readySetup = null;
      if (!patch.playing) this.openingPrepared = undefined;
      patch = { ...patch, pedalsReady: false };
    }
    this.store.setState(patch);
  }

  /** Several state changes made together run the effects once afterwards, as one render did. */
  batch<T>(fn: () => T): T {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      this.batchDepth--;
      this.flush();
    }
  }

  private flush() {
    if (this.batchDepth > 0) return;
    if (!this.bound) {
      this.sendHeldTriggers();
      return;
    }
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
    this.sendHeldTriggers();
  }

  context() {
    return this.outputPart.context();
  }

  terminateWorker() {
    this.readyWorker?.terminate();
    this.readyWorker = null;
  }

  fail = (e: unknown) => this.set({ error: e instanceof Error ? e.message : String(e) });

  setMidiStatus = (midiStatus: string) => this.set({ midiStatus });
  setClock = (clock: boolean) => this.set({ clock });
  setPortId = (portId: string) => {
    if (portId !== this.state.portId && (hasPedalRhythm(this.state.cues) || this.state.preparing)) this.pause();
    this.set({ portId });
  };
  setInputId = (inputId: string) => this.set({ inputId });
  setAccess = (access: MIDIAccess | null) => this.set({ access });
  /** Arms or disarms this session only. Faults and output changes use it, so they leave the remembered preference alone. */
  setArmed = (value: boolean) => this.outputPart.setArmed(value);

  /** The Send cues choice: arms or disarms, and remembers it for the selected output so later songs and sessions follow. */
  sendCues = (on: boolean) => this.outputPart.sendCues(on);

  /** The explicit stop: disarms and turns the remembered preference off. */
  disarm = () => this.outputPart.disarm();

  /** Whether the Send cues preference was turned on for this port. */
  rememberedFor(portId: string) {
    return this.outputPart.rememberedFor(portId);
  }

  /** Arms the selected output when the preference is on for it and it is connected. Returns whether it armed. */
  armRemembered() {
    return this.outputPart.armRemembered();
  }

  /** Waits out the start delay. Cancelling resolves the wait at once. */
  /**
   * The drummer's count for a start, or undefined when the song has none or its settings no longer ask for one. It plays through the
   * generated drums' track, and only from stopped: a join into the next song passes no count (a count under a crossfade makes no sense).
   */
  private drummerCount(): DrummerCount | undefined {
    const drums = this.bandExtras.drums;
    const count = drums?.extras.countIn;
    if (!drums || !count || !this.drummerCounts) return undefined;
    return { track: drums.track, audio: count.audio, start: count.start };
  }

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
  cancelPendingStart() {
    this.invalidatePreparation();
    this.playRequest++;
    this.playPending = false;
    this.set({ starting: false, preparing: null, preparationPlan: null });
    const cancel = this.cancelDelay;
    this.cancelDelay = null;
    cancel?.();
  }

  /** Cancels a start that is still waiting (the start delay, or a worker). A second Play press does this. Once audio has begun it does nothing. */
  cancelStart = () => {
    if (this.playPending) this.pause();
  };

  /** Stops the scheduler and releases anything this session started. A second call for one stop does nothing. */
  panic = (context?: PanicContext) => this.outputPart.panic(context);

  sendPerformance = (bytes: number[], timestamp?: number, label?: string) => this.outputPart.sendPerformance(bytes, timestamp, label);

  /** Disarms because the output can no longer take messages. Armed cues are never dropped without a visible fault. */
  deadOutput(message: string) {
    return this.outputPart.deadOutput(message);
  }

  degraded = (event: SchedulerDegraded) => this.outputPart.degraded(event);

  /** Hardware checks restore their temporary tempo before the transport can start. */
  registerRhythmTestCleanup(cleanup: () => void): () => void {
    this.rhythmTestCleanup = cleanup;
    return () => {
      if (this.rhythmTestCleanup === cleanup) this.rhythmTestCleanup = null;
    };
  }

  // ---- transport -----------------------------------------------------------------------------------------------

  pause = () => {
    this.batch(() => {
      const { player } = this.state;
      const wasRunning = player?.isPlaying || this.playPending;
      // A stop trigger belongs to a start whose play trigger was sent, so a pause during a count-in sends none.
      const wasPlaying = this.state.playing;
      this.cancelPendingStart();
      this.dropSectionPlan();
      this.dropChained();
      if (this.renderSwap) {
        this.renderSwap = null;
        this.sendPlan();
      }
      player?.pause();
      this.applyPendingRender();
      this.set({ playing: false });
      // A pedal/THRU path can echo our Stop back into the selected input.
      // Repeated Stop while already stopped must not transmit another Stop.
      if (wasRunning) this.panic();
      if (wasPlaying) this.sendTriggers("stop");
      if (wasPlaying && hasPedalRhythm(this.state.cues)) this.set({ rhythmRestart: true });
      if (this.state.playlistPlaying) useSongLibrary.getState().pausePlaylist();
    });
  };

  /** Prepare the pedals and stop at Ready, without count-in, audio or Play triggers. */
  preparePedals = () => this.start(true);
  play = () => this.start(false);

  /** Keeps the place in the song for a renderer crash: the playlist entry, the time, and whether cues are armed. Library songs only. */
  saveResume = (): void => {
    const { player, queued } = this.state;
    const library = useSongLibrary.getState();
    const songId = library.queue[library.position];
    if (!player || !queued || !songId) return;
    // A song that stopped at its end is a finished set or song, not a place to come back to.
    if (!this.state.playing && player.duration > 0 && clockPosition() >= player.duration) return;
    saveResumePoint({
      version: 1,
      savedAt: Date.now(),
      playlistId: library.playingSet,
      queue: [...library.queue],
      position: library.position,
      songId,
      songTime: clockPosition(),
      playing: this.state.playing,
      sendCues: this.armed,
      stageMode: this.locked,
      overrides: [...library.queueOverrides],
    });
  };

  private start = async (prepareOnly: boolean) => {
    if (stageOperationActive()) {
      this.fail("Close native pedal transfer before starting playback.");
      return;
    }
    const loopPass = this.restartingLoop;
    this.restartingLoop = false;
    let { player } = this.state;
    if (!player || this.state.parseError || this.playPending || player.isPlaying) return;
    if (this.armed && hasPedalRhythm(this.state.cues) && !canStartRhythm(this.state.cues, player.position)) {
      this.set({ rhythmRestart: true });
      this.fail(RHYTHM_RESTART);
      return;
    }
    if (this.armed && hasPedalRhythm(this.state.cues) && this.behaviourOf(player) === "loop") {
      this.fail("Turn off the playlist entry’s whole-song loop before using automatic RC-10R drums.");
      return;
    }
    if (prepareOnly && (!this.armed || this.output?.state !== "connected" || !this.state.preparationSettings?.enabled)) {
      this.fail("Connect a MIDI output, enable Send cues and Before song preparation, then prepare again.");
      return;
    }
    if (prepareOnly && this.readyFor()) return;
    this.rhythmTestCleanup?.();
    const request = ++this.playRequest;
    this.playPending = true;
    this.set({ starting: true, error: "" });
    let armed = this.armed,
      output = this.output;
    try {
      let speedPreparation: Promise<void> | null;
      do {
        speedPreparation = this.speedPreparation;
        if (speedPreparation) await speedPreparation;
      } while (speedPreparation !== this.speedPreparation);
      if (request !== this.playRequest) return;
      player = this.state.player;
      if (!player || this.state.parseError) return;
      armed = this.armed;
      output = this.output;
      const cached = this.readyFor() ? this.readySetup : null;
      if (armed && !cached && !this.state.preparationSettings?.enabled && hasPedalRhythm(this.state.cues)) {
        if (!canStartRhythm(this.state.cues, player.position)) {
          this.set({ rhythmRestart: true });
          throw new Error(RHYTHM_RESTART);
        }
        let preparedKey: string;
        do {
          preparedKey = rhythmMemoryKey(this.state.cues);
          for (const bytes of rhythmMemory(this.state.cues)) this.sendPerformance(bytes, undefined, "RC-10R memory preparation");
          await this.waitStartDelay(RHYTHM_MEMORY_SETTLE_MS / 1000);
          if (request !== this.playRequest) return;
          if (!this.armed || this.output !== output) throw new Error("MIDI output changed while preparing the RC-10R. Play from beginning again.");
        } while (preparedKey !== rhythmMemoryKey(this.state.cues));
        this.set({ rhythmRestart: false });
      }
      // An offset that is not valid at the rate stops the start, rather than sending the wrong position.
      if (armed) timecodeOffsetFrames(this.state.timecode);
      if (armed && !this.readyWorker) {
        const warm = this.prepared ?? prepareMidiScheduler();
        this.prepared = warm;
        await warm.ready;
        if (request !== this.playRequest) return;
        this.readyWorker = warm.worker;
        this.prepared = null;
      }
      armed = this.armed;
      output = this.output;
      const { bpm, timing } = this.state;
      const tempoMessages = this.tempoMessages(armed, output);
      const requestedPosition = player.position >= player.duration ? player.start : Math.max(0, player.position);
      const preparationPosition = preRollStart(requestedPosition, timing.preRollBeats, bpm);
      const preparation = loopPass ? null : this.state.preparationSettings;
      let prepared = !!cached;
      if (cached) this.openingPrepared = cached.opening;
      if (armed && preparation && !cached) {
        const sequence = preparationSequence({
          cues: this.playCues(this.state),
          position: preparationPosition,
          requestedPosition,
          start: player.start,
          settings: preparation,
          triggers: chaseTriggers(),
          history: this.preparationHistory,
          pedalChannel: this.state.tempoChannel,
          tempo: tempoMessages,
        });
        if (!preparation.enabled && sequence.skipped.length) {
          const warning = "Before song preparation is disabled. Its commands were skipped; playback continues.";
          this.setMidiStatus(warning);
          showToast({ tone: "info", title: "Before song commands skipped", body: warning });
        }
        if (preparation.enabled) {
          prepared = true;
          const check = () => request === this.playRequest && this.armed && this.output === output && output?.state === "connected";
          const commands = sequence.steps.reduce((total, step) => total + (step.kind === "send" ? step.commands.length : 0), 0);
          this.set({ preparationPlan: sequence });
          for (const [index, step] of sequence.steps.entries()) {
            this.set({ preparing: { label: step.label, until: performance.now() + (step.kind === "wait" ? step.durationMs : 0), commands, step: index } });
            if (step.kind === "wait") {
              await this.waitStartDelay(step.durationMs / 1000);
              if (request !== this.playRequest) return;
            } else
              for (const command of step.commands) {
                if (!check()) throw new Error("MIDI preparation was interrupted. Check the output and press Play again.");
                // A failed send may still have reached a pedal, so once commands are consumed before the first attempt.
                if (this.preparationHistory.started(command.onceKey)) this.set({ preparationOnceUsed: this.preparationHistory.size });
                this.sendPerformance(command.bytes, undefined, step.origin === "tempo" ? "Song tempo" : `Before song: ${step.label}`);
              }
            if (!check()) throw new Error("MIDI output changed during preparation. Check it and press Play again.");
          }
          this.openingPrepared = { position: preparationPosition, messages: sequence.suppressed };
          this.set({ rhythmRestart: false });
        }
      }
      if (prepareOnly) {
        if (!armed || !this.openingPrepared || !this.output || !this.armed) throw new Error("MIDI preparation is no longer valid. Prepare again.");
        this.readySetup = { player, output: this.output, key: this.preparationKey(), opening: this.openingPrepared };
        this.set({ pedalsReady: true, preparing: null });
        return;
      }
      await this.waitStartDelay(timing.startDelay);
      if (request !== this.playRequest) return;
      // The count-in is clicked before the audio starts, so it begins with the tempo message.
      const countIn = countInBeats(timing.countInBars, timing.beatsPerBar);
      // The count-in is as long as the audio it leads: beats at the song tempo times the rate. The drummer's count, when it plays, leads the
      // song too, and the longer of the two is what the tempo message and the cues wait for.
      const chaseStart = preRollStart(requestedPosition, timing.preRollBeats, bpm);
      const drummer = this.drummerCount();
      const drummerMs = countLeadSeconds(drummer, chaseStart, player.playbackRate) * 1000;
      this.countInMs = Math.max(bpm > 0 ? (countIn * beatSeconds(bpm) * 1000) / player.playbackRate : 0, drummerMs);
      // A chase that the pedals need before the song begins holds the audio back by CHASE_LEAD_MS, so it goes out first. Nothing is held
      // when the output is not armed, or when there is no state to chase (a start from the beginning, or no cues before the position).
      const settled = new Set(this.openingPrepared?.messages.map((bytes) => bytes.join(",")));
      const chaseLead =
        armed &&
        computeChaseState(this.playCues(this.state), chaseStart, chaseTriggerSet(chaseTriggers())).some((message) => !settled.has(message.bytes.join(",")))
          ? CHASE_LEAD_MS
          : 0;
      // Clock without a count-in has no lead-in to cover the scheduler's start, so the hold is CLOCK_LEAD_MS.
      const clockLead = armed && this.state.clock && !this.state.timecode.enabled && countIn === 0 && drummerMs === 0 ? CLOCK_LEAD_MS : 0;
      const lead = Math.max(chaseLead, clockLead) / 1000;
      this.transportAt = lead ? midiNow() + lead * 1000 : null;
      await player.play({
        bpm,
        countInBeats: countIn,
        preRollBeats: timing.preRollBeats,
        ...(lead ? { startDelay: lead } : {}),
        ...(drummer ? { drummer } : {}),
      });
      if (request !== this.playRequest) {
        player.pause();
        this.terminateWorker();
        return;
      }
      this.startTempo = prepared ? null : tempoMessages;
      // Every start and resume sends the play trigger, except a loop pass, which is not a new play press.
      this.startPlay = loopPass ? null : this.triggerBytes("play");
      // Cues start from where the audio really starts: a pre-roll puts that before the requested position.
      this.startPosition = armed ? preRollStart(requestedPosition, timing.preRollBeats, bpm) : null;
      this.set({ playing: true, preparing: null });
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
        this.set({ starting: false, preparing: null, preparationPlan: null });
      }
    }
  };

  seek = async (value: number) => {
    if (this.locked) return;
    this.pause();
    await this.state.player?.seek(value);
    setClockPosition(value);
    this.saveResume();
    if (hasPedalRhythm(this.state.cues)) this.set({ rhythmRestart: !canStartRhythm(this.state.cues, value) });
  };

  /** Returns the pedal and audio to a reproducible starting state. */
  playFromBeginning = async () => {
    this.pause();
    if (this.locked) {
      this.fail("Leave stage mode to restart from the beginning.");
      return;
    }
    await this.seek(this.state.player?.start ?? 0);
    if (this.state.queued) useSongLibrary.getState().resumePlaylist();
    await this.play();
  };

  /** Play, or start the whole playlist when the queue is at its end. */
  startPlayback = () => {
    if (stageOperationActive()) {
      this.fail("Close native pedal transfer before starting playback.");
      return;
    }
    const library = useSongLibrary.getState();
    const { player, queued } = this.state;
    // A set of one song is still a set: it resumes as the set, so a play counted afterwards records it.
    if (queued && (library.queue.length > 1 || !!library.playingSet)) {
      if (player && player.position >= player.duration) {
        if (library.position === library.queue.length - 1) void library.playPlaylist(library.queue, 0, library.playingSet ?? undefined);
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
      const wasPlaying = this.state.playing;
      this.state.player?.pause();
      this.set({ playing: false });
      this.panic();
      if (wasPlaying) this.sendTriggers("stop");
      void useSongLibrary.getState().skipPlaylist(offset);
    });
  };

  /** The one-time tempo message a start sends, or null when it sends none. Throws when the tempo is out of range. */
  tempoMessages(armed: boolean, output: MidiOutput | undefined, rate = this.state.player?.playbackRate ?? 1): number[][] | null {
    const { tempoOnStart } = this.state;
    if (!armed || !tempoOnStart || output?.state !== "connected") return null;
    // The pedal is sent the tempo the song plays at, so the range is checked on the effective BPM.
    return this.configuredTempoMessages(rate);
  }

  private configuredTempoMessages(rate = this.state.player?.playbackRate ?? 1): number[][] {
    const { tempoChannel, bpm } = this.state;
    const tempoBpm = effectiveBpm(this.state.rhythmTempo ?? bpm, rate);
    return pedalTempoMessages(tempoBpm, tempoChannel);
  }

  /** Read-only: this never consumes repeat rules or sends MIDI. */
  preparationPreview(): PreparationSequence | null {
    if (this.state.preparationPlan) return this.state.preparationPlan;
    const { player, preparationSettings: settings, bpm, timing } = this.state;
    if (!player || !settings?.enabled) return null;
    const requestedPosition = player.position >= player.duration ? player.start : Math.max(0, player.position);
    return preparationSequence({
      cues: this.playCues(this.state),
      position: preRollStart(requestedPosition, timing.preRollBeats, bpm),
      requestedPosition,
      start: player.start,
      settings,
      triggers: chaseTriggers(),
      history: this.preparationHistory,
      pedalChannel: this.state.tempoChannel,
      tempo: this.state.tempoOnStart ? this.configuredTempoMessages() : null,
    });
  }

  /** Only an incoming sequence with actual commands needs a stopped handover. Previewing never consumes repeat history. */
  private nextNeedsPreparation(next: PreparedSong): boolean {
    if (!this.armed) return false;
    const settings = savedPreparation(next.settings);
    if (!settings.enabled) return false;
    try {
      const options = JSON.parse(next.settings[":options"] || "{}");
      const timing = songCountIn(next.settings);
      const loaded = songCues(next.settings[""] ?? "", useMidiConfiguration.getState().macros, midiFileFromOptions(options), {
        duration: next.player.duration,
        settings: next.settings,
        rhythmControls: rhythmControlOverrides(usePedalLibrary.getState()),
      });
      if (loaded.error) return true;
      const cues = expandSectionCues(loaded.cues, parseSections(options.sections));
      const lead = resolveLeadIn({ countInBars: "", startDelay: "", preRollBeats: ownLeadIn("preRollBeats", options.preRollBeats) }, readLeadInDefaults());
      const plan = preparationSequence({
        cues,
        position: preRollStart(next.player.start, lead.preRollBeats, timing.bpm),
        requestedPosition: next.player.start,
        start: next.player.start,
        settings,
        triggers: chaseTriggers(),
        history: preparationHistoryFor(next.source.audio),
        pedalChannel: this.state.tempoChannel,
        tempo: this.state.tempoOnStart ? pedalTempoMessages(timing.bpm * next.player.playbackRate, this.state.tempoChannel) : null,
      });
      return plan.steps.some((step) => step.kind === "send" && step.commands.length > 0);
    } catch {
      return true;
    }
  }

  /** Crossfades into the next playlist song now. Returns false when no next song is ready, or a join is already planned. */
  crossfadeNext = (): boolean => {
    const { player, queued, playlistPlaying } = this.state;
    const next = useSongLibrary.getState().preparedNext();
    if (!player?.isPlaying || this.chained || !queued || !playlistPlaying || !next) return false;
    if (hasPedalRhythm(this.state.cues) || hasSavedPedalRhythm(next.settings) || this.nextNeedsPreparation(next)) {
      showToast({
        tone: "info",
        title: "Pedal preparation runs between songs",
        body: "The next song has setup commands. Let this song finish before preparing it.",
      });
      return false;
    }
    // The count-in is the incoming song's: its clicks start at the outgoing song's end.
    const timing = songCountIn(next.settings);
    const countIn = countInBeats(timing.countInBars, timing.beatsPerBar);
    const plan = planTransition({
      now: player.audioNow,
      songEnd: player.audioTimeOf(player.duration),
      crossfade: readCrossfade(),
      ready: true,
      countIn: countIn > 0,
      manual: true,
    });
    if (plan.kind === "gap") return false;
    this.startChain(next, plan, timing);
    return true;
  };

  /** Chains the next playlist song onto this one once its join is close, so the two play on one clock. Checked until it is chained. */
  planNext(): void {
    const { player, queued, playlistPlaying } = this.state;
    // A song set to stop, or to loop, does not hand over to the next one.
    if (!player?.isPlaying || this.behaviourOf(player) !== "next" || this.chained || !queued || !playlistPlaying) return;
    // A single rhythm pedal cannot crossfade memories or change tempo while the outgoing ending is still playing.
    if (hasPedalRhythm(this.state.cues)) return;
    const library = useSongLibrary.getState();
    // An entry that waits for Play is not chained: it would start on the clock at the join.
    if (library.queueOverrides[library.position + 1]?.autoplay === false) return;
    const next = library.preparedNext();
    if (!next || this.nextNeedsPreparation(next)) return;
    const now = player.audioNow;
    const timing = songCountIn(next.settings);
    const countIn = countInBeats(timing.countInBars, timing.beatsPerBar);
    const plan = planTransition({
      now,
      songEnd: player.audioTimeOf(player.duration),
      crossfade: readCrossfade(),
      ready: true,
      countIn: countIn > 0,
    });
    if (plan.kind === "gap" || plan.startAt - now > CHAIN_AHEAD_S) return;
    this.startChain(next, plan, timing);
  }

  /**
   * Counts the playing song as played once it passes its halfway point, with the playlist set it came from. The check runs once a second and
   * does no work once the song is counted, so it stays off the playback path.
   */
  private checkPlayed = (): void => {
    const { player } = this.state;
    const id = this.loadedSongId;
    if (!player || !id || this.playedRecorded || !player.isPlaying || !countsAsPlayed(player.position, player.duration)) return;
    this.playedRecorded = true;
    const library = useSongLibrary.getState();
    library.recordPlay(id, library.playlistPlaying ? (library.playingSet ?? undefined) : undefined);
  };

  /**
   * What the playing song does at its end: the playlist entry's override when it has one, otherwise the song's own. The entry playing
   * is locked, so its override cannot change while it plays.
   */
  behaviourOf(player: StemPlayer): EndBehaviour {
    const library = useSongLibrary.getState();
    return library.queueOverrides[library.position]?.endBehaviour ?? player.behaviour;
  }

  /** Starts `next` on this song's clock at the join, and arranges the hand-over HANDOVER_LEAD_S before it. `timing` is the next song's. */
  private startChain(next: PreparedSong, plan: Exclude<Transition, { kind: "gap" }>, timing: SongCountIn): void {
    const { player } = this.state;
    if (!player) return;
    // The next song's buffers were built when it was prepared, so the join only starts them.
    if (hasPedalRhythm(this.state.cues) || hasSavedPedalRhythm(next.settings) || this.nextNeedsPreparation(next)) return;
    const incoming = next.player;
    const unwire = this.wirePlayer(incoming, next.source);
    const countInBeatsNow = plan.kind === "countIn" ? countInBeats(timing.countInBars, timing.beatsPerBar) : 0;
    const lead: Lead = { bpm: timing.bpm, countInBeats: countInBeatsNow, preRollBeats: 0 };
    if (!player.chainNext(incoming, { startAt: plan.startAt, fadeLength: plan.fadeLength, stopAt: plan.stopAt, lead })) {
      unwire();
      return;
    }
    const countInMs = timing.bpm > 0 ? (countInBeatsNow * beatSeconds(timing.bpm) * 1000) / incoming.playbackRate : 0;
    const join = this.clockOf(plan.startAt);
    this.chained = { id: next.id, player: incoming, countInMs, unwire, join };
    // The library holds the chained song, so a queue edit that changes the next song undoes this chain first.
    useSongLibrary.getState().holdChain({ id: next.id, release: () => this.dropChained() });
    // The outgoing song's quarter frames end where the next song joins, and its full frame starts there. The chain is decided several
    // seconds ahead, so no quarter frame past the join is queued yet. Dropping the chain restores them.
    this.scheduler?.endTimecode(join);
    this.clearHandoverTimer();
    this.handoverTimer = setTimeout(this.handOver, Math.max(0, (plan.startAt - HANDOVER_LEAD_S - player.audioNow) * 1000));
  }

  /**
   * Hands the chained song over: the library holds it and moves on, and the view is re-created for the new song. The next session
   * takes the song up in `loadSong`. The song is already playing, so this only moves the playlist and the outgoing song's events on.
   */
  private handOver = (): void => {
    const chained = this.chained;
    const outgoing = this.state.player;
    if (!chained || !outgoing) return;
    this.clearHandoverTimer();
    const library = useSongLibrary.getState();
    if (library.preparedNext()?.id !== chained.id) {
      this.dropChained();
      return;
    }
    outgoing.detachNext();
    this.chained = null;
    useSongLibrary.getState().holdChain(null);
    this.handingOver = chained.id;
    // The outgoing song ends at the join: its end and stop go out before the next song's load and play. The batch holds them until the
    // effects have run, so no clear that follows can drop them.
    this.batch(() => {
      this.sendTriggers("end");
      this.sendTriggers("stop");
    });
    // The outgoing scheduler is torn down with this view, so its quarter frames are carried to the join by the incoming scheduler.
    library.setHandover({ ...chained, timecodeTail: this.outgoingTimecode(chained.join) });
    // End this owner before the library starts allocating the following song. The player preserves any outgoing audio tail.
    this.unloadCurrentSong?.();
    library.advanceToPrepared(chained.id);
  };

  /** Undoes the chained song, if it has not been taken over: the outgoing song then runs to its own end. */
  dropChained(): void {
    this.clearHandoverTimer();
    const chained = this.chained;
    if (!chained) return;
    this.chained = null;
    useSongLibrary.getState().holdChain(null);
    this.scheduler?.endTimecode(null);
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
      this.disarm();
    });
    // After the flush: the carry effect would otherwise store the disarmed state over this reset.
    if (this.state.queued) useSongLibrary.getState().rememberMidi(null);
  };

  /** Enable USB / system MIDI. Always asks for a fresh access, so a port re-enumerated since then is the object sent to. */
  connectMidi = () => this.outputPart.connectMidi();

  /**
   * After sleep the ports from before are stale, so the system's ports are requested again. A warm scheduler worker from before the sleep
   * is dropped too, so Play builds a fresh one.
   */
  private resumeMidi = () => this.outputPart.resumeMidi();

  openMidi() {
    return this.outputPart.openMidi();
  }

  // ---- sections ------------------------------------------------------------------------------------------------

  private lookahead(): number {
    return this.state.portId === BLUETOOTH_PORT_ID ? BLUETOOTH_LOOKAHEAD : SYSTEM_LOOKAHEAD;
  }

  /** The MIDI clock time at which the audio clock reads `ctx`. Both clocks are in step while playing. */
  clockOf(ctx: number): number {
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
  sendPlan(): void {
    const schedule = this.section?.schedule ?? this.renderSchedule();
    // Without sections there is never a plan to send or to clear, so the scheduler is not touched.
    if (!schedule && !this.planSent) return;
    this.planSent = schedule !== null;
    this.scheduler?.plan(schedule?.cap ?? null, schedule?.jump ?? null);
  }

  /** The MIDI plan of a render swap: cues are held after its song time, and the schedule takes the new rate at its audio time. */
  private renderSchedule(): { cap: number; jump: SchedulerJump | null } | null {
    const swap = this.renderSwap;
    if (!swap) return null;
    return { cap: swap.at, jump: { at: this.clockOf(swap.ctxAt), position: swap.at, rate: swap.rate, keepsPosition: true } };
  }

  /** Takes a boundary decided by the planner: the audio jump is scheduled now, the MIDI schedule is held up to it. */
  private commitBoundary(boundary: SectionBoundary): void {
    const { player, sectionLive } = this.state;
    const sections = this.playableSections;
    if (!player || this.renderSwap) return;
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
  dropSectionPlan(): void {
    this.pendingRelease = null;
    const plan = this.section;
    if (!plan) return;
    this.section = null;
    this.set({ sectionLive: plan.before, sectionNext: null });
  }

  /**
   * Whether the exit bars are used at all: the song has some, and it plays at its own speed and pitch, which is what they were rendered at.
   * At another speed or pitch a vamp keeps the audio it has, which loops cleanly and leaves without its fill.
   */
  private exitsUsable(): boolean {
    return Object.keys(this.exitBars).length > 0 && isPlainSpeed(this.state.speed);
  }

  /** Whether the vamp's exit bar can still be placed for the pass that is playing: its bar is far enough ahead on the audio clock. */
  private canExit(player: StemPlayer, bar: ExitBar): boolean {
    return player.audioTimeOf(bar.from) - player.audioNow >= EXIT_LEAD_S;
  }

  /**
   * In a vamp, once the pass that is playing is the one that leaves the section (a loop that was released, a repeat's second pass, or a
   * section that continues), swaps the generated tracks' last bar for the exit bar, which has the fill and lead-in into the next section. The swap
   * is scheduled on the audio clock one bar ahead and changes no song time, so the MIDI cues stay where they were. A release that comes too late
   * for it is held until the next pass. An exit that is no longer the pass's way out (the loop was started again, a jump was armed) is taken back.
   */
  private tickExit(player: StemPlayer, sections: readonly Section[]): void {
    // A release that was held for the exit bar is taken at once when the exit bars stop being used (a change of speed or pitch).
    if (this.pendingRelease !== null && !this.exitsUsable()) {
      const id = this.pendingRelease;
      this.pendingRelease = null;
      this.set({ sectionLive: releaseLoop(this.state.sectionLive, id) });
    }
    if (!this.exitsUsable() || !sections.length || player.position < 0) return;
    const ordered = sortedSections(sections);
    const section = ordered[sectionIndexAt(ordered, player.position)];
    if (this.pendingRelease !== null && section?.id !== this.pendingRelease) this.pendingRelease = null;
    const bar = section ? this.exitBars[section.id] : undefined;
    if (!section || !bar) return;
    if (this.pendingRelease === section.id && this.canExit(player, bar)) {
      this.pendingRelease = null;
      this.set({ sectionLive: releaseLoop(this.state.sectionLive, section.id) });
    }
    const boundary = nextBoundary(sections, player.position, this.state.sectionLive);
    // A pause at the end of the section leaves it the same way a continue does.
    const leaving = boundary !== null && (boundary.action.kind === "continue" || boundary.action.kind === "pause");
    if (player.exitAt !== null) {
      if (!leaving) player.cancelExit();
      return;
    }
    // A jump that is waiting means this pass does not leave into the next section.
    if (!leaving || this.pendingRelease === section.id || this.section?.kind === "jump") return;
    player.scheduleExit(bar);
  }

  /** Every 50 ms while playing: carries out a decision once its boundary has passed, and decides the next boundary when it is close. */
  tickSections = (): void => {
    const { player, playing } = this.state;
    const sections = this.playableSections;
    if (!player || !playing) return;
    try {
      this.tickRender(player);
      if (this.renderSwap) return;
      this.tickExit(player, sections);
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

  /**
   * Carries a render through while the song plays: a built render is swapped in at the next beat, once no section jump is waiting,
   * and the swap is cleared when its audio time passes. Sections wait for a swap to land.
   */
  private tickRender(player: StemPlayer): void {
    const swap = this.renderSwap;
    if (swap) {
      if (player.audioNow >= swap.ctxAt) {
        this.renderSwap = null;
        this.sendPlan();
      }
      return;
    }
    if (!this.pendingRender || this.section) return;
    const started = player.swapRender(this.pendingRender, RENDER_SWAP_LEAD_S);
    if (!started) return;
    this.renderSwap = { at: started.at, ctxAt: started.when, rate: this.pendingRender.rate };
    this.pendingRender = null;
    this.sendPlan();
  }

  /** Applies a render that is waiting for a beat, now. Used when the song stops, because a stopped song has no beat to wait for. */
  private applyPendingRender(): void {
    const render = this.pendingRender;
    const player = this.state.player;
    if (!render || !player) return;
    this.pendingRender = null;
    player.applyRender(render);
  }

  /**
   * Sets the song's speed and pitch. The render is built in the background; the newest request wins. A built render is swapped in at
   * the next beat while the song plays, and applied at once while it is stopped.
   */
  setSpeed = (requested: Partial<SpeedSettings>): void => {
    const speed = clampSpeed({ ...this.state.speed, ...requested });
    if (JSON.stringify(speed) === JSON.stringify(this.state.speed)) return;
    if (speed.rate !== this.state.speed.rate && this.state.playing && this.armed && hasPedalRhythm(this.state.cues)) {
      this.fail("Pause and restart from the beginning to change speed with RC-10R drums.");
      return;
    }
    if (this.playPending && this.state.preparing) this.pause();
    this.set({ speed });
    try {
      const key = this.songSettingsKey;
      const options = parseOptions(getSetting(key, ":options"));
      setSetting(key, ":options", JSON.stringify({ ...options, ...speedOptions(speed) }));
    } catch (e) {
      this.fail(e);
    }
    this.speedPreparation = this.renderSpeed(speed);
  };

  /** Builds the render for `speed` from the stems at 100%, and hands it to the player. Stale results are dropped. */
  private async renderSpeed(speed: SpeedSettings): Promise<void> {
    const base = this.baseStems;
    const player = this.state.player;
    if (!base || !player) return;
    const request = ++this.renderRequest;
    this.set({ rendering: null });
    try {
      const stems = await this.renders.render(base, speed, (done, total) => {
        if (request === this.renderRequest) this.set({ rendering: { done, total } });
      });
      if (!stems || request !== this.renderRequest || this.state.player !== player) return;
      const render = await player.renderBuffers(stems, speed.rate);
      if (request !== this.renderRequest || this.state.player !== player) return;
      this.pendingRender = render;
      if (!player.isPlaying) this.applyPendingRender();
      this.set({ rendering: null });
    } catch (e) {
      if (request === this.renderRequest) {
        this.set({ rendering: null });
        this.fail(e);
      }
    }
  }

  /** A tap arms a jump to the section for the next boundary. While stopped it moves the playhead to the section's start instead. */
  tapSection = (id: string) => {
    const section = this.playableSections.find((s) => s.id === id);
    if (!section) return;
    if (this.state.playing && this.armed && hasPedalRhythm(this.state.cues)) {
      this.fail(RHYTHM_RESTART);
      return;
    }
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
    if (this.armed && hasPedalRhythm(this.state.cues)) {
      this.fail(RHYTHM_RESTART);
      return;
    }
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
    if (this.armed && hasPedalRhythm(this.state.cues)) {
      this.fail(RHYTHM_RESTART);
      return;
    }
    // Tapping the looping section releases it, the same way the release action does.
    const looping = sortedSections(this.playableSections).find((section) => section.id === id);
    if (this.state.sectionLive.loop === id && looping) {
      this.releaseLoopOf(looping);
      return;
    }
    this.cancelSectionPlan();
    this.pendingRelease = null;
    const live = this.state.sectionLive;
    this.set({ sectionLive: live.loop === id ? releaseLoop(live, id) : startLoop(live, id) });
  };

  /** Releases the loop of the section being played, whether it was started live or is the section's own mode. */
  releaseSectionLoop = () => {
    const { player } = this.state;
    const ordered = sortedSections(this.playableSections);
    const current = player ? ordered[sectionIndexAt(ordered, player.position)] : undefined;
    if (!current) return;
    this.releaseLoopOf(current);
  };

  /** Whether another pass of `section` could place its exit bar: the bar begins far enough after the section does. A one-bar vamp has no such pass. */
  private exitReachable(section: Section, bar: ExitBar): boolean {
    return bar.from - section.start >= EXIT_LEAD_S + EXIT_TICK_MARGIN_S;
  }

  /**
   * Releases a loop. A vamp leaves through its exit bar, placed a bar ahead. A release inside the last bar, or with the jump back already too
   * close to take back, lets the section loop once more: the release is taken at the start of that pass, and its last bar is the exit. A vamp that
   * cannot place its exit on a later pass either (its last bar is its first) is released at once and leaves by its plain last bar.
   */
  private releaseLoopOf(section: Section): void {
    const { player } = this.state;
    const bar = this.exitsUsable() ? this.exitBars[section.id] : undefined;
    const later = bar !== undefined && this.exitReachable(section, bar);
    if (bar && later && player && !this.canExit(player, bar)) {
      this.pendingRelease = section.id;
      return;
    }
    if (!this.cancelSectionPlan() && bar && later) {
      this.pendingRelease = section.id;
      return;
    }
    this.pendingRelease = null;
    this.set({ sectionLive: releaseLoop(this.state.sectionLive, section.id) });
  }

  /** Cancels the armed jump. A decision already made for it is put back too, where that is still possible. */
  cancelSectionJump = () => {
    this.cancelSectionPlan();
    this.set({ sectionLive: cancelJump(this.state.sectionLive) });
  };

  // ---- remote control ------------------------------------------------------------------------------------------

  /** Supplies the performance screen's view actions (stage, click, mixer, tap, lyrics). Called again whenever they change. */
  setView(view: ViewHost) {
    return this.remotePart.setView(view);
  }

  /** Every key press from the window. Returns true when Learn or a binding took it; a key in a text field is never taken. */
  keyDown = (e: KeyboardEvent) => this.remotePart.keyDown(e);

  /** One message from the selected input: learned while Learn is open, otherwise it runs the bindings or selects a song. */
  receiveMidi = (data: Uint8Array) => this.remotePart.receiveMidi(data);

  /**
   * A transport action a band follower asked for (spec 44). Anything that is not one of the follower actions is ignored. A stop needs a
   * second press, as a double-press binding does, so the performer sees "press again" before the song stops.
   */
  runFollowerAction(action: string) {
    return this.remotePart.runFollowerAction(action);
  }

  /** The playable sections in song order, and the index of the one the playhead is in (-1 when none). */
  sectionOrder(): { ids: string[]; current: number } {
    const ordered = sortedSections(this.playableSections);
    const player = this.state.player;
    return { ids: ordered.map((s) => s.id), current: player ? sectionIndexAt(ordered, player.position) : -1 };
  }

  stepSection(step: 1 | -1): Hint {
    const { ids, current } = this.sectionOrder();
    if (!ids.length) return "This song has no sections.";
    const target = current + step;
    if (target < 0) return "Already at the first section.";
    if (target >= ids.length) return "Already at the last section.";
    this.tapSection(ids[target]);
  }

  sectionAt(n: number, run: (id: string) => void): Hint {
    const { ids } = this.sectionOrder();
    if (!ids.length) return "This song has no sections.";
    if (n > ids.length) return `This song has ${ids.length} sections.`;
    run(ids[n - 1]);
  }

  // ---- effects -------------------------------------------------------------------------------------------------

  private createEffects(): Effect[] {
    const armedOf = (s: SessionState) => selectArmed(s);
    return [
      // While a song plays or prepares, or a playlist runs between its songs, the editor leaves the pedal alone (see state/stage-activity.ts).
      {
        deps: (s) => [s.playing, s.starting, s.preparing !== null, s.playlistPlaying],
        run: (s) => setStageBusy(s.playing || s.starting || s.preparing !== null || s.playlistPlaying, this),
      },
      // The place in the song is kept every two seconds while it plays, and at once when a song loads, plays or pauses.
      {
        deps: (s) => [s.playing, s.player],
        run: (s) => {
          if (!s.player) return;
          this.saveResume();
          if (!s.playing) return;
          const timer = setInterval(this.saveResume, RESUME_SAVE_MS);
          return () => clearInterval(timer);
        },
      },
      // A song a MIDI trigger loaded starts once its player is ready and the library is no longer loading.
      {
        deps: (s) => [s.player, s.busy],
        run: (s) => {
          if (!this.autoplayPending || !s.player || s.busy) return;
          this.autoplayPending = false;
          void this.play();
        },
      },
      // A playlist song starts itself once it is the current one and nothing is loading, unless its entry asks to wait for Play.
      {
        deps: (s) => [s.player, s.queued, s.playlistPlaying, s.busy],
        run: (s) => {
          if (!s.queued || !s.playlistPlaying || s.busy || !s.player) return;
          if (useSongLibrary.getState().queueOverrides[useSongLibrary.getState().position]?.autoplay === false) return;
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
            this.sendTriggers("stop");
          }
        },
      },
      // Carry the MIDI to the next song: the access, output and input to any song loaded next, and arming only while a playlist plays,
      // so a stopped playlist cannot leave an armed flag that re-arms a later join.
      {
        deps: (s) => [s.queued, s.playlistPlaying, s.busy, s.access, s.portId, s.inputId, armedOf(s), selectOutput(s)],
        run: (s) => {
          if (s.busy) return;
          useSongLibrary
            .getState()
            .rememberMidi({ access: s.access, portId: s.portId, inputId: s.inputId, armed: armedOf(s) && s.playlistPlaying, output: selectOutput(s) });
        },
      },
      // Transport lifecycle is separate from tempo-dependent scheduling.
      {
        deps: (s) => [s.playing, armedOf(s), selectOutput(s), s.clock],
        run: (s) => {
          if (!s.playing) return;
          const context = this.context();
          // A song that joins a set already running sends no Start: the set's Start went out with its first song.
          const joined = this.joining;
          this.joining = false;
          // A delayed start sends its Start or Continue when the audio begins, after the chase.
          const at = this.transportAt;
          this.transportAt = null;
          if (context.armed && s.clock && !s.timecode.enabled && !joined) {
            try {
              this.stoppedOn = undefined;
              this.sendPerformance([(s.player?.position ?? 0) < 0.05 ? 250 : 251], at === null ? undefined : at - performance.timeOrigin);
            } catch (e) {
              this.fail(e);
              this.setArmed(false);
            }
          }
          // A song handed over stays on the set's transport, so leaving this session does not stop it.
          return () => {
            if (!this.passing) this.panic(this.endingIntoSet ? { ...context, clock: false } : context);
          };
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
      // A song's load triggers go out when it is loaded while armed, and again each time the session arms for it.
      {
        deps: (s) => [armedOf(s), s.player, rhythmMemoryKey(s.cues)],
        run: (s) => {
          if (!armedOf(s) || !s.player) {
            this.loadedPlayer = null;
            this.loadedRhythmKey = "";
            return;
          }
          const key = rhythmMemoryKey(s.cues);
          if (this.loadedPlayer === s.player) {
            if (this.loadedRhythmKey !== key && !s.playing)
              for (const bytes of rhythmMemory(s.cues)) this.sendPerformance(bytes, undefined, "RC-10R memory preparation");
          } else {
            this.loadedPlayer = s.player;
            this.sendTriggers("load", s.cues);
          }
          this.loadedRhythmKey = key;
        },
      },
      // The MIDI scheduler itself.
      {
        deps: (s) => [s.playing, s.player, armedOf(s), selectOutput(s), s.clock, s.bpm, this.playCues(s), s.timecode],
        run: (s) => this.runScheduler(s),
      },
      // A USB output that goes away disarms the session. The same port id re-enumerated as a new object is the same device:
      // it disarms without a fault, since the cues were never sent to the new object.
      {
        deps: (s) => [s.access, s.portId, s.armedOutput],
        run: (s) => {
          const access = s.access;
          if (!access) return;
          const update = () => {
            const { portId, armedOutput } = this.state;
            this.set({ portsVersion: this.state.portsVersion + 1 });
            if (portId === BLUETOOTH_PORT_ID) return;
            const current = access.outputs.get(portId);
            if (!armedOutput) {
              // The remembered port is back: take it up again, so Enable and arming work from the new object. Opening arms it too
              // when Send cues is on for it. A port that goes away while Send cues is on is marked lost even if a fault had disarmed it.
              if (current?.state !== "connected" && this.rememberedFor(portId)) this.portLost = true;
              if (this.portLost && current?.state === "connected") void this.openMidi();
              return;
            }
            if (current === armedOutput && current.state === "connected") return;
            if (current?.state === "connected") {
              this.setArmed(false);
              this.set({ midiStatus: this.armRemembered() ? REARMED_STATUS : RECONNECTED_STATUS });
              return;
            }
            useMidiDiagnostics.getState().fault("System MIDI output disconnected. Cues disarmed.");
            this.portLost = true;
            this.setArmed(false);
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
            // A new Bluetooth connection for the remembered output is the same pedal coming back.
            if (this.armRemembered()) this.set({ midiStatus: REARMED_STATUS });
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
      // Remote input: the selected input's messages run the bindings, or are learned while Learn is open.
      {
        deps: (s) => [s.access, s.inputId, s.bluetooth],
        run: (s) => {
          if (s.inputId === BLUETOOTH_PORT_ID) return s.bluetooth?.subscribe(this.receiveMidi);
          const input = s.access?.inputs.get(s.inputId);
          if (!input) return;
          const handler = (e: MIDIMessageEvent) => {
            if (e.data) this.receiveMidi(e.data);
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
      // Armed, but the port went away: a silent stop would look like cues that never sounded.
      if (s.armedOutput && portIsDead(output)) this.deadOutput("MIDI output is no longer connected. Cues disarmed.");
      this.startPosition = null;
      this.startTempo = null;
      this.startPlay = null;
      this.terminateWorker();
      return;
    }
    const context = this.context();
    const fault = (message: string) => {
      useMidiDiagnostics.getState().fault(message);
      this.batch(() => {
        if (hasPedalRhythm(this.state.cues)) this.pause();
        else this.panic(context);
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
      const rate = player.playbackRate;
      const origin = midiNow() - (position * 1000) / rate;
      const playTriggers = this.startPlay ?? [];
      this.startPlay = null;
      // Timecode replaces app clock: a receiver gets one source of time. The offset is checked here as well as at Play.
      const offset = timecodeOffsetFrames(s.timecode);
      const timecodeTail = this.incomingTail;
      this.incomingTail = null;
      const handle = startMidiScheduler(
        {
          cues: this.playCues(s),
          position: cuePosition,
          duration: player.duration,
          origin,
          // The start tempo and play trigger are due at the start of the count-in: the start position's clock time less the count-in. Song position
          // zero is not that time when starting mid-song, so the message would be older than STALE_MS and dropped.
          tempoAt: origin + (cuePosition * 1000) / rate - this.countInMs,
          bpm: s.rhythmTempo ?? s.bpm,
          rate,
          clock: s.clock && offset === null,
          timecode: offset === null ? undefined : { fps: s.timecode.fps, offset },
          timecodeTail: timecodeTail ?? undefined,
          tempo: this.startTempo,
          prepared: this.openingPrepared,
          playTriggers,
          lookahead: s.portId === BLUETOOTH_PORT_ID ? BLUETOOTH_LOOKAHEAD : SYSTEM_LOOKAHEAD,
          pedalChannel: s.tempoChannel,
          chaseTriggers: chaseTriggers(),
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
      this.openingPrepared = undefined;
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
