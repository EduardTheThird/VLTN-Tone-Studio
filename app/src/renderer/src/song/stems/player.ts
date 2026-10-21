import { STEM_NAMES, type StemName, type Stems } from "../types";
import { stemGains, type Mix } from "./mix";

// Plays a split's stems (four or six) in sync through WebAudio: one buffer source per stem → its gain (mixer) → an analyser
// (level meter) → the output. Pausing or seeking restarts the sources at the new position.

const RAMP_S = 0.015;

interface Voice {
  buffer: AudioBuffer;
  gain: GainNode;
  analyser: AnalyserNode;
  source: AudioBufferSourceNode | null;
}

export class StemPlayer {
  readonly duration: number;
  private ctx = new AudioContext({ sampleRate: 44100 });
  /** The split's stems, STEM_NAMES order */
  readonly names: StemName[];
  private voices: Partial<Record<StemName, Voice>>;
  private startedAt = 0;
  private offset = 0;
  private playing = false;
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

  /** Playback position in seconds */
  get position(): number {
    if (!this.playing) return this.offset;
    return Math.min(this.duration, this.ctx.currentTime - this.startedAt);
  }

  async play(): Promise<void> {
    if (this.playing) return;
    await this.ctx.resume();
    if (this.offset >= this.duration) this.offset = 0;
    const when = this.ctx.currentTime + 0.02;
    for (const name of this.names) {
      const v = this.voice(name);
      const source = this.ctx.createBufferSource();
      source.buffer = v.buffer;
      source.connect(v.gain);
      source.start(when, this.offset);
      v.source = source;
    }
    // One source tells the end; the others end on the same sample.
    const leader = this.voice(this.names[0]);
    const lead = leader.source!;
    lead.onended = () => {
      if (!this.playing || leader.source !== lead) return;
      this.stopSources();
      this.playing = false;
      this.offset = this.duration;
      this.onEnded?.();
    };
    this.startedAt = when - this.offset;
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = this.position;
    this.playing = false;
    this.stopSources();
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
