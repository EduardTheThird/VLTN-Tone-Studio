import { STEM_NAMES, type StemName, type Stems } from "../types";
import { beatSeconds, clicksWhilePlaying, clicksWhileStopped, preRollStart, type MetronomeMode } from "../performance/rhythm";
import { audioTimeOf, gridClicks, gridStart, songTimeAt, type GridCursor, type Segment } from "../performance/timeline";
import { stemGains, type Mix } from "./mix";
import { OutputRouter, type BusName, type OutputConfig } from "../audio/outputs";

/** Which bus each track plays on, keyed by track name. A track without an entry plays on Main. */
export type TrackBuses = Partial<Record<string, BusName>>;

// Plays a split's stems (four or six) in sync through WebAudio: one buffer source per stem → its gain (mixer) → an analyser
// (level meter) → the main output bus. Pausing or seeking restarts the sources at the new position.
//
// The metronome is one grid of clicks. While the song plays it follows the song's timeline (see timeline.ts), so a count-in
// (clicks before the audio) and a pre-roll (audio that starts before the requested position) keep the same bar phase, and a jump
// keeps it too. While stopped, a rehearsal grid starts from the moment it is switched on and never touches the song. Clicks go to
// the click bus, which can be sent to its own output.
//
// A jump is scheduled ahead on the audio clock: the stems stop at its boundary and restart at the target, sample-accurately, so
// nothing has to be late. The jump can be cancelled until shortly before the boundary.

const RAMP_S = 0.015;
/** A jump that would start in the past starts this far from now. */
const JUMP_MIN_S = 0.05;
/** A jump can be cancelled until this long before it takes effect. The metronome reads this far ahead, so a cancel must come first. */
const JUMP_CANCEL_S = 0.15;
/** How long a cancelled stem keeps playing: a stop far enough away that it never comes. */
const RESTORE_S = 86400;

interface Voice {
  buffer: AudioBuffer;
  gain: GainNode;
  analyser: AnalyserNode;
  source: AudioBufferSourceNode | null;
}

/** A jump waiting on the audio clock: the sources it replaces, and the song end the segment before it had. */
interface PreparedJump {
  when: number;
  previous: AudioBufferSourceNode[];
  end: number;
  timer: ReturnType<typeof setTimeout>;
}

export interface MetronomeSettings { mode: MetronomeMode; bpm: number; beats: number; volume: number; firstBeat?: number }

/** Lead-in for one start. Both are in beats of `bpm`; a missing or zero value means none. */
export interface Lead {
  /** Defaults to the metronome's tempo */
  bpm?: number;
  /** Clicks before the audio starts; the first is on the downbeat */
  countInBeats?: number;
  /** Audio starts this many beats before the requested position */
  preRollBeats?: number;
}

/** Stops and forgets every click in `clicks`. */
function silence(clicks: Set<OscillatorNode>): void {
  for (const osc of clicks) {
    osc.stop();
    osc.disconnect();
  }
  clicks.clear();
}

export class StemPlayer {
  readonly duration: number;
  private ctx = new AudioContext({ sampleRate: 44100 });
  /** The split's stems, STEM_NAMES order */
  readonly names: StemName[];
  private voices: Partial<Record<StemName, Voice>>;
  /** The song's timeline on the audio clock. A jump appends a segment. Empty until something has been started. */
  private segments: Segment[] = [];
  private prepared: PreparedJump | null = null;
  private offset = 0;
  /** The position the last start asked for. A pause during the count-in returns here, not to the pre-roll start. */
  private resumeAt = 0;
  private playing = false;
  private metronome: MetronomeSettings = { mode: "off", bpm: 120, beats: 4, volume: 0.25 };
  private clickTimer: ReturnType<typeof setInterval> | null = null;
  private clicks = new Set<OscillatorNode>();
  /** Count-in clicks have their own set: a metronome change restarts the grid and must not cut the count-in short. */
  private countInClicks = new Set<OscillatorNode>();
  private meterBuffer = new Float32Array(2048);
  private router: OutputRouter;
  /** Called when playback reaches the end on its own */
  onEnded: (() => void) | null = null;
  /** Called when an output cannot be used and audio falls back to the default output */
  onOutputWarning: ((message: string) => void) | null = null;

  constructor(stems: Stems) {
    this.names = STEM_NAMES.filter((name) => stems[name]);
    if (!this.names.length) throw new Error("There are no stems to play.");
    const first = stems[this.names[0]]!;
    this.duration = first.channels[0].length / first.sampleRate;
    this.router = new OutputRouter(this.ctx, (message) => this.onOutputWarning?.(message));
    this.voices = Object.fromEntries(
      this.names.map((name) => {
        const pcm = stems[name]!;
        const buffer = this.ctx.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.sampleRate);
        pcm.channels.forEach((ch, c) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
        const gain = this.ctx.createGain();
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = this.meterBuffer.length;
        gain.connect(analyser).connect(this.router.buses.main);
        return [name, { buffer, gain, analyser, source: null }];
      }),
    );
  }

  private voice(name: StemName): Voice {
    return this.voices[name]!;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Playback position in seconds. Negative during a count-in. */
  get position(): number {
    if (!this.playing) return this.offset;
    return Math.min(this.duration, songTimeAt(this.segments, this.ctx.currentTime));
  }

  /** The audio clock now, so the session can map audio times onto the MIDI clock. */
  get audioNow(): number {
    return this.ctx.currentTime;
  }

  /** The audio time at which song time `at` plays on the current timeline. Only meaningful while playing. */
  audioTimeOf(at: number): number {
    return audioTimeOf(this.segments, at);
  }

  async play(lead: Lead = {}): Promise<void> {
    if (this.playing) return;
    // Rehearsal clicks stop at once; the song's own grid takes over below.
    this.stopMetronome();
    await this.router.resume();
    if (this.offset >= this.duration) this.offset = 0;
    const bpm = lead.bpm ?? this.metronome.bpm;
    const interval = Number.isFinite(bpm) && bpm > 0 ? beatSeconds(bpm) : 0;
    const countIn = (lead.countInBeats ?? 0) * interval;
    this.resumeAt = this.offset;
    if (lead.preRollBeats && interval) this.offset = preRollStart(this.offset, lead.preRollBeats, bpm);
    const from = this.offset;
    const when = this.ctx.currentTime + 0.02;
    const start = when + countIn;
    for (const name of this.names) {
      const v = this.voice(name);
      const source = this.ctx.createBufferSource();
      source.buffer = v.buffer;
      source.connect(v.gain);
      source.start(start, from);
      v.source = source;
    }
    this.watchEnd();
    this.segments = [{ ctxStart: start, songStart: from, songEnd: Infinity }];
    this.playing = true;
    if (lead.countInBeats) this.scheduleCountIn(when, lead.countInBeats, interval);
    this.startPlayingGrid();
  }

  pause(): void {
    if (!this.playing) return;
    const at = this.position;
    this.offset = at < 0 ? this.resumeAt : Math.max(0, at);
    this.playing = false;
    this.stopSources();
    this.startRehearsal();
  }

  async seek(seconds: number): Promise<void> {
    const t = Math.max(0, Math.min(this.duration, seconds));
    if (!this.playing) {
      this.offset = t;
      return;
    }
    this.pause();
    this.offset = t;
    await this.play();
  }

  /**
   * Schedules a jump: at song time `at` the stems stop and restart at song time `to`, sample-accurately on the audio clock.
   * A jump that would start in the past starts JUMP_MIN_S from now. Returns the audio time it takes effect, or null when nothing
   * plays or another jump is still waiting.
   */
  prepareJump(to: number, at: number): number | null {
    if (!this.playing || this.prepared) return null;
    const last = this.segments[this.segments.length - 1];
    const when = Math.max(this.ctx.currentTime + JUMP_MIN_S, audioTimeOf(this.segments, at));
    const previous: AudioBufferSourceNode[] = [];
    for (const name of this.names) {
      const v = this.voice(name);
      const source = this.ctx.createBufferSource();
      source.buffer = v.buffer;
      source.connect(v.gain);
      source.start(when, to);
      previous.push(v.source!);
      v.source = source;
    }
    for (const old of previous) old.stop(when);
    this.watchEnd();
    const end = last.songEnd;
    last.songEnd = at;
    this.segments.push({ ctxStart: when, songStart: to, songEnd: Infinity });
    // The jump has taken effect once the clock passes `when`; after that it cannot be cancelled and the record is no longer needed.
    const timer = setTimeout(() => {
      if (this.prepared?.when === when) this.prepared = null;
    }, (when - this.ctx.currentTime) * 1000 + 50);
    this.prepared = { when, previous, end, timer };
    return when;
  }

  /**
   * Undoes a jump that is still waiting: the stems keep playing the passage they were on. Returns false when there is no jump,
   * or when it is too close to take effect to undo cleanly. Then the jump stands.
   */
  cancelJump(): boolean {
    const jump = this.prepared;
    if (!jump || this.ctx.currentTime > jump.when - JUMP_CANCEL_S) return false;
    clearTimeout(jump.timer);
    this.prepared = null;
    this.names.forEach((name, i) => {
      const v = this.voice(name);
      const pending = v.source!;
      pending.onended = null;
      pending.stop(0);
      pending.disconnect();
      // A later stop replaces the stop that was set for the jump's boundary.
      jump.previous[i].stop(jump.when + RESTORE_S);
      v.source = jump.previous[i];
    });
    this.segments.pop();
    this.segments[this.segments.length - 1].songEnd = jump.end;
    this.watchEnd();
    return true;
  }

  /** Sends each track to its bus. Tracks without an entry stay on Main. */
  setTrackBuses(routes: TrackBuses): void {
    for (const name of this.names) {
      const analyser = this.voice(name).analyser;
      analyser.disconnect();
      analyser.connect(this.router.buses[routes[name] ?? "main"]);
    }
  }

  /** Channels the main device has. */
  get outputChannels(): number {
    return this.router.channels;
  }

  /** A short tone on one bus, to check that output. */
  testTone(bus: BusName): void {
    this.router.testTone(bus);
  }

  setMix(mix: Mix): void {
    const gains = stemGains(mix);
    for (const name of this.names) this.voice(name).gain.gain.setTargetAtTime(gains[name], this.ctx.currentTime, RAMP_S);
  }

  /** Uses the stems' AudioContext and song-time origin, including after pause/seek. */
  setMetronome(settings: MetronomeSettings): void {
    this.stopMetronome();
    this.metronome = settings;
    if (this.playing) this.startPlayingGrid();
    else this.startRehearsal();
  }

  private firstBeat(): number {
    const { firstBeat } = this.metronome;
    return Number.isFinite(firstBeat) && firstBeat! >= 0 ? firstBeat! : 0;
  }

  /** One click at `when` (a main-clock time). Kept in `into`, so the set's owner can cancel it. */
  private click(when: number, down: boolean, into: Set<OscillatorNode> = this.clicks): void {
    const volume = this.metronome.volume;
    // The click may sit on its own device, with its own clock: `localTime` maps the time onto that clock.
    const { ctx, bus, localTime } = this.router.clickTarget();
    const at = localTime(when);
    const osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.frequency.setValueAtTime(down ? 1500 : 1000, at);
    gain.gain.setValueAtTime(Math.max(0, Math.min(1, volume)) * (down ? 1 : 0.65), at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    osc.connect(gain).connect(bus);
    into.add(osc);
    osc.onended = () => {
      into.delete(osc);
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(at);
    osc.stop(at + 0.05);
  }

  /** The count-in is always clicked, whatever the metronome mode: it is the lead-in the player asked for. */
  private scheduleCountIn(when: number, beats: number, interval: number): void {
    for (let beat = 0; beat < beats; beat++) this.click(when + beat * interval, beat % this.metronome.beats === 0, this.countInClicks);
  }

  /** Clicks on the grid along the current timeline, from where the timeline is now. Re-run by the timer, so a jump is followed. */
  private startGrid(): void {
    const { bpm, beats } = this.metronome;
    if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isInteger(beats) || beats < 1 || !this.segments.length) return;
    const firstBeat = this.firstBeat();
    const interval = 60 / bpm;
    let cursor: GridCursor = gridStart(this.segments, this.ctx.currentTime, firstBeat, interval);
    const fill = () => {
      const now = this.ctx.currentTime;
      const next = gridClicks(this.segments, cursor, now, now + 0.1, firstBeat, interval);
      cursor = next.cursor;
      for (const click of next.clicks) this.click(click.when, click.beat % beats === 0);
    };
    fill();
    this.clickTimer = setInterval(fill, 25);
  }

  /** While the song plays: the grid follows the song's timeline, so the bar phase survives pre-roll, seeks and jumps. */
  private startPlayingGrid(): void {
    if (!clicksWhilePlaying(this.metronome.mode)) return;
    this.startGrid();
  }

  /** While stopped: a grid that starts now, so a rehearsal keeps time without moving the song. */
  private startRehearsal(): void {
    if (!clicksWhileStopped(this.metronome.mode)) return;
    const anchor = this.ctx.currentTime + 0.02;
    this.segments = [{ ctxStart: anchor, songStart: 0, songEnd: Infinity }];
    this.startGrid();
  }

  private stopMetronome(): void {
    if (this.clickTimer) clearInterval(this.clickTimer);
    this.clickTimer = null;
    silence(this.clicks);
  }

  /** Current RMS level (0..1) of each stem after its gain */
  levels(): Partial<Record<StemName, number>> {
    return Object.fromEntries(
      this.names.map((name) => {
        if (!this.playing) return [name, 0];
        this.voice(name).analyser.getFloatTimeDomainData(this.meterBuffer);
        let sum = 0;
        for (const x of this.meterBuffer) sum += x * x;
        return [name, Math.sqrt(sum / this.meterBuffer.length)];
      }),
    );
  }

  /** Sends the tracks and the click to the outputs in `config`. Never stops playback: a missing output falls back to the default. */
  setOutputs(config: OutputConfig): Promise<void> {
    return this.router.apply(config);
  }

  async dispose(): Promise<void> {
    this.playing = false;
    this.stopSources();
    this.router.dispose();
    await this.ctx.close();
  }

  /**
   * The song's end: one source tells the end, the others end on the same sample. Attached to the leader, which a jump replaces, so
   * the watch moves with it. A source that a jump has replaced ends without this firing.
   */
  private watchEnd(): void {
    const leader = this.voice(this.names[0]);
    const ending = leader.source!;
    ending.onended = () => {
      if (!this.playing || leader.source !== ending) return;
      this.stopSources();
      this.playing = false;
      this.offset = this.duration;
      this.onEnded?.();
      this.startRehearsal();
    };
  }

  private stopSources() {
    this.stopMetronome();
    silence(this.countInClicks);
    for (const name of this.names) {
      const v = this.voice(name);
      if (!v.source) continue;
      v.source.onended = null;
      v.source.stop();
      v.source.disconnect();
      v.source = null;
    }
    if (this.prepared) {
      clearTimeout(this.prepared.timer);
      for (const source of this.prepared.previous) {
        source.onended = null;
        source.stop();
        source.disconnect();
      }
      this.prepared = null;
    }
  }
}
