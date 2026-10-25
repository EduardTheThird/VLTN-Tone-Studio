import { STEM_NAMES, type StemName, type Stems } from "../types";
import { beatSeconds, clicksWhilePlaying, clicksWhileStopped, preRollStart, type MetronomeMode } from "../performance/rhythm";
import { stemGains, type Mix } from "./mix";

// Plays a split's stems (four or six) in sync through WebAudio: one buffer source per stem → its gain (mixer) → an analyser
// (level meter) → the output. Pausing or seeking restarts the sources at the new position.
//
// The metronome is one grid of clicks. While the song plays it is anchored to the audio start, so a count-in (clicks before the audio)
// and a pre-roll (audio that starts before the requested position) keep the same bar phase. While stopped, a rehearsal grid starts from
// the moment it is switched on and never touches the song.

const RAMP_S = 0.015;

interface Voice {
  buffer: AudioBuffer;
  gain: GainNode;
  analyser: AnalyserNode;
  source: AudioBufferSourceNode | null;
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
  private startedAt = 0;
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
  /** Called when playback reaches the end on its own */
  onEnded: (() => void) | null = null;

  constructor(stems: Stems) {
    this.names = STEM_NAMES.filter((name) => stems[name]);
    if (!this.names.length) throw new Error("There are no stems to play.");
    const first = stems[this.names[0]]!;
    this.duration = first.channels[0].length / first.sampleRate;
    this.voices = Object.fromEntries(
      this.names.map((name) => {
        const pcm = stems[name]!;
        const buffer = this.ctx.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.sampleRate);
        pcm.channels.forEach((ch, c) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
        const gain = this.ctx.createGain();
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = this.meterBuffer.length;
        gain.connect(analyser).connect(this.ctx.destination);
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
    return Math.min(this.duration, this.ctx.currentTime - this.startedAt);
  }

  async play(lead: Lead = {}): Promise<void> {
    if (this.playing) return;
    // Rehearsal clicks stop at once; the song's own grid takes over below.
    this.stopMetronome();
    await this.ctx.resume();
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
    // One source tells the end; the others end on the same sample.
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
    this.startedAt = start - from;
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

  /** One click at `when`. Kept in `into`, so the set's owner can cancel it. */
  private click(when: number, down: boolean, into: Set<OscillatorNode> = this.clicks): void {
    const volume = this.metronome.volume;
    const osc = this.ctx.createOscillator(),
      gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(down ? 1500 : 1000, when);
    gain.gain.setValueAtTime(Math.max(0, Math.min(1, volume)) * (down ? 1 : 0.65), when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    osc.connect(gain).connect(this.ctx.destination);
    into.add(osc);
    osc.onended = () => {
      into.delete(osc);
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(when);
    osc.stop(when + 0.05);
  }

  /** The count-in is always clicked, whatever the metronome mode: it is the lead-in the player asked for. */
  private scheduleCountIn(when: number, beats: number, interval: number): void {
    for (let beat = 0; beat < beats; beat++) this.click(when + beat * interval, beat % this.metronome.beats === 0, this.countInClicks);
  }

  /** Clicks on a grid: song time `firstBeat + n × interval` at audio time `anchor + …`, not earlier than `earliest()` seconds. */
  private startGrid(anchor: number, earliest: () => number, limit: number): void {
    const { bpm, beats } = this.metronome;
    if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isInteger(beats) || beats < 1) return;
    const firstBeat = this.firstBeat();
    const interval = 60 / bpm;
    const nextBeat = () => Math.max(0, Math.ceil((earliest() - firstBeat) / interval - 1e-7));
    let beat = nextBeat();
    const fill = () => {
      // Skip missed beats instead of playing a burst when the window resumes.
      beat = Math.max(beat, nextBeat());
      while (anchor + firstBeat + beat * interval < this.ctx.currentTime + 0.1 && firstBeat + beat * interval < limit) {
        const when = Math.max(this.ctx.currentTime, anchor + firstBeat + beat * interval);
        this.click(when, beat % beats === 0);
        beat++;
      }
    };
    fill();
    this.clickTimer = setInterval(fill, 25);
  }

  /** While the song plays: the grid follows song time, so the bar phase survives pre-roll and seeks. */
  private startPlayingGrid(): void {
    if (!clicksWhilePlaying(this.metronome.mode)) return;
    const anchor = this.startedAt;
    this.startGrid(anchor, () => Math.max(this.offset, this.ctx.currentTime - anchor), this.duration);
  }

  /** While stopped: a grid that starts now, so a rehearsal keeps time without moving the song. */
  private startRehearsal(): void {
    if (!clicksWhileStopped(this.metronome.mode)) return;
    const anchor = this.ctx.currentTime + 0.02;
    this.startGrid(anchor, () => this.ctx.currentTime - anchor, Infinity);
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

  async dispose(): Promise<void> {
    this.playing = false;
    this.stopSources();
    await this.ctx.close();
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
  }
}
