import { pedalTempoMessages } from "./pedal-tempo";
import { preparationSequence, type PreparationSequence } from "./preparation-sequence";
import { effectiveBpm } from "./speed";
import { useSongLibrary } from "@/song/library";
import { countLeadSeconds, type DrummerCount } from "@/song/performance/drummer-count";
import { stageOperationActive } from "@/state/stage-operation";
import { showToast } from "@/app/notify";
import { beatSeconds, countInBeats, preRollStart } from "@/song/performance/rhythm";
import { midiNow, prepareMidiScheduler } from "@/song/performance/midi-scheduler-client";
import { CHASE_LEAD_MS, chaseTriggerSet, computeChaseState } from "@/song/performance/midi-chase";
import { canStartRhythm, hasPedalRhythm, RHYTHM_MEMORY_SETTLE_MS, RHYTHM_RESTART, rhythmMemory, rhythmMemoryKey } from "./rhythm-runtime";
import { timecodeOffsetFrames } from "@/song/performance/timecode";
import { useMidiDiagnostics } from "@/song/performance/midi-diagnostics";
import { chaseTriggers, type MidiOutput, selectArmed, selectOutput, type SessionCore } from "./session-core";

/**
 * A start with app clock and no count-in holds the audio back this long, so Start and the first clock pulses go out before it. The
 * scheduler starts about 100 ms after Play and anchors the pulses on the audio start. Without the hold, the pulses for that first
 * 100 ms are already overdue when it starts, and go out in one burst. With the hold they are due on time.
 */
const CLOCK_LEAD_MS = 150;

/** Start: preparing the pedals, the start delay, the count-in, and starting the audio and the scheduler. */
export class SessionStart {
  constructor(private readonly core: SessionCore) {}

  private cancelDelay: (() => void) | null = null;
  private rhythmTestCleanup: (() => void) | null = null;

  private preparationKey(state = this.core.state): string {
    const player = state.player;
    return JSON.stringify({
      song: this.core.songSettingsKey,
      position: player?.position,
      start: player?.start,
      end: player?.duration,
      rate: player?.playbackRate,
      cues: this.core.playCues(state),
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

  readyFor(state = this.core.state): boolean {
    return (
      !!this.core.readySetup &&
      this.core.readySetup.player === state.player &&
      this.core.readySetup.output === selectOutput(state) &&
      selectArmed(state) &&
      selectOutput(state)?.state === "connected" &&
      this.core.readySetup.key === this.preparationKey(state)
    );
  }

  /** Readiness describes what we sent on this connection, never a hardware acknowledgement. */
  invalidatePreparation = () => {
    if (!this.core.readySetup && !this.core.state.pedalsReady) return;
    this.core.readySetup = null;
    this.core.openingPrepared = undefined;
    this.core.store.setState({ pedalsReady: false });
  };

  /** Explicitly allows once commands again. It sends nothing until the next Prepare or Play. */
  resetPreparationCommands = () => {
    if (this.core.playPending || this.core.state.playing) {
      this.core.fail("Stop playback or cancel preparation before resetting once commands.");
      return;
    }
    this.core.preparationHistory.reset();
    this.invalidatePreparation();
    this.core.set({ preparationOnceUsed: 0 });
  };

  /** Waits out the start delay. Cancelling resolves the wait at once. */
  /**
   * The drummer's count for a start, or undefined when the song has none or its settings no longer ask for one. It plays through the
   * generated drums' track, and only from stopped: a join into the next song passes no count (a count under a crossfade makes no sense).
   */
  private drummerCount(): DrummerCount | undefined {
    const drums = this.core.bandExtras.drums;
    const count = drums?.extras.countIn;
    if (!drums || !count || !this.core.drummerCounts) return undefined;
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
    this.core.playRequest++;
    this.core.playPending = false;
    this.core.set({ starting: false, preparing: null, preparationPlan: null });
    const cancel = this.cancelDelay;
    this.cancelDelay = null;
    cancel?.();
  }

  /** Cancels a start that is still waiting (the start delay, or a worker). A second Play press does this. Once audio has begun it does nothing. */
  cancelStart = () => {
    if (this.core.playPending) this.core.pause();
  };

  /** Hardware checks restore their temporary tempo before the transport can start. */
  registerRhythmTestCleanup(cleanup: () => void): () => void {
    this.rhythmTestCleanup = cleanup;
    return () => {
      if (this.rhythmTestCleanup === cleanup) this.rhythmTestCleanup = null;
    };
  }

  start = async (prepareOnly: boolean) => {
    if (stageOperationActive()) {
      this.core.fail("Close native pedal transfer before starting playback.");
      return;
    }
    const loopPass = this.core.restartingLoop;
    this.core.restartingLoop = false;
    let { player } = this.core.state;
    if (!player || this.core.state.parseError || this.core.playPending || player.isPlaying) return;
    if (this.core.armed && hasPedalRhythm(this.core.state.cues) && !canStartRhythm(this.core.state.cues, player.position)) {
      this.core.set({ rhythmRestart: true });
      this.core.fail(RHYTHM_RESTART);
      return;
    }
    if (this.core.armed && hasPedalRhythm(this.core.state.cues) && this.core.behaviourOf(player) === "loop") {
      this.core.fail("Turn off the playlist entry’s whole-song loop before using automatic RC-10R drums.");
      return;
    }
    if (prepareOnly && (!this.core.armed || this.core.output?.state !== "connected" || !this.core.state.preparationSettings?.enabled)) {
      this.core.fail("Connect a MIDI output, enable Send cues and Before song preparation, then prepare again.");
      return;
    }
    if (prepareOnly && this.readyFor()) return;
    this.rhythmTestCleanup?.();
    const request = ++this.core.playRequest;
    this.core.playPending = true;
    this.core.set({ starting: true, error: "" });
    let armed = this.core.armed,
      output = this.core.output;
    try {
      let speedPreparation: Promise<void> | null;
      do {
        speedPreparation = this.core.speedPreparation;
        if (speedPreparation) await speedPreparation;
      } while (speedPreparation !== this.core.speedPreparation);
      if (request !== this.core.playRequest) return;
      player = this.core.state.player;
      if (!player || this.core.state.parseError) return;
      armed = this.core.armed;
      output = this.core.output;
      const cached = this.readyFor() ? this.core.readySetup : null;
      if (armed && !cached && !this.core.state.preparationSettings?.enabled && hasPedalRhythm(this.core.state.cues)) {
        if (!canStartRhythm(this.core.state.cues, player.position)) {
          this.core.set({ rhythmRestart: true });
          throw new Error(RHYTHM_RESTART);
        }
        let preparedKey: string;
        do {
          preparedKey = rhythmMemoryKey(this.core.state.cues);
          for (const bytes of rhythmMemory(this.core.state.cues)) this.core.sendPerformance(bytes, undefined, "RC-10R memory preparation");
          await this.waitStartDelay(RHYTHM_MEMORY_SETTLE_MS / 1000);
          if (request !== this.core.playRequest) return;
          if (!this.core.armed || this.core.output !== output) throw new Error("MIDI output changed while preparing the RC-10R. Play from beginning again.");
        } while (preparedKey !== rhythmMemoryKey(this.core.state.cues));
        this.core.set({ rhythmRestart: false });
      }
      // An offset that is not valid at the rate stops the start, rather than sending the wrong position.
      if (armed) timecodeOffsetFrames(this.core.state.timecode);
      if (armed && !this.core.readyWorker) {
        const warm = this.core.prepared ?? prepareMidiScheduler();
        this.core.prepared = warm;
        await warm.ready;
        if (request !== this.core.playRequest) return;
        this.core.readyWorker = warm.worker;
        this.core.prepared = null;
      }
      armed = this.core.armed;
      output = this.core.output;
      const { bpm, timing } = this.core.state;
      const tempoMessages = this.tempoMessages(armed, output);
      const requestedPosition = player.position >= player.duration ? player.start : Math.max(0, player.position);
      const preparationPosition = preRollStart(requestedPosition, timing.preRollBeats, bpm);
      const preparation = loopPass ? null : this.core.state.preparationSettings;
      let prepared = !!cached;
      if (cached) this.core.openingPrepared = cached.opening;
      if (armed && preparation && !cached) {
        const sequence = preparationSequence({
          cues: this.core.playCues(this.core.state),
          position: preparationPosition,
          requestedPosition,
          start: player.start,
          settings: preparation,
          triggers: chaseTriggers(),
          history: this.core.preparationHistory,
          pedalChannel: this.core.state.tempoChannel,
          tempo: tempoMessages,
        });
        if (!preparation.enabled && sequence.skipped.length) {
          const warning = "Before song preparation is disabled. Its commands were skipped; playback continues.";
          this.core.setMidiStatus(warning);
          showToast({ tone: "info", title: "Before song commands skipped", body: warning });
        }
        if (preparation.enabled) {
          prepared = true;
          const check = () => request === this.core.playRequest && this.core.armed && this.core.output === output && output?.state === "connected";
          const commands = sequence.steps.reduce((total, step) => total + (step.kind === "send" ? step.commands.length : 0), 0);
          this.core.set({ preparationPlan: sequence });
          for (const [index, step] of sequence.steps.entries()) {
            this.core.set({ preparing: { label: step.label, until: performance.now() + (step.kind === "wait" ? step.durationMs : 0), commands, step: index } });
            if (step.kind === "wait") {
              await this.waitStartDelay(step.durationMs / 1000);
              if (request !== this.core.playRequest) return;
            } else
              for (const command of step.commands) {
                if (!check()) throw new Error("MIDI preparation was interrupted. Check the output and press Play again.");
                // A failed send may still have reached a pedal, so once commands are consumed before the first attempt.
                if (this.core.preparationHistory.started(command.onceKey)) this.core.set({ preparationOnceUsed: this.core.preparationHistory.size });
                this.core.sendPerformance(command.bytes, undefined, step.origin === "tempo" ? "Song tempo" : `Before song: ${step.label}`);
              }
            if (!check()) throw new Error("MIDI output changed during preparation. Check it and press Play again.");
          }
          this.core.openingPrepared = { position: preparationPosition, messages: sequence.suppressed };
          this.core.set({ rhythmRestart: false });
        }
      }
      if (prepareOnly) {
        if (!armed || !this.core.openingPrepared || !this.core.output || !this.core.armed) throw new Error("MIDI preparation is no longer valid. Prepare again.");
        this.core.readySetup = { player, output: this.core.output, key: this.preparationKey(), opening: this.core.openingPrepared };
        this.core.set({ pedalsReady: true, preparing: null });
        return;
      }
      await this.waitStartDelay(timing.startDelay);
      if (request !== this.core.playRequest) return;
      // The count-in is clicked before the audio starts, so it begins with the tempo message.
      const countIn = countInBeats(timing.countInBars, timing.beatsPerBar);
      // The count-in is as long as the audio it leads: beats at the song tempo times the rate. The drummer's count, when it plays, leads the
      // song too, and the longer of the two is what the tempo message and the cues wait for.
      const chaseStart = preRollStart(requestedPosition, timing.preRollBeats, bpm);
      const drummer = this.drummerCount();
      const drummerMs = countLeadSeconds(drummer, chaseStart, player.playbackRate) * 1000;
      this.core.countInMs = Math.max(bpm > 0 ? (countIn * beatSeconds(bpm) * 1000) / player.playbackRate : 0, drummerMs);
      // A chase that the pedals need before the song begins holds the audio back by CHASE_LEAD_MS, so it goes out first. Nothing is held
      // when the output is not armed, or when there is no state to chase (a start from the beginning, or no cues before the position).
      const settled = new Set(this.core.openingPrepared?.messages.map((bytes) => bytes.join(",")));
      const chaseLead =
        armed &&
        computeChaseState(this.core.playCues(this.core.state), chaseStart, chaseTriggerSet(chaseTriggers())).some((message) => !settled.has(message.bytes.join(",")))
          ? CHASE_LEAD_MS
          : 0;
      // Clock without a count-in has no lead-in to cover the scheduler's start, so the hold is CLOCK_LEAD_MS.
      const clockLead = armed && this.core.state.clock && !this.core.state.timecode.enabled && countIn === 0 && drummerMs === 0 ? CLOCK_LEAD_MS : 0;
      const lead = Math.max(chaseLead, clockLead) / 1000;
      this.core.transportAt = lead ? midiNow() + lead * 1000 : null;
      await player.play({
        bpm,
        countInBeats: countIn,
        preRollBeats: timing.preRollBeats,
        ...(lead ? { startDelay: lead } : {}),
        ...(drummer ? { drummer } : {}),
      });
      if (request !== this.core.playRequest) {
        player.pause();
        this.core.terminateWorker();
        return;
      }
      this.core.startTempo = prepared ? null : tempoMessages;
      // Every start and resume sends the play trigger, except a loop pass, which is not a new play press.
      this.core.startPlay = loopPass ? null : this.core.triggerBytes("play");
      // Cues start from where the audio really starts: a pre-roll puts that before the requested position.
      this.core.startPosition = armed ? preRollStart(requestedPosition, timing.preRollBeats, bpm) : null;
      this.core.set({ playing: true, preparing: null });
    } catch (e) {
      this.core.terminateWorker();
      if (request === this.core.playRequest) {
        this.core.batch(() => {
          if (armed) {
            useMidiDiagnostics.getState().fault(String(e));
            this.core.setArmed(false);
            if (this.core.state.queued) useSongLibrary.getState().rememberMidi(null);
          }
          this.core.fail(e);
          if (this.core.state.playlistPlaying) useSongLibrary.getState().pausePlaylist();
        });
      }
    } finally {
      if (request === this.core.playRequest) {
        this.core.playPending = false;
        this.core.set({ starting: false, preparing: null, preparationPlan: null });
      }
    }
  };

  /** The one-time tempo message a start sends, or null when it sends none. Throws when the tempo is out of range. */
  tempoMessages(armed: boolean, output: MidiOutput | undefined, rate = this.core.state.player?.playbackRate ?? 1): number[][] | null {
    const { tempoOnStart } = this.core.state;
    if (!armed || !tempoOnStart || output?.state !== "connected") return null;
    // The pedal is sent the tempo the song plays at, so the range is checked on the effective BPM.
    return this.configuredTempoMessages(rate);
  }

  private configuredTempoMessages(rate = this.core.state.player?.playbackRate ?? 1): number[][] {
    const { tempoChannel, bpm } = this.core.state;
    const tempoBpm = effectiveBpm(this.core.state.rhythmTempo ?? bpm, rate);
    return pedalTempoMessages(tempoBpm, tempoChannel);
  }

  /** Read-only: this never consumes repeat rules or sends MIDI. */
  preparationPreview(): PreparationSequence | null {
    if (this.core.state.preparationPlan) return this.core.state.preparationPlan;
    const { player, preparationSettings: settings, bpm, timing } = this.core.state;
    if (!player || !settings?.enabled) return null;
    const requestedPosition = player.position >= player.duration ? player.start : Math.max(0, player.position);
    return preparationSequence({
      cues: this.core.playCues(this.core.state),
      position: preRollStart(requestedPosition, timing.preRollBeats, bpm),
      requestedPosition,
      start: player.start,
      settings,
      triggers: chaseTriggers(),
      history: this.core.preparationHistory,
      pedalChannel: this.core.state.tempoChannel,
      tempo: this.core.state.tempoOnStart ? this.configuredTempoMessages() : null,
    });
  }
}
