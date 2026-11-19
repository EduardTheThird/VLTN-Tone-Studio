import { type ExitBar, StemPlayer } from "@/song/stems/player";
import { isPlainSpeed } from "@/song/audio/render-queue";
import { clampSpeed, speedOptions, type SpeedSettings } from "./speed";
import { setClockPosition } from "@/song/performance/playback-clock";
import { getSetting, setSetting } from "@/song/performance/settings";
import { midiNow } from "@/song/performance/midi-scheduler-client";
import { hasPedalRhythm, RHYTHM_RESTART } from "./rhythm-runtime";
import { BLUETOOTH_LOOKAHEAD, type SchedulerJump, SYSTEM_LOOKAHEAD } from "@/song/performance/midi-scheduler";
import {
  armJump,
  cancelJump,
  clampSections,
  DECISION_LEAD_S,
  immediateJump,
  nextBoundary,
  releaseLoop,
  type Section,
  type SectionBoundary,
  sectionIndexAt,
  sortedSections,
  startLoop,
} from "@/song/performance/sections";
import type { Hint } from "./actions";
import { BLUETOOTH_PORT_ID, parseOptions, type SessionCore } from "./session-core";

/** A render swap waits at least this long (audio seconds) for its beat, so the MIDI schedule hears of it before it takes effect */
const RENDER_SWAP_LEAD_S = 0.3;

/** A song's options as an object. Anything that is not an object reads as empty. */
/** An exit bar plays this long before its bar begins at the latest, which is the margin the player needs to place it. */
const EXIT_LEAD_S = 0.4;

/** A pass that begins this long before its exit bar can still place it: the tick that does so runs every 50 ms. */
const EXIT_TICK_MARGIN_S = 0.1;

/** Sections: decided boundaries, loops, jumps and exits, and the speed renders that swap in on a beat. */
export class SessionSections {
  constructor(private readonly core: SessionCore) {}

  /** Whether the scheduler was last given a hold, so that clearing it is sent once */
  private planSent = false;
  private clampedSections: { source: Section[]; start: number; end: number; value: Section[] } | null = null;

  private lookahead(): number {
    return this.core.state.portId === BLUETOOTH_PORT_ID ? BLUETOOTH_LOOKAHEAD : SYSTEM_LOOKAHEAD;
  }

  /** The MIDI clock time at which the audio clock reads `ctx`. Both clocks are in step while playing. */
  clockOf(ctx: number): number {
    return midiNow() + (ctx - (this.core.state.player?.audioNow ?? 0)) * 1000;
  }

  /** The sections as they fall inside the part of the audio that plays: a trim cuts them. */
  get playableSections(): Section[] {
    const { player, sections } = this.core.state;
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
    const schedule = this.core.section?.schedule ?? this.renderSchedule();
    // Without sections there is never a plan to send or to clear, so the scheduler is not touched.
    if (!schedule && !this.planSent) return;
    this.planSent = schedule !== null;
    this.core.scheduler?.plan(schedule?.cap ?? null, schedule?.jump ?? null);
  }

  /** The MIDI plan of a render swap: cues are held after its song time, and the schedule takes the new rate at its audio time. */
  private renderSchedule(): { cap: number; jump: SchedulerJump | null } | null {
    const swap = this.core.renderSwap;
    if (!swap) return null;
    return { cap: swap.at, jump: { at: this.clockOf(swap.ctxAt), position: swap.at, rate: swap.rate, keepsPosition: true } };
  }

  /** Takes a boundary decided by the planner: the audio jump is scheduled now, the MIDI schedule is held up to it. */
  private commitBoundary(boundary: SectionBoundary): void {
    const { player, sectionLive } = this.core.state;
    const sections = this.playableSections;
    if (!player || this.core.renderSwap) return;
    const { action } = boundary;
    if (action.kind === "jump") {
      const ctxAt = player.prepareJump(action.to, boundary.at);
      if (ctxAt === null) return;
      this.core.section = {
        kind: "jump",
        ctxAt,
        before: sectionLive,
        sections,
        schedule: { cap: boundary.at, jump: { at: this.clockOf(ctxAt), position: action.to } },
      };
    } else {
      this.core.section = {
        kind: action.kind,
        ctxAt: player.audioTimeOf(boundary.at),
        before: sectionLive,
        sections,
        schedule: action.kind === "pause" ? { cap: boundary.at, jump: null } : null,
      };
    }
    this.sendPlan();
    this.core.set({
      sectionLive: boundary.live,
      sectionNext: action.kind === "continue" ? null : { kind: action.kind, target: action.kind === "jump" ? action.target : null, at: boundary.at },
    });
  }

  /**
   * Puts back the decision that has not taken effect yet, and the live state it was made from. Returns false when a jump is already
   * too close to take effect to undo, and the jump then stands.
   */
  private cancelSectionPlan(): boolean {
    const plan = this.core.section;
    if (!plan) return true;
    if (plan.kind === "jump" && !this.core.state.player?.cancelJump()) return false;
    this.core.section = null;
    this.sendPlan();
    this.core.set({ sectionLive: plan.before, sectionNext: null });
    return true;
  }

  /** Forgets a decision because playback stopped. Any jump was dropped by the player, and the live state goes back to what it was. */
  dropSectionPlan(): void {
    this.core.pendingRelease = null;
    const plan = this.core.section;
    if (!plan) return;
    this.core.section = null;
    this.core.set({ sectionLive: plan.before, sectionNext: null });
  }

  /**
   * Whether the exit bars are used at all: the song has some, and it plays at its own speed and pitch, which is what they were rendered at.
   * At another speed or pitch a vamp keeps the audio it has, which loops cleanly and leaves without its fill.
   */
  private exitsUsable(): boolean {
    return Object.keys(this.core.exitBars).length > 0 && isPlainSpeed(this.core.state.speed);
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
    if (this.core.pendingRelease !== null && !this.exitsUsable()) {
      const id = this.core.pendingRelease;
      this.core.pendingRelease = null;
      this.core.set({ sectionLive: releaseLoop(this.core.state.sectionLive, id) });
    }
    if (!this.exitsUsable() || !sections.length || player.position < 0) return;
    const ordered = sortedSections(sections);
    const section = ordered[sectionIndexAt(ordered, player.position)];
    if (this.core.pendingRelease !== null && section?.id !== this.core.pendingRelease) this.core.pendingRelease = null;
    const bar = section ? this.core.exitBars[section.id] : undefined;
    if (!section || !bar) return;
    if (this.core.pendingRelease === section.id && this.canExit(player, bar)) {
      this.core.pendingRelease = null;
      this.core.set({ sectionLive: releaseLoop(this.core.state.sectionLive, section.id) });
    }
    const boundary = nextBoundary(sections, player.position, this.core.state.sectionLive);
    // A pause at the end of the section leaves it the same way a continue does.
    const leaving = boundary !== null && (boundary.action.kind === "continue" || boundary.action.kind === "pause");
    if (player.exitAt !== null) {
      if (!leaving) player.cancelExit();
      return;
    }
    // A jump that is waiting means this.core pass does not leave into the next section.
    if (!leaving || this.core.pendingRelease === section.id || this.core.section?.kind === "jump") return;
    player.scheduleExit(bar);
  }

  /** Every 50 ms while playing: carries out a decision once its boundary has passed, and decides the next boundary when it is close. */
  tickSections = (): void => {
    const { player, playing } = this.core.state;
    const sections = this.playableSections;
    if (!player || !playing) return;
    try {
      this.tickRender(player);
      if (this.core.renderSwap) return;
      this.tickExit(player, sections);
      const plan = this.core.section;
      if (plan) {
        if (plan.sections !== sections) {
          this.cancelSectionPlan();
          return;
        }
        if (player.audioNow < plan.ctxAt) return;
        this.core.section = null;
        this.core.set({ sectionNext: null });
        if (plan.kind === "pause") this.core.pause();
        return;
      }
      if (!sections.length || player.position < 0) return;
      const boundary = nextBoundary(sections, player.position, this.core.state.sectionLive);
      if (boundary && boundary.at - player.position <= DECISION_LEAD_S) this.commitBoundary(boundary);
    } catch (e) {
      this.cancelSectionPlan();
      this.core.fail(e);
    }
  };

  /**
   * Carries a render through while the song plays: a built render is swapped in at the next beat, once no section jump is waiting,
   * and the swap is cleared when its audio time passes. Sections wait for a swap to land.
   */
  private tickRender(player: StemPlayer): void {
    const swap = this.core.renderSwap;
    if (swap) {
      if (player.audioNow >= swap.ctxAt) {
        this.core.renderSwap = null;
        this.sendPlan();
      }
      return;
    }
    if (!this.core.pendingRender || this.core.section) return;
    const started = player.swapRender(this.core.pendingRender, RENDER_SWAP_LEAD_S);
    if (!started) return;
    this.core.renderSwap = { at: started.at, ctxAt: started.when, rate: this.core.pendingRender.rate };
    this.core.pendingRender = null;
    this.sendPlan();
  }

  /** Applies a render that is waiting for a beat, now. Used when the song stops, because a stopped song has no beat to wait for. */
  applyPendingRender(): void {
    const render = this.core.pendingRender;
    const player = this.core.state.player;
    if (!render || !player) return;
    this.core.pendingRender = null;
    player.applyRender(render);
  }

  /**
   * Sets the song's speed and pitch. The render is built in the background; the newest request wins. A built render is swapped in at
   * the next beat while the song plays, and applied at once while it is stopped.
   */
  setSpeed = (requested: Partial<SpeedSettings>): void => {
    const speed = clampSpeed({ ...this.core.state.speed, ...requested });
    if (JSON.stringify(speed) === JSON.stringify(this.core.state.speed)) return;
    if (speed.rate !== this.core.state.speed.rate && this.core.state.playing && this.core.armed && hasPedalRhythm(this.core.state.cues)) {
      this.core.fail("Pause and restart from the beginning to change speed with RC-10R drums.");
      return;
    }
    if (this.core.playPending && this.core.state.preparing) this.core.pause();
    this.core.set({ speed });
    try {
      const key = this.core.songSettingsKey;
      const options = parseOptions(getSetting(key, ":options"));
      setSetting(key, ":options", JSON.stringify({ ...options, ...speedOptions(speed) }));
    } catch (e) {
      this.core.fail(e);
    }
    this.core.speedPreparation = this.renderSpeed(speed);
  };

  /** Builds the render for `speed` from the stems at 100%, and hands it to the player. Stale results are dropped. */
  async renderSpeed(speed: SpeedSettings): Promise<void> {
    const base = this.core.baseStems;
    const player = this.core.state.player;
    if (!base || !player) return;
    const request = ++this.core.renderRequest;
    this.core.set({ rendering: null });
    try {
      const stems = await this.core.renders.render(base, speed, (done, total) => {
        if (request === this.core.renderRequest) this.core.set({ rendering: { done, total } });
      });
      if (!stems || request !== this.core.renderRequest || this.core.state.player !== player) return;
      const render = await player.renderBuffers(stems, speed.rate);
      if (request !== this.core.renderRequest || this.core.state.player !== player) return;
      this.core.pendingRender = render;
      if (!player.isPlaying) this.applyPendingRender();
      this.core.set({ rendering: null });
    } catch (e) {
      if (request === this.core.renderRequest) {
        this.core.set({ rendering: null });
        this.core.fail(e);
      }
    }
  }

  /** A tap arms a jump to the section for the next boundary. While stopped it moves the playhead to the section's start instead. */
  tapSection = (id: string) => {
    const section = this.playableSections.find((s) => s.id === id);
    if (!section) return;
    if (this.core.state.playing && this.core.armed && hasPedalRhythm(this.core.state.cues)) {
      this.core.fail(RHYTHM_RESTART);
      return;
    }
    if (!this.core.state.playing) {
      void this.core.state.player?.seek(section.start);
      setClockPosition(section.start);
      return;
    }
    this.cancelSectionPlan();
    this.core.set({ sectionLive: armJump(this.core.state.sectionLive, id) });
  };

  /** A second tap on the armed section: jumps now, after the MIDI lookahead, so queued cues still belong to the passage being left. */
  jumpSectionNow = (id: string) => {
    if (this.core.armed && hasPedalRhythm(this.core.state.cues)) {
      this.core.fail(RHYTHM_RESTART);
      return;
    }
    const { player, playing } = this.core.state;
    if (!player || !playing) {
      this.tapSection(id);
      return;
    }
    this.cancelSectionPlan();
    const boundary = immediateJump(this.playableSections, player.position + this.lookahead(), this.core.state.sectionLive, id);
    if (boundary) this.commitBoundary(boundary);
  };

  /** Loops a section until it is released; tapping the looping section releases it. */
  toggleSectionLoop = (id: string) => {
    if (this.core.armed && hasPedalRhythm(this.core.state.cues)) {
      this.core.fail(RHYTHM_RESTART);
      return;
    }
    // Tapping the looping section releases it, the same way the release action does.
    const looping = sortedSections(this.playableSections).find((section) => section.id === id);
    if (this.core.state.sectionLive.loop === id && looping) {
      this.releaseLoopOf(looping);
      return;
    }
    this.cancelSectionPlan();
    this.core.pendingRelease = null;
    const live = this.core.state.sectionLive;
    this.core.set({ sectionLive: live.loop === id ? releaseLoop(live, id) : startLoop(live, id) });
  };

  /** Releases the loop of the section being played, whether it was started live or is the section's own mode. */
  releaseSectionLoop = () => {
    const { player } = this.core.state;
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
    const { player } = this.core.state;
    const bar = this.exitsUsable() ? this.core.exitBars[section.id] : undefined;
    const later = bar !== undefined && this.exitReachable(section, bar);
    if (bar && later && player && !this.canExit(player, bar)) {
      this.core.pendingRelease = section.id;
      return;
    }
    if (!this.cancelSectionPlan() && bar && later) {
      this.core.pendingRelease = section.id;
      return;
    }
    this.core.pendingRelease = null;
    this.core.set({ sectionLive: releaseLoop(this.core.state.sectionLive, section.id) });
  }

  /** Cancels the armed jump. A decision already made for it is put back too, where that is still possible. */
  cancelSectionJump = () => {
    this.cancelSectionPlan();
    this.core.set({ sectionLive: cancelJump(this.core.state.sectionLive) });
  };

  /** The playable sections in song order, and the index of the one the playhead is in (-1 when none). */
  sectionOrder(): { ids: string[]; current: number } {
    const ordered = sortedSections(this.playableSections);
    const player = this.core.state.player;
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
}
