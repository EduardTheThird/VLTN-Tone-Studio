import { afterEach, expect, it, vi } from "vitest";
import { createPlaybackEngine } from "../audio/playback-engine";
import { DEFAULT_OUTPUTS, type OutputConfig } from "../audio/outputs";
import type { Stems } from "../types";
import { StemPlayer } from "./player";

class Context {
  static instances: Context[] = [];
  currentTime = 10;
  /** How far this context's audio clock runs behind the performance clock, as a second device's clock can */
  clockShift = 0;
  destination = {};
  oscillators: ReturnType<Context["node"]>[] = [];
  gains: ReturnType<Context["node"]>[] = [];
  sources: ReturnType<Context["node"]>[] = [];
  constructor() {
    Context.instances.push(this);
  }
  async resume() {}
  async close() {}
  getOutputTimestamp() {
    return { contextTime: this.currentTime - this.clockShift, performanceTime: this.currentTime * 1000 };
  }
  node() {
    return {
      connect: vi.fn().mockReturnThis(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as null | (() => void),
      frequency: { setValueAtTime: vi.fn() },
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setValueCurveAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
        setTargetAtTime: vi.fn(),
      },
      buffer: null,
      fftSize: 2048,
    };
  }
  createBuffer() {
    return { copyToChannel: vi.fn() };
  }
  createGain() {
    const n = this.node();
    this.gains.push(n);
    return n;
  }
  createAnalyser() {
    return this.node();
  }
  createBufferSource() {
    const n = this.node();
    this.sources.push(n);
    return n;
  }
  createOscillator() {
    const n = this.node();
    this.oscillators.push(n);
    return n;
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Context.instances = [];
});
it("anchors clicks and stems to one audio clock, preserves bar phase on seek, and cancels queued clicks on pause", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "playing", bpm: 120, beats: 4, volume: 0.25 });
  await player.play();
  const ctx = Context.instances[0];
  expect(Context.instances).toHaveLength(1);
  expect(ctx.sources[0].start.mock.calls[0]).toEqual([10.02, 0]);
  expect(ctx.oscillators[0].start.mock.calls[0][0]).toBeCloseTo(10.02);
  player.pause();
  expect(ctx.oscillators[0].stop).toHaveBeenLastCalledWith();
  const count = ctx.oscillators.length;
  ctx.currentTime = 11;
  vi.advanceTimersByTime(1000);
  expect(ctx.oscillators).toHaveLength(count);
  await player.seek(3.75);
  await player.play();
  ctx.currentTime = 11.2;
  vi.advanceTimersByTime(25);
  const next = ctx.oscillators.at(-1)!;
  // Beat 8 is at song second 4, a downbeat, not a new bar at the seek point.
  expect(next.start.mock.calls[0][0]).toBeCloseTo(11.27);
  expect(next.frequency.setValueAtTime.mock.calls[0][0]).toBe(1500);
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25 });
  const muted = ctx.oscillators.length;
  ctx.currentTime = 12;
  vi.advanceTimersByTime(1000);
  expect(ctx.oscillators).toHaveLength(muted);
  expect(player.isPlaying).toBe(true);
  await player.dispose();
});

it("can resume after pausing during the audio start pre-roll", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  await player.play();
  expect(player.position).toBeLessThan(0);
  player.pause();
  expect(player.position).toBe(0);
  await player.play();
  expect(Context.instances[0].sources.at(-1)!.start).toHaveBeenCalledWith(10.02, 0);
  await player.dispose();
});

it("anchors the first downbeat after an intro and preserves its phase through pause and seek", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "playing", bpm: 120, beats: 4, volume: 0.25, firstBeat: 1.25 });
  await player.play();
  const ctx = Context.instances[0];
  expect(ctx.oscillators).toHaveLength(0);
  ctx.currentTime = 11.2;
  vi.advanceTimersByTime(25);
  expect(ctx.oscillators[0].start.mock.calls[0][0]).toBeCloseTo(11.27);
  expect(ctx.oscillators[0].frequency.setValueAtTime.mock.calls[0][0]).toBe(1500);
  ctx.currentTime = 11.4;
  player.pause();
  const count = ctx.oscillators.length;
  ctx.currentTime = 12;
  await player.play();
  expect(ctx.oscillators).toHaveLength(count);
  ctx.currentTime = 12.35;
  vi.advanceTimersByTime(25);
  expect(ctx.oscillators.at(-1)!.start.mock.calls[0][0]).toBeCloseTo(12.39);
  expect(ctx.oscillators.at(-1)!.frequency.setValueAtTime.mock.calls[0][0]).toBe(1000);
  await player.seek(3.2);
  expect(ctx.oscillators.at(-1)!.start.mock.calls[0][0]).toBeCloseTo(12.42);
  expect(ctx.oscillators.at(-1)!.frequency.setValueAtTime.mock.calls[0][0]).toBe(1500);
  await player.dispose();
});

it("does not replay the beat just before a seek or burst missed clicks after a stall", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "playing", bpm: 120, beats: 4, volume: 0.25, firstBeat: 1.25 });
  await player.seek(1.26);
  await player.play();
  const ctx = Context.instances[0];
  expect(ctx.oscillators).toHaveLength(0);
  ctx.currentTime = 13.2;
  vi.advanceTimersByTime(25);
  expect(ctx.oscillators).toHaveLength(0);
  ctx.currentTime = 13.45;
  vi.advanceTimersByTime(25);
  expect(ctx.oscillators).toHaveLength(1);
  expect(ctx.oscillators[0].start.mock.calls[0][0]).toBeCloseTo(13.51);
  await player.seek(9.9);
  const count = ctx.oscillators.length;
  ctx.currentTime = 14;
  vi.advanceTimersByTime(25);
  expect(ctx.oscillators).toHaveLength(count);
  await player.dispose();
});

it("clicks a count-in on the grid before the audio starts, and a pause during it returns to the requested position", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25 });
  await player.play({ countInBeats: 4 });
  const ctx = Context.instances[0];
  // One bar at 120 BPM is two seconds: audio starts at 2.0 s after the first click.
  expect(ctx.sources[0].start.mock.calls[0][0]).toBeCloseTo(12.02);
  const clicks = ctx.oscillators.map((osc) => osc.start.mock.calls[0][0]);
  [10.02, 10.52, 11.02, 11.52].forEach((at, i) => expect(clicks[i]).toBeCloseTo(at));
  expect(ctx.oscillators[0].frequency.setValueAtTime.mock.calls[0][0]).toBe(1500);
  expect(ctx.oscillators[1].frequency.setValueAtTime.mock.calls[0][0]).toBe(1000);
  ctx.currentTime = 10.5;
  expect(player.position).toBeLessThan(0);
  player.pause();
  expect(player.position).toBe(0);
  await player.dispose();
});

it("starts the audio before the requested position by the pre-roll, clamped at the start of the song", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(10000)] } });
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25 });
  await player.seek(60);
  await player.play({ preRollBeats: 2 });
  expect(Context.instances[0].sources.at(-1)!.start.mock.calls[0][1]).toBeCloseTo(59);
  await player.dispose();
  const early = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(10000)] } });
  early.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25 });
  await early.seek(0.5);
  await early.play({ preRollBeats: 4 });
  expect(Context.instances.at(-1)!.sources.at(-1)!.start.mock.calls[0][1]).toBe(0);
  await early.dispose();
});

it("clicks on its own grid while stopped, and stops the rehearsal when the song plays", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "stopped", bpm: 120, beats: 4, volume: 0.25 });
  const ctx = Context.instances[0];
  expect(ctx.oscillators[0].start.mock.calls[0][0]).toBeCloseTo(10.02);
  ctx.currentTime = 10.5;
  vi.advanceTimersByTime(25);
  expect(ctx.oscillators.at(-1)!.start.mock.calls[0][0]).toBeCloseTo(10.52);
  await player.play();
  const count = ctx.oscillators.length;
  ctx.currentTime = 11;
  vi.advanceTimersByTime(1000);
  expect(ctx.oscillators).toHaveLength(count);
  expect(player.isPlaying).toBe(true);
  await player.dispose();
});

it("keeps the count-in when the metronome changes mid-count-in, and pause cancels it", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.25 });
  await player.play({ countInBeats: 4 });
  const ctx = Context.instances[0];
  const countIn = ctx.oscillators.slice(0, 4);
  // stop() with no argument is the cancel; the scheduled stop passes its end time.
  const cancelled = (osc: (typeof countIn)[number]) => osc.stop.mock.calls.some((call) => call.length === 0);
  ctx.currentTime = 10.2;
  player.setMetronome({ mode: "off", bpm: 120, beats: 4, volume: 0.5 });
  expect(countIn.some(cancelled)).toBe(false);
  player.pause();
  expect(countIn.every(cancelled)).toBe(true);
  await player.dispose();
});

/** A Context whose destination reports a device's channel count, and which records the output nodes it creates. */
class OutputContext extends Context {
  destination: { maxChannelCount?: number; channelCount?: number; channelInterpretation?: string } = { maxChannelCount: 4, channelCount: 2 };
  analysers: ReturnType<Context["node"]>[] = [];
  createAnalyser() {
    const analyser = super.createAnalyser();
    this.analysers.push(analyser);
    return analyser;
  }
  merger: ReturnType<Context["node"]> | null = null;
  sinkIds: string[] = [];
  /** How many of the next setSinkId calls reject */
  sinkFailures = 0;
  createChannelMerger() {
    this.merger = this.node();
    return this.merger;
  }
  async setSinkId(sinkId: string) {
    this.sinkIds.push(sinkId);
    if (this.sinkFailures > 0) {
      this.sinkFailures--;
      throw new Error("NotFoundError");
    }
  }
}

function oneStem(): Stems {
  return { other: { sampleRate: 100, channels: [new Float32Array(1000)] } } as Stems;
}

function interface4(click: [number, number]): OutputConfig {
  return {
    deviceId: "usb-4",
    label: "Interface",
    clickDevice: null,
    buses: { ...DEFAULT_OUTPUTS.buses, click: { channels: click, gain: 1 } },
  };
}

it("sends the click to outputs 3 and 4 and the tracks to 1 and 2 on a four-output interface", async () => {
  vi.stubGlobal("AudioContext", OutputContext);
  const player = new StemPlayer(oneStem());
  const ctx = Context.instances[0] as OutputContext;
  await player.setOutputs(interface4([2, 3]));
  expect(ctx.sinkIds).toEqual(["usb-4"]);
  expect(ctx.merger).not.toBeNull();
  expect(ctx.destination.channelCount).toBe(4);
  expect(ctx.destination.channelInterpretation).toBe("discrete");
  // The first two gains are the main and click buses, created before any voice.
  const [main, click] = ctx.gains;
  expect(main.connect).toHaveBeenCalledWith(ctx.merger, 0, 0);
  expect(main.connect).toHaveBeenCalledWith(ctx.merger, 1, 1);
  expect(click.connect).toHaveBeenCalledWith(ctx.merger, 0, 2);
  expect(click.connect).toHaveBeenCalledWith(ctx.merger, 1, 3);
  await player.dispose();
});

it("falls back to the default output and warns when the device cannot be selected", async () => {
  vi.stubGlobal("AudioContext", OutputContext);
  const player = new StemPlayer(oneStem());
  const warnings: string[] = [];
  player.onOutputWarning = (message) => warnings.push(message);
  const ctx = Context.instances[0] as OutputContext;
  ctx.sinkFailures = 1;
  await player.setOutputs(interface4([2, 3]));
  expect(ctx.sinkIds).toEqual(["usb-4", ""]);
  expect(ctx.merger).toBeNull();
  expect(ctx.gains[0].connect).toHaveBeenCalledWith(ctx.destination);
  expect(ctx.gains[1].connect).toHaveBeenCalledWith(ctx.destination);
  expect(warnings).toHaveLength(1);
  await player.dispose();
});

it("keeps both buses on outputs 1 and 2 and warns when the device has no pair for the click", async () => {
  vi.stubGlobal("AudioContext", OutputContext);
  const player = new StemPlayer(oneStem());
  const warnings: string[] = [];
  player.onOutputWarning = (message) => warnings.push(message);
  const ctx = Context.instances[0] as OutputContext;
  ctx.destination.maxChannelCount = 2;
  await player.setOutputs(interface4([2, 3]));
  expect(ctx.merger).toBeNull();
  expect(ctx.gains[1].connect).toHaveBeenCalledWith(ctx.destination);
  expect(warnings).toHaveLength(1);
  await player.dispose();
});

it("moves to the default output when the device disappears, and back when it returns", async () => {
  const listeners: Array<() => void> = [];
  let devices = [{ deviceId: "usb-4", label: "Interface", kind: "audiooutput" }];
  vi.stubGlobal("navigator", {
    mediaDevices: {
      enumerateDevices: async () => devices,
      addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
      removeEventListener: vi.fn(),
    },
  });
  vi.stubGlobal("AudioContext", OutputContext);
  const player = new StemPlayer(oneStem());
  const warnings: string[] = [];
  player.onOutputWarning = (message) => warnings.push(message);
  const ctx = Context.instances[0] as OutputContext;
  await player.setOutputs(interface4([2, 3]));
  expect(ctx.merger).not.toBeNull();

  devices = [];
  listeners[0]();
  await vi.waitFor(() => expect(ctx.sinkIds).toEqual(["usb-4", ""]));
  expect(ctx.gains[1].connect).toHaveBeenLastCalledWith(ctx.destination);
  expect(warnings).toHaveLength(1);
  expect(player.isPlaying).toBe(false);

  devices = [{ deviceId: "usb-4", label: "Interface", kind: "audiooutput" }];
  listeners[0]();
  await vi.waitFor(() => expect(ctx.sinkIds).toEqual(["usb-4", "", "usb-4"]));
  expect(ctx.merger).not.toBeNull();
  await player.dispose();
});

it("plays the count-in on the click device at the time that device's clock reads", async () => {
  // The second context is the click device; its clock runs 5 s behind the main one.
  class SecondDevice extends OutputContext {
    clockShift = Context.instances.length > 1 ? 5 : 0;
  }
  vi.stubGlobal("AudioContext", SecondDevice);
  const player = new StemPlayer(oneStem());
  await player.setOutputs({ ...interface4([2, 3]), clickDevice: { deviceId: "hp", label: "Headphones" } });
  const [main, sink] = Context.instances as OutputContext[];
  expect(sink.sinkIds).toEqual(["hp"]);
  await player.play({ countInBeats: 4 });
  expect(main.oscillators).toHaveLength(0);
  // The main clock's beats are at 10.02, 10.52, 11.02 and 11.52; on the click device they read 5 s earlier.
  expect(sink.oscillators).toHaveLength(4);
  expect(sink.oscillators[0].start.mock.calls[0][0]).toBeCloseTo(5.02);
  expect(sink.oscillators[1].start.mock.calls[0][0]).toBeCloseTo(5.52);
  expect(sink.oscillators[3].start.mock.calls[0][0]).toBeCloseTo(6.52);
  await player.dispose();
});

it("sends each track to its assigned bus, and leaves the others on Main", async () => {
  vi.stubGlobal("AudioContext", OutputContext);
  const player = new StemPlayer({
    drums: { sampleRate: 100, channels: [new Float32Array(1000)] },
    other: { sampleRate: 100, channels: [new Float32Array(1000)] },
  } as Stems);
  const ctx = Context.instances[0] as OutputContext;
  const [drumsAnalyser, otherAnalyser] = ctx.analysers;
  player.setTrackBuses({ drums: "aux1" });
  expect(drumsAnalyser.disconnect).toHaveBeenCalled();
  expect(drumsAnalyser.connect).toHaveBeenLastCalledWith(ctx.gains[2]);
  expect(otherAnalyser.connect).toHaveBeenLastCalledWith(ctx.gains[0]);
  await player.dispose();
});

it("plays a planned jump at its boundary: the stems stop there and restart at the target on the same audio clock", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  await player.play();
  const ctx = Context.instances[0];
  ctx.currentTime = 12;
  // Song 5 is 5 s after the start at 10.02 on the audio clock.
  expect(player.prepareJump(2, 5)).toBeCloseTo(15.02);
  const [old, next] = ctx.sources;
  expect(old.stop).toHaveBeenLastCalledWith(15.02);
  expect(next.start).toHaveBeenCalledWith(15.02, 2);
  ctx.currentTime = 14.9;
  expect(player.position).toBeCloseTo(4.88);
  ctx.currentTime = 15.5;
  expect(player.position).toBeCloseTo(2.48);
  // A second jump cannot be queued on top of the first.
  expect(player.prepareJump(0, 9)).toBeNull();
  await player.dispose();
});

it("cancels a waiting jump in time, and the stems keep their place", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  await player.play();
  const ctx = Context.instances[0];
  ctx.currentTime = 12;
  player.prepareJump(2, 5);
  const [old, next] = ctx.sources;
  expect(player.cancelJump()).toBe(true);
  expect(next.stop).toHaveBeenCalledWith(0);
  // The stems go back to the song's own end (10 s of audio from 10.02), not to a far-off stop.
  expect(old.stop).toHaveBeenLastCalledWith(20.02);
  ctx.currentTime = 14.9;
  expect(player.position).toBeCloseTo(4.88);
  // The cancelled jump leaves the timeline as it was, so a new one can be queued.
  expect(player.prepareJump(2, 6)).toBeCloseTo(16.02);
  await player.dispose();
});

it("refuses to cancel a jump that is already too close to take effect, and the jump then stands", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  await player.play();
  const ctx = Context.instances[0];
  ctx.currentTime = 12;
  player.prepareJump(2, 5);
  ctx.currentTime = 14.95;
  expect(player.cancelJump()).toBe(false);
  ctx.currentTime = 15.1;
  expect(player.position).toBeCloseTo(2.08);
  await player.dispose();
});

it("keeps the metronome on the song's bar grid through a jump, and clicks the target's beats", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: { sampleRate: 100, channels: [new Float32Array(1000)] } });
  player.setMetronome({ mode: "playing", bpm: 120, beats: 4, volume: 0.25 });
  await player.play();
  const ctx = Context.instances[0];
  const step = (to: number) => {
    for (let t = ctx.currentTime; t < to; t += 0.25) {
      ctx.currentTime = t;
      vi.advanceTimersByTime(25);
    }
    ctx.currentTime = to;
    vi.advanceTimersByTime(25);
  };
  step(12);
  player.prepareJump(2, 5);
  step(15.6);
  const times = ctx.oscillators.map((osc) => osc.start.mock.calls[0][0] as number);
  // Song 2 (beat 4, a downbeat) plays again at 15.02; song 2.5 at 15.52. The old passage's beat at song 5 is not clicked.
  const after = times.filter((t) => t >= 15);
  expect(after).toHaveLength(2);
  expect(after[0]).toBeCloseTo(15.02);
  expect(after[1]).toBeCloseTo(15.52);
  expect(ctx.oscillators.find((osc) => Math.abs((osc.start.mock.calls[0][0] as number) - 15.02) < 1e-6)!.frequency.setValueAtTime.mock.calls[0][0]).toBe(1500);
  await player.dispose();
});

const pcm = (frames: number) => ({ sampleRate: 100, channels: [new Float32Array(frames)] });

it("plays only the trimmed range, and fades in and out at its ends", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = new StemPlayer({ other: pcm(1000) }, undefined, { trimStart: 2, trimEnd: 6, fadeIn: 0.5, fadeOut: 1 });
  expect(player.start).toBe(2);
  expect(player.duration).toBe(6);
  expect(player.position).toBe(2);
  await player.play();
  const ctx = Context.instances[0];
  expect(ctx.sources[0].start).toHaveBeenCalledWith(10.02, 2);
  expect(ctx.sources[0].stop).toHaveBeenCalledWith(14.02);
  const ramps = ctx.gains.flatMap((g) => g.gain.linearRampToValueAtTime.mock.calls);
  expect(ramps).toEqual([
    [1, 10.52],
    [0, 14.02],
  ]);
  await player.seek(1);
  // Playing from 10.02 on a clock still at 10, so the position is just short of the trim start.
  expect(player.position).toBeCloseTo(2, 1);
  await player.dispose();
});

it("hands over to the next song on the same clock, fading out the outgoing one", async () => {
  vi.stubGlobal("AudioContext", Context);
  const engine = createPlaybackEngine();
  const outgoing = new StemPlayer({ other: pcm(1000) }, engine);
  const incoming = new StemPlayer({ other: pcm(500) }, engine);
  await outgoing.play();
  const ctx = Context.instances[0];
  expect(Context.instances).toHaveLength(1);
  ctx.currentTime = 12;
  const join = { startAt: 19, fadeLength: 1, stopAt: 20.02, lead: {} };
  expect(outgoing.chainNext(incoming, join)).toBe(true);
  expect(ctx.sources[0].stop).toHaveBeenLastCalledWith(20.02);
  expect(ctx.sources[1].start).toHaveBeenCalledWith(19, 0);
  const curves = ctx.gains.flatMap((g) => g.gain.setValueCurveAtTime.mock.calls).map((call) => call.slice(1));
  expect(curves).toEqual([
    [19, 1],
    [19, 1],
  ]);
  expect(incoming.isPlaying).toBe(true);
  // The outgoing song's own end hands over without starting a rehearsal grid.
  const clicks = ctx.oscillators.length;
  ctx.currentTime = 20.02;
  ctx.sources[0].onended?.();
  expect(outgoing.isPlaying).toBe(false);
  expect(ctx.oscillators).toHaveLength(clicks);
  expect(outgoing.detachNext()).toBe(incoming);
  await outgoing.dispose();
  await incoming.dispose();
  await engine.close();
});

it("keeps a handed-over song's stems running to their end when it is disposed", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", Context);
  const engine = createPlaybackEngine();
  const outgoing = new StemPlayer({ other: pcm(1000) }, engine);
  const incoming = new StemPlayer({ other: pcm(500) }, engine);
  await outgoing.play();
  const ctx = Context.instances[0];
  ctx.currentTime = 12;
  outgoing.chainNext(incoming, { startAt: 19, fadeLength: 1, stopAt: 20.02, lead: {} });
  expect(outgoing.detachNext()).toBe(incoming);
  ctx.currentTime = 19.5;
  await outgoing.dispose();
  // Stopping now would cut the crossfade short: only the scheduled stop may end the outgoing stems.
  expect(ctx.sources[0].stop.mock.calls.some((call) => call.length === 0)).toBe(false);
  vi.advanceTimersByTime(1000);
  await incoming.dispose();
  await engine.close();
});

it("cancels a hand-over when the outgoing song is paused, and the next song stops", async () => {
  vi.stubGlobal("AudioContext", Context);
  const engine = createPlaybackEngine();
  const outgoing = new StemPlayer({ other: pcm(1000) }, engine);
  const incoming = new StemPlayer({ other: pcm(500) }, engine);
  await outgoing.play();
  const ctx = Context.instances[0];
  ctx.currentTime = 12;
  expect(outgoing.chainNext(incoming, { startAt: 19, fadeLength: 1, stopAt: 20.02, lead: {} })).toBe(true);
  outgoing.pause();
  expect(incoming.isPlaying).toBe(false);
  expect(outgoing.isPlaying).toBe(false);
  expect(ctx.sources[1].stop.mock.calls.some((call) => call.length === 0)).toBe(true);
  await outgoing.dispose();
  await incoming.dispose();
  await engine.close();
});
