import { clampRate } from "./speed";
import { useSongLibrary } from "@/song/library";
import { showToast } from "@/app/notify";
import { practiceSet, toggleNotice, usePracticeMute } from "./practice-mute";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { type ActionHost, actionLabel, ACTIONS, type Hint, isActionId, runAction, type ViewHost } from "./actions";
import { FollowerGate } from "./band-control";
import { type FollowerAction, isFollowerAction } from "@shared/band-sync";
import {
  type ActionLearnTarget,
  type BankTracker,
  type Binding,
  describeBinding,
  dialogOpen,
  findConflict,
  isModifierKey,
  isTypingTarget,
  type LearnStep,
  type MidiEvent,
  normaliseKey,
  type Route,
  type SongHit,
  stopLearn,
  useRemoteLearn,
} from "./bindings";
import { bindingClaiming, describeTrigger, songEntries, type SongEntry, songForEvent, songLearnStep, songsInScope, triggerClashes } from "./song-triggers";
import type { SessionCore, SessionHost } from "./session-core";

/** The action groups a key may run while the performance screen is hidden by another Song tab. */
const HIDDEN_KEY_GROUPS = new Set<string>(["Transport", "Songs", "Practice"]);

/** Whether a binding's action is a transport or song action, which still runs while the screen is hidden. */
const runsWhileHidden = (action: string): boolean => isActionId(action) && HIDDEN_KEY_GROUPS.has(ACTIONS[action].group);

/** How far a speed key moves the rate: 5% */
const SPEED_STEP = 0.05;

/** Shown when Learn is given a key with a modifier, which a binding cannot match */
const MODIFIER_HINT = "Use a key without Ctrl, Alt or Cmd.";

/** Remote control: keys and MIDI messages run actions, Learn, and song selection by MIDI. */
export class SessionRemote {
  constructor(private readonly core: SessionCore) {}

  private readonly followerGate = new FollowerGate();
  /** What the session does for the remote actions. Each returns a hint when the action does not apply now. */
  private readonly sessionActions: SessionHost = {
    prepare: () => {
      if (!this.core.state.player) return "No song is loaded.";
      if (this.core.state.starting || this.core.state.playing) return "Stop playback before preparing pedals.";
      void this.core.preparePedals();
    },
    play: () => {
      if (!this.core.state.player) return "No song is loaded.";
      this.core.startPlayback();
    },
    playPause: () => {
      if (!this.core.state.player) return "No song is loaded.";
      if (this.core.state.playing) this.core.pause();
      else this.core.startPlayback();
    },
    stop: () => {
      if (!this.core.state.player) return "No song is loaded.";
      this.core.pause();
    },
    playFromStart: () => {
      if (!this.core.state.player) return "No song is loaded.";
      // Seeking is refused in stage mode, so the song would carry on from where it is.
      if (this.core.locked) return "Seeking is locked in stage mode.";
      void this.core.seek(0).then(() => this.core.startPlayback());
    },
    panic: () => this.core.panicAndDisarm(),
    nextSong: () => this.skipSong(1),
    previousSong: () => this.skipSong(-1),
    selectSong: (n) => this.selectSong(n),
    crossfade: () => {
      if (!this.core.crossfadeNext()) return "Crossfade needs a playing playlist with the next song ready.";
    },
    nextSection: () => this.core.stepSection(1),
    previousSection: () => this.core.stepSection(-1),
    armSection: (n) => this.core.sectionAt(n, (id) => this.core.tapSection(id)),
    jumpSection: (n) => this.core.sectionAt(n, (id) => this.core.jumpSectionNow(id)),
    toggleSectionLoop: () => {
      const { ids, current } = this.core.sectionOrder();
      if (current < 0) return "No section is playing.";
      this.core.toggleSectionLoop(ids[current]);
    },
    exitSectionLoop: () => {
      if (this.core.sectionOrder().current < 0) return "No section is playing.";
      this.core.releaseSectionLoop();
    },
    cancelSectionJump: () => {
      if (!this.core.state.sectionLive.jump) return "No jump is armed.";
      this.core.cancelSectionJump();
    },
    bandVariant: (variant) => this.core.changeBandVariant(variant),
    resetRig: (start) => this.core.resetRig(start),
    solo: (mode) => this.core.solo(mode),
    arm: () => {
      const output = this.core.output;
      if (!output || output.state !== "connected") return "Choose a connected MIDI output first.";
      this.core.sendCues(true);
    },
    disarm: () => this.core.disarm(),
    speed: (change) => {
      const rate = this.core.state.speed.rate;
      if (change === "reset") {
        if (rate !== 1) this.core.setSpeed({ rate: 1 });
        return;
      }
      const next = clampRate(Math.round((rate + (change === "up" ? SPEED_STEP : -SPEED_STEP)) * 100) / 100);
      if (next === rate) return change === "up" ? "Speed is at its maximum." : "Speed is at its minimum.";
      this.core.setSpeed({ rate: next });
    },
    // The practice mute is global, so it works with no song loaded. The player ramps the gain when the screen applies it.
    practiceToggle: (kind) => {
      const on = usePracticeMute.getState().toggle(kind);
      showToast({ tone: "info", title: toggleNotice(kind, on, practiceSet(usePracticeMute.getState().kinds)) });
    },
    practiceClear: () => {
      if (!usePracticeMute.getState().kinds.length) return "No practice mute is on.";
      usePracticeMute.getState().clear();
      showToast({ tone: "info", title: "Practice mute off" });
    },
  };

  /** Supplies the performance screen's view actions (stage, click, mixer, tap, lyrics). Called again whenever they change. */
  setView(view: ViewHost): void {
    this.core.view = view;
  }

  /** Every key press from the window. Returns true when Learn or a binding took it; a key in a text field is never taken. */
  keyDown = (e: KeyboardEvent): boolean => {
    if (e.defaultPrevented || isTypingTarget(e.target) || dialogOpen()) return false;
    const learn = useRemoteLearn.getState().target;
    if (learn?.source === "key") {
      if (!e.repeat) this.learnKey(e, learn);
      e.preventDefault();
      return true;
    }
    // While a MIDI message is being learned, a key does nothing: learning must not run what it is about to bind.
    if (learn) return false;
    // Key repeat and modified keys are not bindings: holding PageDown must not run the section jump again and again.
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
    const routes = this.core.remote.key(e.key, this.core.state.bindings).filter((route) => this.core.shown || runsWhileHidden(route.binding.action));
    if (!routes.length) return false;
    e.preventDefault();
    this.runRoutes(routes);
    return true;
  };

  /** One message from the selected input: learned while Learn is open, otherwise it runs the bindings or selects a song. */
  receiveMidi = (data: Uint8Array): void => {
    this.core.observeRig([...data], true);
    const learn = useRemoteLearn.getState().target;
    if (learn?.source === "song") this.learnSong(data, learn.songId);
    else if (learn?.source === "midi") this.learnFromMidi(data, learn);
    // While a key is being learned, a pedal message does nothing, for the same reason as a key during MIDI Learn.
    else if (!learn) this.runInput(data);
  };

  /** One message that no Learn is taking: a binding that claims it runs; otherwise a song trigger may select a song. Never throws. */
  private runInput(data: Uint8Array): void {
    try {
      const { routes, song } = this.core.remote.receive(data, this.core.state.bindings, (event, bank) => this.songSelectedBy(event, bank));
      this.runRoutes(routes);
      if (song) this.loadSongFromMidi(song);
    } catch (e) {
      this.core.fail(e);
    }
  }

  /** The song a message selects, when song triggers are switched on. Only a program change or Song Select can select one. */
  private songSelectedBy(event: MidiEvent, bank: BankTracker): SongHit<SongEntry> | null {
    const { listen, scope } = useMidiConfiguration.getState().songTriggers;
    if (!listen || (event.status !== 0xc0 && event.status !== 0xf3)) return null;
    const library = useSongLibrary.getState();
    const song = songForEvent(songsInScope(songEntries(library.index.songs), library.queue, scope), event, bank);
    return song ? { key: song.id, value: song } : null;
  }

  /**
   * Loads the song a trigger selected. A song that is already loaded is left alone. While a song plays, the trigger follows its
   * while-playing option: ignored (the default), armed as next in the set, or used to stop and load the song now. A song in the set
   * moves the set to it. A song outside the set loads on its own and pauses the set, with a notice. Autoplay starts the loaded song.
   */
  private loadSongFromMidi(song: SongEntry): void {
    if (song.id === this.core.loadedSongId) return;
    const library = useSongLibrary.getState();
    const { whilePlaying, autoplay } = useMidiConfiguration.getState().songTriggers;
    if (library.busy) {
      showToast({ tone: "info", title: `${song.title} was not loaded`, body: "A song is still loading." });
      return;
    }
    const playing = this.core.state.playing || this.core.playPending;
    if (playing && whilePlaying === "ignore") {
      showToast({ tone: "info", title: `${song.title} was not loaded`, body: "Stop the song to load it, or change the song trigger option while playing." });
      return;
    }
    if (playing && whilePlaying === "next") {
      this.armNextFromMidi(song);
      return;
    }
    // Read before a stop pauses the set, so the notice can say the set was left.
    const wasInSet = library.playlistPlaying;
    if (playing) this.core.pause();
    if (autoplay) library.requestAutoplay(song.id);
    const at = library.queue.indexOf(song.id);
    const loading = at >= 0 ? library.skipPlaylist(at - library.position) : library.load(song.id);
    void Promise.resolve(loading)
      .then(() => {
        if (wasInSet && at < 0) useSongLibrary.setState({ notice: `${song.title} loaded by MIDI. The playlist is paused.` });
      })
      .catch((e) => this.core.fail(e));
  }

  /** Arms a song as next in the playing set. A chained song is undone first, so the one armed here is the one that plays at the join. */
  private armNextFromMidi(song: SongEntry): void {
    if (!this.core.state.queued) {
      showToast({ tone: "info", title: `${song.title} was not loaded`, body: "Arm as next needs a playlist. Stop the song to load it." });
      return;
    }
    this.core.dropChained();
    const hint = useSongLibrary.getState().armNext(song.id);
    showToast(hint ? { tone: "info", title: hint } : { tone: "info", title: `${song.title} plays next` });
  }

  /** One message while a song's trigger is being learned: a program change (with its bank) or Song Select is saved for that song. */
  private learnSong(data: Uint8Array, songId: string): void {
    const event = this.core.remote.readInput(data);
    if (!event) return;
    const step = songLearnStep(event, this.core.remote.bank);
    useRemoteLearn.setState({ seen: step.seen });
    if (step.kind !== "match") return;
    try {
      useSongLibrary.getState().setSongTrigger(songId, step.trigger);
      const songs = songEntries(useSongLibrary.getState().index.songs);
      const title = songs.find((song) => song.id === songId)?.title ?? "The song";
      const notes = [`${title} loads on ${describeTrigger(step.trigger)}.`];
      const clashes = triggerClashes(songs, songId);
      if (clashes.length) notes.push(`Same trigger as ${clashes.map((song) => song.title).join(", ")}; the first in the library loads.`);
      const bound = bindingClaiming(step.trigger, this.core.state.bindings);
      if (bound) notes.push(`${describeBinding(bound)} already runs an action, so the song will not load.`);
      stopLearn(notes.join(" "));
    } catch (e) {
      stopLearn(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * A transport action a band follower asked for (spec 44). Anything that is not one of the follower actions is ignored. A stop needs a
   * second press, as a double-press binding does, so the performer sees "press again" before the song stops.
   */
  runFollowerAction(action: string): void {
    if (!isFollowerAction(action)) return;
    const step = this.followerGate.take(action as FollowerAction);
    if (step.kind === "armed") {
      showToast({ tone: "info", title: "A bandmate asked to stop", body: "Press stop again within 0.6 s to stop the song." });
      return;
    }
    showToast({ tone: "info", title: `A bandmate asked: ${actionLabel(step.action)}` });
    const hint = runAction({ action: step.action }, this.actionHost());
    if (hint) showToast({ tone: "info", title: hint });
  }

  /** Runs what the bindings matched. A first press of a double press says so, so the performer knows it is waiting for the second. */
  private runRoutes(routes: Route[]): void {
    for (const route of routes) {
      const label = actionLabel(route.binding.action, route.binding.index);
      if (route.kind === "armed") {
        showToast({ tone: "info", title: `Press again to ${label}`, body: "The second press must come within 0.6 s." });
        continue;
      }
      const hint = runAction(route.binding, this.actionHost());
      if (hint) showToast({ tone: "info", title: hint });
    }
  }

  private actionHost(): ActionHost {
    return { ...this.sessionActions, ...this.core.view };
  }

  private learnFromMidi(data: Uint8Array, target: ActionLearnTarget): void {
    const step: LearnStep | null = this.core.remote.learnMidi(data);
    if (!step) return;
    useRemoteLearn.setState({ seen: step.seen });
    if (step.kind === "match") this.capture({ ...this.learnedBase(target), source: "midi", match: step.match });
  }

  private learnKey(e: KeyboardEvent, target: ActionLearnTarget): void {
    if (e.key === "Escape") {
      stopLearn("Learn cancelled.");
      return;
    }
    if (isModifierKey(e.key)) {
      useRemoteLearn.setState({ seen: "Press a key, not a modifier." });
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      useRemoteLearn.setState({ seen: MODIFIER_HINT });
      return;
    }
    const key = normaliseKey(e.key);
    useRemoteLearn.setState({ seen: `Key ${key}` });
    this.capture({ ...this.learnedBase(target), source: "key", match: { key } });
  }

  private learnedBase(target: ActionLearnTarget): { action: ActionLearnTarget["action"]; index?: number } {
    return target.index === undefined ? { action: target.action } : { action: target.action, index: target.index };
  }

  /** Binds what Learn captured, unless a binding already responds to the same input: the clash is named instead. */
  private capture(binding: Binding): void {
    const clash = findConflict(this.core.state.bindings, binding);
    if (clash >= 0) {
      stopLearn(`Already bound to ${describeBinding(this.core.state.bindings[clash])}. Remove that binding first.`);
      return;
    }
    const bindings = [...this.core.state.bindings, binding];
    this.core.set({ bindings });
    useMidiConfiguration.getState().update({ bindings });
    stopLearn(`Bound ${describeBinding(binding)}.`);
  }

  /** Moves the playlist by `offset` songs. Outside a playlist, or past its ends, there is a hint instead. */
  private skipSong(offset: number): Hint {
    if (!this.core.state.queued) return "Songs change only in a playlist.";
    if (offset === 0) return;
    const library = useSongLibrary.getState(),
      target = library.position + offset;
    if (target < 0) return "This is the first song in the playlist.";
    if (target >= library.queue.length) return "This is the last song in the playlist.";
    this.core.skip(offset);
  }

  private selectSong(n: number): Hint {
    if (!this.core.state.queued) return "Songs change only in a playlist.";
    const library = useSongLibrary.getState();
    if (n > library.queue.length) return `The playlist has ${library.queue.length} songs.`;
    return this.skipSong(n - 1 - library.position);
  }
}
