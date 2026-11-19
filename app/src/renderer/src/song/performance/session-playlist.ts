import { parseSections } from "./sections";
import { songCues } from "./song-cues";
import { midiFileFromOptions } from "./smf";
import { rhythmControlOverrides } from "./rhythm-automation";
import { pedalTempoMessages } from "./pedal-tempo";
import { preparationSequence } from "./preparation-sequence";
import { type Lead, StemPlayer } from "@/song/stems/player";
import { type HandedOverSong, type PreparedSong, useSongLibrary } from "@/song/library";
import { showToast } from "@/app/notify";
import type { SongSource } from "@/song/types";
import { expandSectionCues } from "@/song/performance/chart";
import { beatSeconds, countInBeats, preRollStart } from "@/song/performance/rhythm";
import { HANDOVER_LEAD_S, planTransition, type Transition } from "@/song/performance/transition";
import { readCrossfade } from "@/song/performance/crossfade";
import { ownLeadIn, readLeadInDefaults, resolveLeadIn, songCountIn, type SongCountIn } from "@/song/performance/lead-in";
import type { EndBehaviour } from "@/song/performance/song-shape";
import { usePedalLibrary } from "@/song/performance/pedal-library";
import { hasPedalRhythm, hasSavedPedalRhythm } from "./rhythm-runtime";
import { preparationHistoryFor } from "./preparation-repeat";
import { savedPreparation } from "./start-preparation";
import type { TimecodeTail } from "@/song/performance/midi-scheduler";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { countsAsPlayed } from "@shared/library-history";
import { chaseTriggers, type SessionCore } from "./session-core";

/** The next song is chained this far before its join, so that a pause in between has time to undo it */
const CHAIN_AHEAD_S = 5;

/** Playlist: chaining the next song onto this one's clock, the hand-over, and counting a song as played. */
export class SessionPlaylist {
  constructor(private readonly core: SessionCore) {}

  private handoverTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The song the previous session handed over, when it is `source`: the library holds it until a session takes it up. Any other
   * held song is released there. The previous session's hook-up is undone here, and this.core session wires the song up again.
   */
  claimHandover(source: SongSource | null): HandedOverSong | null {
    const handover = useSongLibrary.getState().claimHandover(source?.libraryId);
    handover?.unwire();
    return handover;
  }

  /** Whether a song this.core session handed over is still waiting in the library for the next session to take it up. */
  get passing(): boolean {
    return this.core.handingOver !== null && useSongLibrary.getState().handover?.id === this.core.handingOver;
  }

  /** Sets the next song's start: its cues from its own start, and its tempo message at the start of its count-in. */
  startHandover(chained: HandedOverSong): void {
    const armed = this.core.armed;
    try {
      this.core.startTempo = this.core.tempoMessages(armed, this.core.output, chained.player.playbackRate);
    } catch (e) {
      this.core.fail(e);
      this.core.startTempo = null;
    }
    this.core.startPosition = armed ? chained.player.start : null;
    this.core.startPlay = this.core.triggerBytes("play");
    this.core.countInMs = chained.countInMs;
    this.core.joining = true;
    this.core.incomingTail = chained.timecodeTail ? { ...chained.timecodeTail, end: chained.join } : null;
  }

  /** The outgoing scheduler's quarter-frame stream, which runs to the join. Null when the outgoing song sends no timecode. */
  private outgoingTimecode(join: number): TimecodeTail | null {
    const stream = this.core.scheduler?.timecodeStream();
    return stream ? { ...stream, end: join } : null;
  }

  /** Only an incoming sequence with actual commands needs a stopped handover. Previewing never consumes repeat history. */
  private nextNeedsPreparation(next: PreparedSong): boolean {
    if (!this.core.armed) return false;
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
        pedalChannel: this.core.state.tempoChannel,
        tempo: this.core.state.tempoOnStart ? pedalTempoMessages(timing.bpm * next.player.playbackRate, this.core.state.tempoChannel) : null,
      });
      return plan.steps.some((step) => step.kind === "send" && step.commands.length > 0);
    } catch {
      return true;
    }
  }

  /** Crossfades into the next playlist song now. Returns false when no next song is ready, or a join is already planned. */
  crossfadeNext = (): boolean => {
    const { player, queued, playlistPlaying } = this.core.state;
    const next = useSongLibrary.getState().preparedNext();
    if (!player?.isPlaying || this.core.chained || !queued || !playlistPlaying || !next) return false;
    if (hasPedalRhythm(this.core.state.cues) || hasSavedPedalRhythm(next.settings) || this.nextNeedsPreparation(next)) {
      showToast({
        tone: "info",
        title: "Pedal preparation runs between songs",
        body: "The next song has setup commands. Let this.core song finish before preparing it.",
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

  /** Chains the next playlist song onto this.core one once its join is close, so the two play on one clock. Checked until it is chained. */
  planNext(): void {
    const { player, queued, playlistPlaying } = this.core.state;
    // A song set to stop, or to loop, does not hand over to the next one.
    if (!player?.isPlaying || this.behaviourOf(player) !== "next" || this.core.chained || !queued || !playlistPlaying) return;
    // A single rhythm pedal cannot crossfade memories or change tempo while the outgoing ending is still playing.
    if (hasPedalRhythm(this.core.state.cues)) return;
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
  checkPlayed = (): void => {
    const { player } = this.core.state;
    const id = this.core.loadedSongId;
    if (!player || !id || this.core.playedRecorded || !player.isPlaying || !countsAsPlayed(player.position, player.duration)) return;
    this.core.playedRecorded = true;
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

  /** Starts `next` on this.core song's clock at the join, and arranges the hand-over HANDOVER_LEAD_S before it. `timing` is the next song's. */
  private startChain(next: PreparedSong, plan: Exclude<Transition, { kind: "gap" }>, timing: SongCountIn): void {
    const { player } = this.core.state;
    if (!player) return;
    // The next song's buffers were built when it was prepared, so the join only starts them.
    if (hasPedalRhythm(this.core.state.cues) || hasSavedPedalRhythm(next.settings) || this.nextNeedsPreparation(next)) return;
    const incoming = next.player;
    const unwire = this.core.wirePlayer(incoming, next.source);
    const countInBeatsNow = plan.kind === "countIn" ? countInBeats(timing.countInBars, timing.beatsPerBar) : 0;
    const lead: Lead = { bpm: timing.bpm, countInBeats: countInBeatsNow, preRollBeats: 0 };
    if (!player.chainNext(incoming, { startAt: plan.startAt, fadeLength: plan.fadeLength, stopAt: plan.stopAt, lead })) {
      unwire();
      return;
    }
    const countInMs = timing.bpm > 0 ? (countInBeatsNow * beatSeconds(timing.bpm) * 1000) / incoming.playbackRate : 0;
    const join = this.core.clockOf(plan.startAt);
    this.core.chained = { id: next.id, player: incoming, countInMs, unwire, join };
    // The library holds the chained song, so a queue edit that changes the next song undoes this.core chain first.
    useSongLibrary.getState().holdChain({ id: next.id, release: () => this.dropChained() });
    // The outgoing song's quarter frames end where the next song joins, and its full frame starts there. The chain is decided several
    // seconds ahead, so no quarter frame past the join is queued yet. Dropping the chain restores them.
    this.core.scheduler?.endTimecode(join);
    this.clearHandoverTimer();
    this.handoverTimer = setTimeout(this.handOver, Math.max(0, (plan.startAt - HANDOVER_LEAD_S - player.audioNow) * 1000));
  }

  /**
   * Hands the chained song over: the library holds it and moves on, and the view is re-created for the new song. The next session
   * takes the song up in `loadSong`. The song is already playing, so this.core only moves the playlist and the outgoing song's events on.
   */
  handOver = (): void => {
    const chained = this.core.chained;
    const outgoing = this.core.state.player;
    if (!chained || !outgoing) return;
    this.clearHandoverTimer();
    const library = useSongLibrary.getState();
    if (library.preparedNext()?.id !== chained.id) {
      this.dropChained();
      return;
    }
    outgoing.detachNext();
    this.core.chained = null;
    useSongLibrary.getState().holdChain(null);
    this.core.handingOver = chained.id;
    // The outgoing song ends at the join: its end and stop go out before the next song's load and play. The batch holds them until the
    // effects have run, so no clear that follows can drop them.
    this.core.batch(() => {
      this.core.sendTriggers("end");
      this.core.sendTriggers("stop");
    });
    // The outgoing scheduler is torn down with this.core view, so its quarter frames are carried to the join by the incoming scheduler.
    library.setHandover({ ...chained, timecodeTail: this.outgoingTimecode(chained.join) });
    // End this.core owner before the library starts allocating the following song. The player preserves any outgoing audio tail.
    this.core.unloadCurrentSong?.();
    library.advanceToPrepared(chained.id);
  };

  /** Undoes the chained song, if it has not been taken over: the outgoing song then runs to its own end. */
  dropChained(): void {
    this.clearHandoverTimer();
    const chained = this.core.chained;
    if (!chained) return;
    this.core.chained = null;
    useSongLibrary.getState().holdChain(null);
    this.core.scheduler?.endTimecode(null);
    // The prepared song stays with the library: it is stopped here, and it can be chained again.
    this.core.state.player?.cancelChain();
    chained.unwire();
  }

  private clearHandoverTimer(): void {
    if (this.handoverTimer) clearTimeout(this.handoverTimer);
    this.handoverTimer = null;
  }
}
