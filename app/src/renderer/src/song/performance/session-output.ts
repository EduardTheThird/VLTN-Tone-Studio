import { stageOperationActive } from "@/state/stage-operation";
import { type Cue, expandSectionCues, type MidiTrigger } from "@/song/performance/chart";
import { midiNow, type SchedulerDegraded } from "@/song/performance/midi-scheduler-client";
import { configuredPedals, usePedalLibrary } from "@/song/performance/pedal-library";
import { hasPedalRhythm } from "./rhythm-runtime";
import { TriggerPulses } from "./trigger-pulse";
import { orderForPedal } from "@/song/performance/midi-pedal-order";
import type { Section } from "@/song/performance/sections";
import { useMidiDiagnostics } from "@/song/performance/midi-diagnostics";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import {
  BLUETOOTH_PORT_ID,
  type MidiOutput,
  type PanicContext,
  portIsDead,
  REARMED_STATUS,
  RECONNECTED_STATUS,
  type SessionCore,
  type SessionState,
} from "./session-core";

// Output queues outlive a song session during playlist handovers; their controller state must too.
const rc10rPulses = new TriggerPulses();

/** MIDI output: arming, sending, panic, the song's triggers and opening system MIDI. */
export class SessionOutput {
  constructor(private readonly core: SessionCore) {}

  /** Stop and end messages waiting for the effects that the stop caused to finish (see `sendTriggers`). */
  private heldTriggers: { bytes: number[]; kind: MidiTrigger }[] = [];
  private clearedOutput: MidiOutput | undefined;
  private tempoMsb = new Map<number, number>();
  private noteChannels = new Set<number>();
  private expandedCues: { cues: Cue[]; sections: Section[]; value: Cue[] } | null = null;

  /**
   * The cues the scheduler and the state chase use: the chart's cues, with each section cue turned into timed cues at the start of the sections
   * it names. The same array while neither the cues nor the sections change, and the chart's own array when it has no section cues, so a chart
   * without them behaves exactly as before.
   */
  playCues(s: Pick<SessionState, "cues" | "sections">): Cue[] {
    const cached = this.expandedCues;
    if (cached && cached.cues === s.cues && cached.sections === s.sections) return cached.value;
    const value = expandSectionCues(s.cues, s.sections);
    this.expandedCues = { cues: s.cues, sections: s.sections, value };
    return value;
  }

  /** The messages of the song's triggers of one kind, in chart order. */
  triggerBytes(kind: MidiTrigger): number[][] {
    return this.core.state.cues.filter((cue) => cue.trigger === kind).flatMap((cue) => cue.messages);
  }

  /**
   * Sends the song's `{midi@…}` messages of one kind, once each. Nothing is sent unless the session is armed, and a failed send is reported
   * rather than thrown, because a trigger must never stop the transport.
   *
   * A stop or end is sent only after the batch that caused it has run its effects. That stop clears the output, and the transport's cleanup
   * clears it again, which would drop a message still waiting in a Bluetooth buffer. So while a batch is open or its effects are running,
   * these messages are held and sent by `flush`, once the effects are done.
   */
  sendTriggers(kind: MidiTrigger, cues: Cue[] = this.core.state.cues): void {
    if (!this.core.armed) return;
    try {
      const messages = orderForPedal(
        cues.filter((cue) => cue.trigger === kind).flatMap((cue) => cue.messages),
        this.core.state.tempoChannel,
        (bytes) => bytes,
      );
      if ((kind === "stop" || kind === "end") && (this.core.batchDepth > 0 || this.core.flushing)) {
        for (const bytes of messages) this.heldTriggers.push({ bytes, kind });
        return;
      }
      for (const bytes of messages) this.sendPerformance(bytes, undefined, `Song ${kind} trigger`);
    } catch (e) {
      this.core.fail(e);
    }
  }

  /** Sends the stop and end messages held by `sendTriggers`, in the order they were queued. */
  sendHeldTriggers(): void {
    while (this.heldTriggers.length) {
      const { bytes, kind } = this.heldTriggers.shift()!;
      try {
        this.sendPerformance(bytes, undefined, `Song ${kind} trigger`);
      } catch (e) {
        this.core.fail(e);
      }
    }
  }

  context(): PanicContext {
    return { output: this.core.output, armed: this.core.armed, clock: this.core.state.clock };
  }

  /** Arms or disarms this session only. Faults and output changes use it, so they leave the remembered preference alone. */
  setArmed = (value: boolean) => {
    if (this.core.playPending && this.core.state.preparing) this.core.pause();
    const wasPlaying = this.core.state.playing && hasPedalRhythm(this.core.state.cues);
    this.core.set({ armedOutput: value ? (this.core.output ?? null) : null, armedByPreference: false });
    if (wasPlaying) {
      this.core.pause();
      this.core.set({ rhythmRestart: true });
    }
  };

  /** The Send cues choice: arms or disarms, and remembers it for the selected output so later songs and sessions follow. */
  sendCues = (on: boolean) => {
    const { portId } = this.core.state;
    useMidiConfiguration.getState().update({ sendCues: { on, outputId: on ? portId : "" } });
    this.setArmed(on);
  };

  /** The explicit stop: disarms and turns the remembered preference off. */
  disarm = () => {
    if (hasPedalRhythm(this.core.state.cues)) this.core.pause();
    this.sendCues(false);
  };

  /** Whether the Send cues preference was turned on for this port. */
  rememberedFor(portId: string): boolean {
    const { on, outputId } = useMidiConfiguration.getState().sendCues;
    return on && outputId !== "" && outputId === portId;
  }

  /** Arms the selected output when the preference is on for it and it is connected. Returns whether it armed. */
  armRemembered(): boolean {
    const output = this.core.output;
    if (!output || output.state !== "connected" || !this.rememberedFor(this.core.state.portId)) return false;
    this.core.set({ armedOutput: output, armedByPreference: true });
    return true;
  }

  /** Stops the scheduler and releases anything this session started. A second call for one stop does nothing. */
  panic = (context: PanicContext = this.context()) => {
    this.core.invalidatePreparation();
    this.core.startPosition = null;
    this.core.openingPrepared = undefined;
    this.core.scheduler?.stop();
    this.core.scheduler = null;
    const { output, armed, clock } = context;
    if (stageOperationActive() || !output || this.clearedOutput === output) return;
    // Pause handlers and lifecycle cleanup can both run for one stop.
    // A second clear would cancel the BLE note releases queued by the first.
    this.clearedOutput = output;
    this.core.clearQueuedRig();
    try {
      (output as { clear?: () => void }).clear?.();
      if (!armed || output.state !== "connected") {
        this.noteChannels.clear();
        return;
      }
      for (const release of rc10rPulses.releasesAfterClear(output, performance.now())) {
        output.send(release.bytes, release.timestamp);
        this.recordQueued(release.bytes, release.timestamp, "RC-10R control release");
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
      if (clock && this.core.stoppedOn !== output) {
        output.send([252]);
        this.recordQueued([252], undefined, "Transport Stop");
        this.core.stoppedOn = output;
      }
    } catch (e) {
      useMidiDiagnostics.getState().fault(String(e));
      this.core.fail(e);
    }
  };

  private recordQueued(bytes: number[], timestamp?: number, label = "Manual / transport") {
    // Whatever leaves the app may come back in through a THRU input, and must not be taken for a press. A scheduled message is
    // timed from its wire time, not from when it was queued, since USB cues are queued up to a second ahead.
    this.core.remote.echo.record(bytes, timestamp ?? performance.now());
    if (bytes[0] === 0xb0 + this.core.state.tempoChannel - 1 && bytes.length === 3) {
      if (bytes[1] === 73) this.tempoMsb.set(bytes[0], bytes[2]);
      if (bytes[1] === 74 && this.tempoMsb.has(bytes[0]))
        this.core.set({
          lastTempo: {
            bpm: this.tempoMsb.get(bytes[0])! * 128 + bytes[2],
            channel: this.core.state.tempoChannel,
            output: this.core.output?.name ?? "MIDI output",
          },
        });
    }
    const queued = midiNow(),
      intended = (timestamp ?? performance.now()) + performance.timeOrigin;
    useMidiDiagnostics.getState().record({ label, intended, queued, lateMs: Math.max(0, queued - intended), bytes });
  }

  sendPerformance = (bytes: number[], timestamp?: number, label = "Manual / transport") => {
    if (stageOperationActive()) return;
    if (!this.core.playPending) this.core.invalidatePreparation();
    this.clearedOutput = undefined;
    if (this.core.state.armedOutput && portIsDead(this.core.output)) {
      this.deadOutput("MIDI output is no longer connected. Cues disarmed.");
      return;
    }
    try {
      if (this.core.output && this.isRc10rTrigger(bytes)) timestamp = rc10rPulses.timestamp(this.core.output, bytes, timestamp, performance.now());
      this.core.output?.send(bytes, timestamp);
    } catch (e) {
      this.deadOutput(`MIDI send failed: ${e instanceof Error ? e.message : String(e)}. Cues disarmed.`);
      return;
    }
    if (this.core.output) this.core.observeRig(bytes, false, timestamp);
    this.recordQueued(bytes, timestamp, label);
    if ((bytes[0] & 240) === 144 || (bytes[0] & 240) === 128) this.noteChannels.add(bytes[0] & 15);
  };

  private isRc10rTrigger(bytes: number[]): boolean {
    if (bytes.length !== 3 || (bytes[0] & 240) !== 176 || ![0, 127].includes(bytes[2])) return false;
    const channel = (bytes[0] & 15) + 1;
    const pedal = configuredPedals(usePedalLibrary.getState()).find((entry) => entry.name === "BOSS RC-10R");
    return (
      !!pedal?.triggers.some(([ch, cc]) => ch === channel && cc === bytes[1]) ||
      this.core.state.cues.some((cue) => cue.managed === "rhythm" && cue.messages.some((message) => message[0] === bytes[0] && message[1] === bytes[1]))
    );
  }

  /** Disarms because the output can no longer take messages. Armed cues are never dropped without a visible fault. */
  deadOutput(message: string): void {
    useMidiDiagnostics.getState().fault(message);
    this.core.clearQueuedRig();
    this.core.batch(() => {
      this.setArmed(false);
      if (hasPedalRhythm(this.core.state.cues)) {
        this.core.pause();
        this.core.set({ rhythmRestart: true });
      }
      this.core.fail(message);
    });
  }

  degraded = (event: SchedulerDegraded) => {
    const diagnostics = useMidiDiagnostics.getState(),
      now = midiNow();
    if (event.resynced) diagnostics.resync();
    if (event.dropped.length)
      diagnostics.drop(event.dropped.map((m) => ({ label: m.label, intended: m.due, queued: now, lateMs: Math.max(0, now - m.due), bytes: m.bytes })));
    // Events from one stall arrive separately (resync, then drops); show them as one notice.
    const n = this.core.state.lateNotice;
    const recent = n !== null && now - n.at < 2000;
    this.core.set({
      lateNotice: {
        dropped: (recent ? n.dropped : 0) + event.dropped.length,
        position: event.position,
        resynced: (recent && n.resynced) || event.resynced,
        at: now,
      },
    });
  };

  /** Enable USB / system MIDI. Always asks for a fresh access, so a port re-enumerated since then is the object sent to. */
  connectMidi = () => this.openMidi();

  /**
   * After sleep the ports from before are stale, so the system's ports are requested again. A warm scheduler worker from before the sleep
   * is dropped too, so Play builds a fresh one.
   */
  resumeMidi = () => {
    if (this.core.prepared) {
      this.core.prepared.cancel();
      this.core.prepared = null;
    }
    if (this.core.state.access) void this.openMidi();
  };

  async openMidi(): Promise<void> {
    // Read before the request: the armed output is compared with the new one once access is replaced.
    const wasArmed = !!this.core.state.armedOutput;
    this.core.set({ midiStatus: "Opening USB / system MIDI…" });
    try {
      const next = await navigator.requestMIDIAccess({ sysex: true });
      const connectedOutputs = [...next.outputs.values()].filter((p) => p.state === "connected");
      const { portId } = this.core.state;
      const remembered = portId !== BLUETOOTH_PORT_ID && next.outputs.get(portId)?.state === "connected";
      if (portId !== BLUETOOTH_PORT_ID) this.core.portLost = !remembered;
      let midiStatus = connectedOutputs.length
        ? `USB / system MIDI ready: ${connectedOutputs.map((p) => p.name || p.id).join(", ")}. Select an output and enable Send cues.`
        : "USB / system MIDI is enabled, but no outputs are available. Connect the pedal and close other MIDI apps, then try again.";
      if (wasArmed && remembered) midiStatus = RECONNECTED_STATUS;
      else if (wasArmed) useMidiDiagnostics.getState().fault("System MIDI output disconnected. Cues disarmed.");
      this.core.batch(() => {
        this.core.set({ access: next, midiStatus });
        if (remembered && this.armRemembered()) this.core.set({ midiStatus: REARMED_STATUS });
      });
    } catch (e) {
      this.core.set({ midiStatus: "USB / system MIDI could not be opened." });
      this.core.fail(e);
    }
  }
}
