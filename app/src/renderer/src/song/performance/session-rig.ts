import { stageOperationActive } from "@/state/stage-operation";
import type { Hint } from "./actions";
import { usePedalLibrary } from "./pedal-library";
import { readOptions } from "./settings";
import { chaseTriggers, type SessionCore } from "./session-core";
import { readRigSolo, rigPedalFor, rigResetMessages, soloMessages, soloReturn, updateRigState, type RigState, type SoloMode } from "./rig-state";

export class SessionRig {
  private pending = new Set<ReturnType<typeof setTimeout>>();
  private active: { plan: ReturnType<typeof soloMessages>; before: RigState; softened: boolean } | null = null;

  constructor(private readonly core: SessionCore) {}

  clearQueued(): void {
    for (const timer of this.pending) clearTimeout(timer);
    this.pending.clear();
  }

  newSong(): void {
    this.clearQueued();
    this.active = null;
    this.core.set({ rigState: {}, soloActive: false });
  }

  observe(bytes: readonly number[], incoming: boolean, timestamp?: number): void {
    const library = usePedalLibrary.getState();
    const id = rigPedalFor(bytes, library, this.core.state.tempoChannel, incoming);
    if (!id) return;
    const now = performance.now();
    const output = this.core.output;
    const update = () => {
      const state = this.core.state.rigState;
      const next = updateRigState(state, id, bytes, timestamp ?? now, incoming ? "pedal" : "sent");
      if (next !== state) this.core.set({ rigState: next });
    };
    if (timestamp === undefined || timestamp <= now) {
      update();
      return;
    }
    const timer = setTimeout(() => {
      this.pending.delete(timer);
      if (this.core.output === output && output?.state === "connected") update();
    }, timestamp - now);
    this.pending.add(timer);
  }

  private messagesHere(start: boolean): number[][] {
    const { player, tempoChannel } = this.core.state;
    return rigResetMessages(this.core.playCues(this.core.state), player?.position ?? 0, start, usePedalLibrary.getState(), tempoChannel, chaseTriggers());
  }

  reset(start = false): Hint {
    if (stageOperationActive()) return "Finish the pedal operation before resetting the rig.";
    if (!this.core.armed) return "Enable Send cues to reset the rig.";
    if (this.active) this.solo("off");
    const messages = this.messagesHere(start);
    if (!messages.length) return "No saved pedal state at this position.";
    for (const bytes of messages) this.core.sendPerformance(bytes, undefined, start ? "Reset rig to start" : "Reset rig to here");
  }

  solo(request: SoloMode): Hint {
    if (stageOperationActive()) return "Finish the pedal operation before using Solo.";
    if (!this.core.armed) return "Enable Send cues to use live Solo.";
    const { tempoChannel, rigState, bandVariant } = this.core.state;
    const library = usePedalLibrary.getState();
    const turnOn = request === "on" || (request === "toggle" && !this.active);
    const active = this.active;
    if (turnOn) {
      if (active) return;
      const settings = readOptions<{ rigSolo?: unknown }>(this.core.songSettingsKey, {});
      const options = readRigSolo(settings.rigSolo);
      const plan = soloMessages(options, rigState, library, tempoChannel);
      const softened = options.softenBand === true && bandVariant === "normal" && !!this.core.state.player?.renderedBandAvailable;
      if (!plan.send.length && !softened) return "Add a Solo change or assign the pedal control.";
      for (const bytes of plan.send) {
        if (!this.core.armed) return "The MIDI output disconnected during Solo.";
        this.core.sendPerformance(bytes, undefined, "Solo on");
      }
      if (!this.core.armed) return "The MIDI output disconnected during Solo.";
      if (softened) this.core.changeBandVariant("soft");
      this.active = { plan, before: rigState, softened };
      this.core.set({ soloActive: true });
    } else if (active) {
      for (const bytes of soloReturn(active.plan, this.messagesHere(false), active.before, library, tempoChannel)) {
        if (!this.core.armed) break;
        this.core.sendPerformance(bytes, undefined, "Solo off");
      }
      if (active.softened) this.core.changeBandVariant("normal");
      this.active = null;
      this.core.set({ soloActive: false });
    }
  }
}
