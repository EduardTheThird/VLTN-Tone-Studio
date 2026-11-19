import { StemPlayer } from "@/song/stems/player";
import { useSongLibrary } from "@/song/library";
import { setStageBusy } from "@/state/stage-activity";
import { startPlaybackClock } from "@/song/performance/playback-clock";
import { midiNow, prepareMidiScheduler, startMidiScheduler } from "@/song/performance/midi-scheduler-client";
import { hasPedalRhythm, rhythmMemory, rhythmMemoryKey } from "./rhythm-runtime";
import { BLUETOOTH_LOOKAHEAD, SYSTEM_LOOKAHEAD } from "@/song/performance/midi-scheduler";
import { timecodeOffsetFrames } from "@/song/performance/timecode";
import { useMidiDiagnostics } from "@/song/performance/midi-diagnostics";
import { rememberedPort } from "@/song/performance/midi-configuration";
import {
  BLUETOOTH_PORT_ID,
  chaseTriggers,
  type Effect,
  portIsDead,
  REARMED_STATUS,
  RECONNECTED_STATUS,
  selectArmed,
  selectOutput,
  type SessionCore,
  type SessionState,
} from "./session-core";

/** How often the session checks whether the next playlist song can be chained onto this one */
const CHAIN_CHECK_MS = 250;

/** How often the place in the song is kept for a renderer crash while it plays (spec 120). */
const RESUME_SAVE_MS = 2000;

/** The effects the session runs when its state changes, and the MIDI scheduler effect. */
export class SessionEffects {
  constructor(private readonly core: SessionCore) {}

  /** The player whose `{midi@load}` messages were sent while armed. Disarming clears it, so arming again sends them again. */
  private loadedPlayer: StemPlayer | null = null;
  private loadedRhythmKey = "";

  createEffects(): Effect[] {
    return [
      this.stageBusyEffect(),
      this.saveResumeEffect(),
      this.autoplayLoadedEffect(),
      this.playlistAutoplayEffect(),
      this.chainNextEffect(),
      this.stopWithPlaylistEffect(),
      this.carryMidiEffect(),
      this.transportEffect(),
      this.warmSchedulerEffect(),
      this.displayClockEffect(),
      this.sectionTicksEffect(),
      this.loadTriggersEffect(),
      this.schedulerEffect(),
      this.usbPortsEffect(),
      this.restorePortsEffect(),
      this.bluetoothLostEffect(),
      this.armingFollowsOutputEffect(),
      this.remoteInputEffect(),
    ];
  }

  /**
   * While a song plays or prepares, or a playlist runs between its songs, the editor leaves the pedal alone (see state/stage-activity.ts).
   */
  private stageBusyEffect(): Effect {
    return {
      deps: (s) => [s.playing, s.starting, s.preparing !== null, s.playlistPlaying],
      run: (s) => setStageBusy(s.playing || s.starting || s.preparing !== null || s.playlistPlaying, this.core),
    };
  }

  /** The place in the song is kept every two seconds while it plays, and at once when a song loads, plays or pauses. */
  private saveResumeEffect(): Effect {
    return {
      deps: (s) => [s.playing, s.player],
      run: (s) => {
        if (!s.player) return;
        this.core.saveResume();
        if (!s.playing) return;
        const timer = setInterval(this.core.saveResume, RESUME_SAVE_MS);
        return () => clearInterval(timer);
      },
    };
  }

  /** A song a MIDI trigger loaded starts once its player is ready and the library is no longer loading. */
  private autoplayLoadedEffect(): Effect {
    return {
      deps: (s) => [s.player, s.busy],
      run: (s) => {
        if (!this.core.autoplayPending || !s.player || s.busy) return;
        this.core.autoplayPending = false;
        void this.core.play();
      },
    };
  }

  /** A playlist song starts itself once it is the current one and nothing is loading, unless its entry asks to wait for Play. */
  private playlistAutoplayEffect(): Effect {
    return {
      deps: (s) => [s.player, s.queued, s.playlistPlaying, s.busy],
      run: (s) => {
        if (!s.queued || !s.playlistPlaying || s.busy || !s.player) return;
        if (useSongLibrary.getState().queueOverrides[useSongLibrary.getState().position]?.autoplay === false) return;
        if (s.parseError) {
          this.core.fail(s.parseError);
          useSongLibrary.getState().pausePlaylist();
          return;
        }
        void this.core.play();
      },
    };
  }

  /** Chains the next playlist song onto this.core one once its join is close, so that the two play on one clock. */
  private chainNextEffect(): Effect {
    return {
      deps: (s) => [s.player, s.playing, s.queued, s.playlistPlaying],
      run: (s) => {
        if (!s.playing || !s.player || !s.queued || !s.playlistPlaying) return;
        const timer = setInterval(() => this.core.planNext(), CHAIN_CHECK_MS);
        return () => clearInterval(timer);
      },
    };
  }

  /** Stopping the playlist from elsewhere stops this.core song. */
  private stopWithPlaylistEffect(): Effect {
    return {
      deps: (s) => [s.playlistPlaying],
      run: (s) => {
        if (!s.playlistPlaying && s.player?.isPlaying && s.queued) {
          this.core.cancelPendingStart();
          this.core.dropSectionPlan();
          this.core.dropChained();
          s.player.pause();
          this.core.set({ playing: false });
          this.core.panic();
          this.core.sendTriggers("stop");
        }
      },
    };
  }

  /**
   * Carry the MIDI to the next song: the access, output and input to any song loaded next, and arming only while a playlist plays,
   * so a stopped playlist cannot leave an armed flag that re-arms a later join.
   */
  private carryMidiEffect(): Effect {
    return {
      deps: (s) => [s.queued, s.playlistPlaying, s.busy, s.access, s.portId, s.inputId, selectArmed(s), selectOutput(s)],
      run: (s) => {
        if (s.busy) return;
        useSongLibrary
          .getState()
          .rememberMidi({ access: s.access, portId: s.portId, inputId: s.inputId, armed: selectArmed(s) && s.playlistPlaying, output: selectOutput(s) });
      },
    };
  }

  /**
   * Transport lifecycle is separate from tempo-dependent scheduling.
   * A song that joins a set already running sends no Start: the set's Start went out with its first song.
   * A delayed start sends its Start or Continue when the audio begins, after the chase.
   * A song handed over stays on the set's transport, so leaving this.core session does not stop it.
   */
  private transportEffect(): Effect {
    return {
      deps: (s) => [s.playing, selectArmed(s), selectOutput(s), s.clock],
      run: (s) => {
        if (!s.playing) return;
        const context = this.core.context();
        const joined = this.core.joining;
        this.core.joining = false;
        const at = this.core.transportAt;
        this.core.transportAt = null;
        if (context.armed && s.clock && !s.timecode.enabled && !joined) {
          try {
            this.core.stoppedOn = undefined;
            this.core.sendPerformance([(s.player?.position ?? 0) < 0.05 ? 250 : 251], at === null ? undefined : at - performance.timeOrigin);
          } catch (e) {
            this.core.fail(e);
            this.core.setArmed(false);
          }
        }
        return () => {
          if (!this.core.passing) this.core.panic(this.core.endingIntoSet ? { ...context, clock: false } : context);
        };
      },
    };
  }

  /** Warm the scheduler worker while armed and stopped, so Play does not wait for it. */
  private warmSchedulerEffect(): Effect {
    return {
      deps: (s) => [selectArmed(s), s.playing, s.player, selectOutput(s)],
      run: (s) => {
        if (!selectArmed(s) || s.playing || !s.player) return;
        try {
          const warm = this.core.prepared ?? prepareMidiScheduler();
          this.core.prepared = warm;
          return () => {
            if (this.core.prepared === warm) {
              warm.cancel();
              this.core.prepared = null;
            }
          };
        } catch (e) {
          useMidiDiagnostics.getState().fault(String(e));
          this.core.setArmed(false);
          this.core.fail(e);
        }
      },
    };
  }

  /** Mirror the audio position into the display clock. */
  private displayClockEffect(): Effect {
    return {
      deps: (s) => [s.playing, s.player],
      run: (s) => {
        const player = s.player;
        if (!s.playing || !player) return;
        return startPlaybackClock(() => player.position);
      },
    };
  }

  /** Section boundaries: decided ahead and carried out on the audio clock while the song plays. */
  private sectionTicksEffect(): Effect {
    return {
      deps: (s) => [s.playing, s.player],
      run: (s) => {
        if (!s.playing || !s.player) return;
        const timer = setInterval(this.core.tickSections, 50);
        return () => clearInterval(timer);
      },
    };
  }

  /** A song's load triggers go out when it is loaded while armed, and again each time the session arms for it. */
  private loadTriggersEffect(): Effect {
    return {
      deps: (s) => [selectArmed(s), s.player, rhythmMemoryKey(s.cues)],
      run: (s) => {
        if (!selectArmed(s) || !s.player) {
          this.loadedPlayer = null;
          this.loadedRhythmKey = "";
          return;
        }
        const key = rhythmMemoryKey(s.cues);
        if (this.loadedPlayer === s.player) {
          if (this.loadedRhythmKey !== key && !s.playing)
            for (const bytes of rhythmMemory(s.cues)) this.core.sendPerformance(bytes, undefined, "RC-10R memory preparation");
        } else {
          this.loadedPlayer = s.player;
          this.core.sendTriggers("load", s.cues);
        }
        this.loadedRhythmKey = key;
      },
    };
  }

  /** The MIDI scheduler itself. */
  private schedulerEffect(): Effect {
    return {
      deps: (s) => [s.playing, s.player, selectArmed(s), selectOutput(s), s.clock, s.bpm, this.core.playCues(s), s.timecode],
      run: (s) => this.runScheduler(s),
    };
  }

  /**
   * A USB output that goes away disarms the session. The same port id re-enumerated as a new object is the same device:
   * it disarms without a fault, since the cues were never sent to the new object.
   * The remembered port is back: take it up again, so Enable and arming work from the new object. Opening arms it too
   * when Send cues is on for it. A port that goes away while Send cues is on is marked lost even if a fault had disarmed it.
   */
  private usbPortsEffect(): Effect {
    return {
      deps: (s) => [s.access, s.portId, s.armedOutput],
      run: (s) => {
        const access = s.access;
        if (!access) return;
        const update = () => {
          const { portId, armedOutput } = this.core.state;
          this.core.set({ portsVersion: this.core.state.portsVersion + 1 });
          if (portId === BLUETOOTH_PORT_ID) return;
          const current = access.outputs.get(portId);
          if (!armedOutput) {
            if (current?.state !== "connected" && this.core.rememberedFor(portId)) this.core.portLost = true;
            if (this.core.portLost && current?.state === "connected") void this.core.openMidi();
            return;
          }
          if (current === armedOutput && current.state === "connected") return;
          if (current?.state === "connected") {
            this.core.setArmed(false);
            this.core.set({ midiStatus: this.core.armRemembered() ? REARMED_STATUS : RECONNECTED_STATUS });
            return;
          }
          useMidiDiagnostics.getState().fault("System MIDI output disconnected. Cues disarmed.");
          this.core.portLost = true;
          this.core.setArmed(false);
        };
        access.addEventListener("statechange", update);
        return () => access.removeEventListener("statechange", update);
      },
    };
  }

  /** Restore remembered ports when they appear. */
  private restorePortsEffect(): Effect {
    return {
      deps: (s) => [s.access, s.portsVersion],
      run: (s) => {
        const access = s.access;
        if (!access) return;
        if (!access.outputs.get(s.portId) && s.savedOutput?.transport === "system") {
          const saved = rememberedPort([...access.outputs.values()], s.savedOutput);
          if (saved) this.core.setPortId(saved.id);
        }
        if (!s.inputId && s.savedInput?.transport === "system") {
          const saved = rememberedPort([...access.inputs.values()], s.savedInput);
          if (saved) this.core.setInputId(saved.id);
        }
      },
    };
  }

  /**
   * A replaced or lost Bluetooth connection disarms. This runs before the generic check below so the fault is reported.
   * A new Bluetooth connection for the remembered output is the same pedal coming back.
   */
  private bluetoothLostEffect(): Effect {
    return {
      deps: (s) => [s.bluetooth, s.portId, s.armedOutput],
      run: (s) => {
        if (this.core.previousBluetooth !== s.bluetooth && s.portId === BLUETOOTH_PORT_ID) {
          if (s.armedOutput && s.armedOutput === this.core.previousBluetooth)
            useMidiDiagnostics.getState().fault("Bluetooth output disconnected or replaced. Cues disarmed.");
          this.core.setArmed(false);
          if (this.core.armRemembered()) this.core.set({ midiStatus: REARMED_STATUS });
        }
        this.core.previousBluetooth = s.bluetooth;
      },
    };
  }

  /** Arming never survives a change of output object. */
  private armingFollowsOutputEffect(): Effect {
    return {
      deps: (s) => [s.armedOutput, selectOutput(s)],
      run: (s) => {
        if (s.armedOutput && s.armedOutput !== selectOutput(s)) this.core.setArmed(false);
      },
    };
  }

  /** Remote input: the selected input's messages run the bindings, or are learned while Learn is open. */
  private remoteInputEffect(): Effect {
    return {
      deps: (s) => [s.access, s.inputId, s.bluetooth],
      run: (s) => {
        if (s.inputId === BLUETOOTH_PORT_ID) return s.bluetooth?.subscribe(this.core.receiveMidi);
        const input = s.access?.inputs.get(s.inputId);
        if (!input) return;
        const handler = (e: MIDIMessageEvent) => {
          if (e.data) this.core.receiveMidi(e.data);
        };
        input.addEventListener("midimessage", handler);
        return () => input.removeEventListener("midimessage", handler);
      },
    };
  }

  private runScheduler(s: SessionState): void | (() => void) {
    const player = s.player;
    if (!s.playing || !player) return;
    const output = selectOutput(s);
    if (!this.core.armed || output?.state !== "connected") {
      // Armed, but the port went away: a silent stop would look like cues that never sounded.
      if (s.armedOutput && portIsDead(output)) this.core.deadOutput("MIDI output is no longer connected. Cues disarmed.");
      this.core.startPosition = null;
      this.core.startTempo = null;
      this.core.startPlay = null;
      this.core.terminateWorker();
      return;
    }
    const context = this.core.context();
    const fault = (message: string) => {
      useMidiDiagnostics.getState().fault(message);
      this.core.batch(() => {
        if (hasPedalRhythm(this.core.state.cues)) this.core.pause();
        else this.core.panic(context);
        this.core.setArmed(false);
        this.core.fail(message);
        if (this.core.state.queued) useSongLibrary.getState().rememberMidi(null);
      });
    };
    this.core.set({ lateNotice: null });
    try {
      const position = player.position;
      // Select opening cues from the requested offset, not a later render.
      // Keep the live audio clock as the origin so overdue starts still fault.
      const cuePosition = this.core.startPosition ?? position;
      this.core.startPosition = null;
      const rate = player.playbackRate;
      const origin = midiNow() - (position * 1000) / rate;
      const playTriggers = this.core.startPlay ?? [];
      this.core.startPlay = null;
      // Timecode replaces app clock: a receiver gets one source of time. The offset is checked here as well as at Play.
      const offset = timecodeOffsetFrames(s.timecode);
      const timecodeTail = this.core.incomingTail;
      this.core.incomingTail = null;
      const handle = startMidiScheduler(
        {
          cues: this.core.playCues(s),
          position: cuePosition,
          duration: player.duration,
          origin,
          // The start tempo and play trigger are due at the start of the count-in: the start position's clock time less the count-in. Song position
          // zero is not that time when starting mid-song, so the message would be older than STALE_MS and dropped.
          tempoAt: origin + (cuePosition * 1000) / rate - this.core.countInMs,
          bpm: s.rhythmTempo ?? s.bpm,
          rate,
          clock: s.clock && offset === null,
          timecode: offset === null ? undefined : { fps: s.timecode.fps, offset },
          timecodeTail: timecodeTail ?? undefined,
          tempo: this.core.startTempo,
          prepared: this.core.openingPrepared,
          playTriggers,
          lookahead: s.portId === BLUETOOTH_PORT_ID ? BLUETOOTH_LOOKAHEAD : SYSTEM_LOOKAHEAD,
          pedalChannel: s.tempoChannel,
          chaseTriggers: chaseTriggers(),
        },
        (message) => {
          // A replaced output object (same port id) is never sent to; the statechange handler disarms.
          if (this.core.output !== output) return;
          this.core.sendPerformance(message.bytes, message.due - performance.timeOrigin, message.label);
        },
        fault,
        this.core.readyWorker ?? undefined,
        this.core.degraded,
      );
      this.core.readyWorker = null;
      this.core.startTempo = null;
      this.core.openingPrepared = undefined;
      this.core.scheduler = handle;
      this.core.sendPlan();
      // Audio position is a checkpoint, not the scheduling clock. A missing or
      // frozen checkpoint makes the worker stop producing new batches.
      const timer = setInterval(() => handle.sync(player.position), 50);
      return () => {
        clearInterval(timer);
        handle.stop();
        if (this.core.scheduler === handle) this.core.scheduler = null;
      };
    } catch (e) {
      fault(e instanceof Error ? e.message : String(e));
    }
  }
}
