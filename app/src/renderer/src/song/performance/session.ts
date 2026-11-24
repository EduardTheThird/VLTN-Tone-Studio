import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { type ExitBar, type RenderedBuffers, StemPlayer } from "@/song/stems/player";
import { isPlainSpeed, RenderQueue } from "@/song/audio/render-queue";
import { DEFAULT_SPEED, speedFromOptions, type SpeedSettings } from "./speed";
import { sharedPlaybackEngine } from "@/song/audio/playback-engine";
import { type HandedOverSong, useSongLibrary } from "@/song/library";
import { playableStems } from "@/song/stems/playable";
import { extraKeysIn, type ExtrasPart, type LoadedExtras, loadExtras } from "@/song/band/extras";
import { parseBandSettings } from "@/song/band/arrangement";
import { useNav } from "@/state/nav";
import { setStageBusy } from "@/state/stage-activity";
import { stageOperationActive } from "@/state/stage-operation";
import { clearResumePoint, saveResumePoint } from "./resume-point";
import { useResumeOffer } from "./resume-offer";
import { useOutputSettings } from "@/song/audio/output-settings";
import { showToast } from "@/app/notify";
import { host } from "@/host";
import type { SongSource, Stems } from "@/song/types";
import type { Cue, MidiTrigger } from "@/song/performance/chart";
import { clockPosition, setClockPosition } from "@/song/performance/playback-clock";
import { getSetting, performanceKey } from "@/song/performance/settings";
import { playerShapeFromOptions } from "@/song/performance/song-shape";
import { prepareMidiScheduler, type SchedulerDegraded, startMidiScheduler } from "@/song/performance/midi-scheduler-client";
import { canStartRhythm, hasPedalRhythm } from "./rhythm-runtime";
import { PreparationHistory, preparationHistoryFor } from "./preparation-repeat";
import type { TimecodeTail } from "@/song/performance/midi-scheduler";
import { NO_TIMECODE } from "@/song/performance/timecode";
import { NO_LIVE } from "@/song/performance/sections";
import { useMidiDiagnostics } from "@/song/performance/midi-diagnostics";
import type { BleMidiConnection } from "@/bluetooth/connection";
import type { Hint, ViewHost } from "./actions";
import { defaultBindings, RemoteRouter } from "./bindings";
import {
  BLUETOOTH_PORT_ID,
  type Effect,
  type MidiOutput,
  NO_TIMING,
  type PanicContext,
  parseOptions,
  type SectionPlan,
  selectArmed,
  selectOutput,
  type SessionInputs,
  type SessionOptions,
  type SessionState,
} from "./session-core";
import { SessionOutput } from "./session-output";
import { SessionRemote } from "./session-remote";
import { SessionSections } from "./session-sections";
import { SessionPlaylist } from "./session-playlist";
import { SessionStart } from "./session-start";
import { SessionEffects } from "./session-effects";
export { BLUETOOTH_PORT_ID, NO_TIMING, carriedInto, selectArmed, selectOutput } from "./session-core";
export type { CarriedMidi, LateNotice, MidiOutput, SessionHost, SessionInputs, SessionOptions, SessionState, Timing } from "./session-core";


/*
 * Everything that keeps a song's MIDI cues, transport and remote input running during a performance, without React.
 * The component tree renders `state` and calls the methods; it never owns the scheduler, the arming binding or the
 * panic path. Timing-critical lifecycle code lives in `effects`, which mirror the dependency-array semantics the
 * panel used before: each effect re-runs when one of its inputs changes and its cleanup runs first.
 */

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
  private readonly sectionsPart = new SessionSections(this);
  private readonly playlistPart = new SessionPlaylist(this);
  private readonly startPart = new SessionStart(this);
  private readonly effectsPart = new SessionEffects(this);
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
  previousBluetooth: BleMidiConnection | null;
  section: SectionPlan | null = null;
  /** The next playlist song, once it has been started on this song's clock */
  chained: HandedOverSong | null = null;
  /** The outgoing song's quarter frames up to its join, for the next scheduler this session starts. Consumed once. */
  incomingTail: TimecodeTail | null = null;
  /** Whether the playing song has been counted as played. Counted once per song, at its halfway point. */
  playedRecorded = false;
  private playedTimer: ReturnType<typeof setInterval> | null = null;
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
      clockGrid: null,
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
    this.effects = this.effectsPart.createEffects();
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
    const handover = this.playlistPart.claimHandover(source);
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
      this.playlistPart.startHandover(handover);
      // Playback carries on: the song is already running, so the transport goes on as it was.
      this.batch(() => this.set({ player, playing: true, speed }));
    } else {
      this.batch(() => {
        this.set({ player, playing: false, speed, rhythmRestart: false });
        setClockPosition(0);
      });
      // A song saved at another speed is rendered now. It plays at 100% until its render is in place.
      this.speedPreparation = !isPlainSpeed(speed) ? this.sectionsPart.renderSpeed(speed) : null;
    }
    this.playedTimer = setInterval(this.playlistPart.checkPlayed, PLAYED_CHECK_MS);
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
        sections: this.sectionsPart.playableSections,
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
        this.playlistPart.handOver();
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

  /** Whether a song this session handed over is still waiting in the library for the next session to take it up. */
  get passing() {
    return this.playlistPart.passing;
  }

  /** Starts the effects. Safe to call again after `dispose()`. */
  bind() {
    this.bound = true;
    this.unsubscribe = this.store.subscribe(() => this.flush());
    this.unsubscribeResume = host.song.onSystemResume?.(this.outputPart.resumeMidi) ?? null;
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
          (inputs.clockGrid !== undefined && inputs.clockGrid !== this.state.clockGrid) ||
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

  // ---- state helpers -------------------------------------------------------------------------------------------

  /** Readiness describes what we sent on this connection, never a hardware acknowledgement. */
  invalidatePreparation = () => this.startPart.invalidatePreparation();

  /** Explicitly allows once commands again. It sends nothing until the next Prepare or Play. */
  resetPreparationCommands = () => this.startPart.resetPreparationCommands();

  set(patch: Partial<SessionState>) {
    if (this.readySetup && (!this.startPart.readyFor({ ...this.state, ...patch }) || patch.playing)) {
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
      this.outputPart.sendHeldTriggers();
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
    this.outputPart.sendHeldTriggers();
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

  /** Invalidates the pending start (if any) so it does nothing when it resumes. */
  cancelPendingStart() {
    return this.startPart.cancelPendingStart();
  }

  /** Cancels a start that is still waiting (the start delay, or a worker). A second Play press does this. Once audio has begun it does nothing. */
  cancelStart = () => this.startPart.cancelStart();

  /** Stops the scheduler and releases anything this session started. A second call for one stop does nothing. */
  panic = (context?: PanicContext) => this.outputPart.panic(context);

  sendPerformance = (bytes: number[], timestamp?: number, label?: string) => this.outputPart.sendPerformance(bytes, timestamp, label);

  /** Disarms because the output can no longer take messages. Armed cues are never dropped without a visible fault. */
  deadOutput(message: string) {
    return this.outputPart.deadOutput(message);
  }

  degraded = (event: SchedulerDegraded) => this.outputPart.degraded(event);

  /** Hardware checks restore their temporary tempo before the transport can start. */
  registerRhythmTestCleanup(cleanup: () => void) {
    return this.startPart.registerRhythmTestCleanup(cleanup);
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
      this.sectionsPart.applyPendingRender();
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
  preparePedals = () => this.startPart.start(true);
  play = () => this.startPart.start(false);

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
  tempoMessages(armed: boolean, output: MidiOutput | undefined, rate?: number) {
    return this.startPart.tempoMessages(armed, output, rate);
  }

  /** Read-only: this never consumes repeat rules or sends MIDI. */
  preparationPreview() {
    return this.startPart.preparationPreview();
  }

  /** Crossfades into the next playlist song now. Returns false when no next song is ready, or a join is already planned. */
  crossfadeNext = () => this.playlistPart.crossfadeNext();

  /** Chains the next playlist song onto this one once its join is close, so the two play on one clock. Checked until it is chained. */
  planNext() {
    return this.playlistPart.planNext();
  }

  /**
   * What the playing song does at its end: the playlist entry's override when it has one, otherwise the song's own. The entry playing
   * is locked, so its override cannot change while it plays.
   */
  behaviourOf(player: StemPlayer) {
    return this.playlistPart.behaviourOf(player);
  }

  /** Undoes the chained song, if it has not been taken over: the outgoing song then runs to its own end. */
  dropChained() {
    return this.playlistPart.dropChained();
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

  openMidi() {
    return this.outputPart.openMidi();
  }

  // ---- sections ------------------------------------------------------------------------------------------------

  /** The MIDI clock time at which the audio clock reads `ctx`. Both clocks are in step while playing. */
  clockOf(ctx: number) {
    return this.sectionsPart.clockOf(ctx);
  }

  /** Tells the scheduler the waiting plan. Called on each decision, and when a scheduler starts while a plan waits. */
  sendPlan() {
    return this.sectionsPart.sendPlan();
  }

  /** Forgets a decision because playback stopped. Any jump was dropped by the player, and the live state goes back to what it was. */
  dropSectionPlan() {
    return this.sectionsPart.dropSectionPlan();
  }

  /** Every 50 ms while playing: carries out a decision once its boundary has passed, and decides the next boundary when it is close. */
  tickSections = () => this.sectionsPart.tickSections();

  /**
   * Sets the song's speed and pitch. The render is built in the background; the newest request wins. A built render is swapped in at
   * the next beat while the song plays, and applied at once while it is stopped.
   */
  setSpeed = (requested: Partial<SpeedSettings>) => this.sectionsPart.setSpeed(requested);

  /** A tap arms a jump to the section for the next boundary. While stopped it moves the playhead to the section's start instead. */
  tapSection = (id: string) => this.sectionsPart.tapSection(id);

  /** A second tap on the armed section: jumps now, after the MIDI lookahead, so queued cues still belong to the passage being left. */
  jumpSectionNow = (id: string) => this.sectionsPart.jumpSectionNow(id);

  /** Loops a section until it is released; tapping the looping section releases it. */
  toggleSectionLoop = (id: string) => this.sectionsPart.toggleSectionLoop(id);

  /** Releases the loop of the section being played, whether it was started live or is the section's own mode. */
  releaseSectionLoop = () => this.sectionsPart.releaseSectionLoop();

  /** Cancels the armed jump. A decision already made for it is put back too, where that is still possible. */
  cancelSectionJump = () => this.sectionsPart.cancelSectionJump();

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
  sectionOrder() {
    return this.sectionsPart.sectionOrder();
  }

  stepSection(step: 1 | -1) {
    return this.sectionsPart.stepSection(step);
  }

  sectionAt(n: number, run: (id: string) => void) {
    return this.sectionsPart.sectionAt(n, run);
  }
}

/** Subscribes a component to the session state. */
export function useSession<T>(session: PerformanceSession, select: (state: SessionState) => T): T {
  return useStore(session.store, select);
}
