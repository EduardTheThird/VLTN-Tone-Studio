import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StemPlayer } from "@/song/stems/player";
import type { Stems } from "@/song/types";
import { PerformanceSession, selectArmed, type SessionInputs } from "./session";
import { defaultBindings, startLearn, stopLearn, useRemoteLearn, type Binding } from "./bindings";
import { useMidiConfiguration } from "./midi-configuration";
import { parseChart } from "./chart";
import type { Section } from "./sections";
import { useMidiDiagnostics } from "./midi-diagnostics";
import { useOutputSettings } from "@/song/audio/output-settings";
import { DEFAULT_OUTPUTS } from "@/song/audio/outputs";

const mocks = vi.hoisted(() => ({
  position: 0,
  audioNow: 0,
  jumps: [] as { to: number; at: number }[],
  cancelOk: true,
  plans: [] as { cap: number | null; jump: { at: number; position: number } | null }[],
  outputs: [] as { player: unknown; config: unknown }[],
  toasts: [] as unknown[],
  players: [] as { onOutputWarning: ((message: string) => void) | null; isPlaying: boolean }[],
  lead: undefined as unknown,
  rate: 1,
  swaps: [] as unknown[],
  applied: [] as unknown[],
  configs: [] as { rate?: number; tempo: number[][] | null; playTriggers?: number[][] }[],
  swapAt: 2.5,
  swapWhen: 2.6,
  faults: [] as ((message: string) => void)[],
  sends: [] as ((message: { bytes: number[]; due: number; label: string }) => void)[],
  library: {
    playlistPlaying: false,
    queue: [] as string[],
    position: 0,
    pausePlaylist: vi.fn(),
    rememberMidi: vi.fn(),
    advancePlaylist: vi.fn(),
    skipPlaylist: vi.fn(),
    preparedNext: (): unknown => null,
    advanceToPrepared: vi.fn((): boolean => false),
    resumePlaylist: vi.fn(),
    // The held song is released by the library: stopped and unwired, as in the app.
    handover: null as null | { id: string; player: { dispose: () => Promise<void> }; countInMs: number; unwire: () => void },
    setHandover(handover: { id: string; player: { dispose: () => Promise<void> }; countInMs: number; unwire: () => void }) {
      this.releaseHandover();
      this.handover = handover;
    },
    claimHandover(id: string | undefined) {
      const held = this.handover;
      if (!held) return null;
      this.handover = null;
      if (held.id === id) return held;
      held.unwire();
      void held.player.dispose();
      return null;
    },
    releaseHandover() {
      const held = this.handover;
      if (!held) return;
      this.handover = null;
      held.unwire();
      void held.player.dispose();
    },
  },
}));
vi.mock("@/app/notify", () => ({ showToast: (spec: unknown) => mocks.toasts.push(spec) }));
vi.mock("@/song/audio/playback-engine", () => ({ sharedPlaybackEngine: () => ({}) }));
vi.mock("@/song/stems/player", () => ({
  StemPlayer: class {
    duration = 60;
    start = 0;
    behaviour = "next";
    disposed = false;
    isPlaying = false;
    onEnded?: () => void;
    onOutputWarning: ((message: string) => void) | null = null;
    constructor() {
      mocks.players.push(this);
    }
    setOutputs(config: unknown) {
      mocks.outputs.push({ player: this, config });
      return Promise.resolve();
    }
    get position() {
      return mocks.position;
    }
    get playbackRate() {
      return mocks.rate;
    }
    renderBuffers(_stems: unknown, rate: number) {
      return Promise.resolve({ rate, buffers: {} });
    }
    applyRender(render: unknown) {
      mocks.applied.push(render);
    }
    swapRender(render: unknown) {
      mocks.swaps.push(render);
      return { at: mocks.swapAt, when: mocks.swapWhen };
    }
    async play(lead?: unknown) {
      mocks.lead = lead;
      this.isPlaying = true;
    }
    pause() {
      this.isPlaying = false;
    }
    async seek(value: number) {
      mocks.position = value;
    }
    get audioNow() {
      return mocks.audioNow;
    }
    audioTimeOf(at: number) {
      return mocks.audioNow + (at - mocks.position);
    }
    prepareJump(to: number, at: number) {
      mocks.jumps.push({ to, at });
      return this.audioTimeOf(at);
    }
    cancelJump() {
      return mocks.cancelOk;
    }
    chainNext() {
      return true;
    }
    detachNext() {
      return null;
    }
    cancelChain() {}
    async dispose() {
      this.disposed = true;
    }
  },
}));
vi.mock("@/song/store", () => ({ useSong: { getState: () => ({ source: null }) } }));
// Renders are built on the same thread here: the worker is tested in render-queue.test.ts
vi.mock("@/song/audio/render-queue", () => ({
  RenderQueue: class {
    render(base: unknown) {
      return Promise.resolve(base);
    }
    clear() {}
  },
  isPlainSpeed: (speed: { rate: number; semitones: number; cents: number }) => speed.rate === 1 && speed.semitones === 0 && speed.cents === 0,
}));
vi.mock("@/song/library", () => ({ useSongLibrary: { getState: () => mocks.library } }));
vi.mock("@/song/performance/midi-scheduler-client", () => ({
  midiNow: () => performance.timeOrigin + performance.now(),
  prepareMidiScheduler: () => ({ worker: { terminate: vi.fn() }, ready: Promise.resolve(), cancel: vi.fn() }),
  startMidiScheduler: (config: (typeof mocks.configs)[number], send: (typeof mocks.sends)[number], fault: (message: string) => void) => {
    mocks.configs.push(config);
    mocks.sends.push(send);
    mocks.faults.push(fault);
    return {
      stop: vi.fn(),
      sync: vi.fn(),
      plan: (cap: number | null, jump: { at: number; position: number } | null) => mocks.plans.push({ cap, jump }),
    };
  },
}));

const source = { name: "song.wav", libraryId: "a" as string | undefined, audio: { sampleRate: 44100, channels: [new Float32Array(10)] } };
const output = () => ({ id: "usb", name: "USB", state: "connected", send: vi.fn(), clear: vi.fn() });
const inputs = (patch: Partial<SessionInputs> = {}): SessionInputs => ({
  bluetooth: null,
  tempoOnStart: false,
  tempoChannel: 1,
  savedOutput: null,
  savedInput: null,
  queued: false,
  playlistPlaying: false,
  busy: false,
  cues: [],
  parseError: "",
  bpm: 120,
  ...patch,
});
/** The session for the next playlist song, after the view was re-created on the hand-over. It is armed as the previous session was. */
function joinedSession(out: ReturnType<typeof output>, access: MIDIAccess, patch: Partial<SessionInputs> = {}) {
  const session = new PerformanceSession({
    initial: inputs({ queued: true, playlistPlaying: true, ...patch }),
    carried: { access, portId: "usb", inputId: "", armed: true, output: out },
    initialClock: false,
  });
  const unload = session.loadSong({ ...source, libraryId: "b", name: "b.wav" }, null);
  session.bind();
  return { session, unload };
}

function armedSession(out = output(), patch: Partial<SessionInputs> = {}) {
  const access = Object.assign(new EventTarget(), { outputs: new Map([["usb", out]]), inputs: new Map() }) as unknown as MIDIAccess;
  const session = new PerformanceSession({
    initial: inputs(patch),
    carried: { access, portId: "usb", inputId: "", armed: true, output: out },
    initialClock: false,
  });
  const unload = session.loadSong(source, null);
  session.bind();
  return { session, out, access, unload };
}

beforeEach(() => {
  mocks.position = 0;
  mocks.audioNow = 0;
  mocks.jumps.length = 0;
  mocks.plans.length = 0;
  mocks.cancelOk = true;
  mocks.outputs.length = 0;
  mocks.toasts.length = 0;
  mocks.players.length = 0;
  mocks.faults.length = 0;
  mocks.sends.length = 0;
  mocks.library.playlistPlaying = false;
  mocks.library.queue = [];
  mocks.rate = 1;
  mocks.swaps.length = 0;
  mocks.applied.length = 0;
  mocks.configs.length = 0;
  useMidiDiagnostics.getState().reset();
});
afterEach(() => vi.clearAllMocks());

it("restores arming handed over by the previous song only for the same output object", () => {
  const { session, out } = armedSession();
  expect(selectArmed(session.state)).toBe(true);
  const other = output();
  const replaced = new PerformanceSession({
    initial: inputs(),
    carried: { access: session.state.access, portId: "usb", inputId: "", armed: true, output: other },
    initialClock: false,
  });
  expect(selectArmed(replaced.state)).toBe(false);
  expect(out.send).not.toHaveBeenCalled();
});

it("releases only the channels that played notes and sends Stop once when paused with clock on", async () => {
  const { session, out } = armedSession();
  session.setClock(true);
  await session.play();
  out.send.mockClear();
  session.sendPerformance([0x90 | 2, 60, 100]);
  session.pause();
  const sent = out.send.mock.calls.map((c) => c[0]);
  expect(sent).toContainEqual([178, 64, 0]);
  expect(sent).toContainEqual([178, 123, 0]);
  expect(sent).toContainEqual([252]);
  expect(sent.filter((m) => m[0] === 252)).toHaveLength(1);
  expect(out.clear).toHaveBeenCalledTimes(1);
  session.pause();
  expect(out.send.mock.calls.filter((c) => c[0][0] === 252)).toHaveLength(1);
});

it("disarms and panics when the scheduler reports a fault", async () => {
  const { session, out } = armedSession();
  await session.play();
  expect(mocks.faults).toHaveLength(1);
  mocks.faults[0]("MIDI timing interrupted");
  expect(selectArmed(session.state)).toBe(false);
  expect(session.state.error).toBe("MIDI timing interrupted");
  expect(useMidiDiagnostics.getState().failures).toBe(1);
  expect(out.clear).toHaveBeenCalled();
});

it("disarms when the output is replaced and does not carry arming to the new object", () => {
  const { session, access } = armedSession();
  (access.outputs as unknown as Map<string, unknown>).set("usb", output());
  access.dispatchEvent(new Event("statechange"));
  expect(selectArmed(session.state)).toBe(false);
  expect(useMidiDiagnostics.getState().lastFailure).toContain("disconnected or replaced");
});

it("toggles playback from a CC80 remote message on the selected input", async () => {
  const input = Object.assign(new EventTarget(), { id: "in", state: "connected" });
  const access = Object.assign(new EventTarget(), { outputs: new Map(), inputs: new Map([["in", input]]) }) as unknown as MIDIAccess;
  const session = new PerformanceSession({
    initial: inputs(),
    carried: { access, portId: "", inputId: "in", armed: false, output: undefined },
    initialClock: false,
  });
  session.loadSong(source, null);
  session.bind();
  const message = (data: number[]) => Object.assign(new Event("midimessage"), { data: Uint8Array.from(data) });
  input.dispatchEvent(message([176, 80, 127]));
  await vi.waitFor(() => expect(session.state.playing).toBe(true));
  // A repeat within the bounce window is the same press; the next press comes after it.
  input.dispatchEvent(message([176, 80, 127]));
  expect(session.state.playing).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 200));
  input.dispatchEvent(message([176, 80, 127]));
  expect(session.state.playing).toBe(false);
  session.dispose();
});

it("does not send a scheduled message to a replacement output that was never armed", async () => {
  const { session, access, out } = armedSession();
  await session.play();
  const replacement = output();
  (access.outputs as unknown as Map<string, unknown>).set("usb", replacement);
  mocks.sends[0]({ bytes: [192, 1], due: performance.timeOrigin + performance.now(), label: "Patch" });
  expect(replacement.send).not.toHaveBeenCalled();
  expect(out.send.mock.calls.some((c) => c[0][0] === 192)).toBe(false);
});

it("stops once and restarts the transport when the clock is toggled during playback", async () => {
  const { session, out } = armedSession();
  session.setClock(true);
  await session.play();
  expect(out.send.mock.calls.some((c) => c[0][0] === 250)).toBe(true);
  out.send.mockClear();
  out.clear.mockClear();
  session.setClock(false);
  expect(out.send.mock.calls.filter((c) => c[0][0] === 252)).toHaveLength(1);
  expect(out.clear).toHaveBeenCalledTimes(1);
  expect(mocks.faults).toHaveLength(2);
});

it("disarms a replaced Bluetooth connection and never arms its replacement", () => {
  const first = { ...output(), id: "bluetooth-midi", subscribe: vi.fn() };
  const session = new PerformanceSession({
    initial: inputs({ bluetooth: first as never }),
    carried: { access: null, portId: "bluetooth-midi", inputId: "", armed: true, output: first },
    initialClock: false,
  });
  session.loadSong(source, null);
  session.bind();
  expect(selectArmed(session.state)).toBe(true);
  session.update({ bluetooth: null });
  expect(selectArmed(session.state)).toBe(false);
  session.update({ bluetooth: { ...first } as never });
  expect(selectArmed(session.state)).toBe(false);
  expect(useMidiDiagnostics.getState().lastFailure).toContain("Bluetooth output disconnected or replaced");
});

it("starts on remote Start and Stop, and stops on Stop", async () => {
  const input = Object.assign(new EventTarget(), { id: "in", state: "connected" });
  const access = Object.assign(new EventTarget(), { outputs: new Map(), inputs: new Map([["in", input]]) }) as unknown as MIDIAccess;
  const session = new PerformanceSession({
    initial: inputs(),
    carried: { access, portId: "", inputId: "in", armed: false, output: undefined },
    initialClock: false,
  });
  session.loadSong(source, null);
  session.bind();
  const message = (data: number[]) => Object.assign(new Event("midimessage"), { data: Uint8Array.from(data) });
  input.dispatchEvent(message([250]));
  await vi.waitFor(() => expect(session.state.playing).toBe(true));
  input.dispatchEvent(message([252]));
  expect(session.state.playing).toBe(false);
});

it("survives dispose and bind, as under StrictMode, and stops the old scheduler", async () => {
  const { session } = armedSession();
  await session.play();
  session.dispose();
  session.bind();
  expect(session.state.playing).toBe(true);
  expect(mocks.faults.length).toBeGreaterThanOrEqual(2);
});

it("refuses to seek while locked", async () => {
  const { session } = armedSession();
  session.locked = true;
  await session.seek(30);
  expect(mocks.position).toBe(0);
  session.locked = false;
  await session.seek(30);
  expect(mocks.position).toBe(30);
});

it("chains the next playlist song near the end, takes it over at its join, and does not send Stop", async () => {
  vi.useFakeTimers();
  // The next song was prepared before the join, so its player already exists and is the one the session chains.
  const incoming = new StemPlayer({} as Stems);
  const next = { id: "b", title: "B", source: { name: "b.wav", libraryId: "b", audio: source.audio }, stems: {}, settings: {}, player: incoming };
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  mocks.library.preparedNext = () => next as never;
  mocks.library.advanceToPrepared = vi.fn(() => true);
  const { session, out, access, unload } = armedSession(output(), { queued: true, playlistPlaying: true });
  // The queued song starts itself; let that start settle.
  await vi.advanceTimersByTimeAsync(10);
  expect(session.state.playing).toBe(true);
  // The outgoing song has four seconds left, which is inside the chaining window.
  mocks.position = 56;
  mocks.audioNow = 16;
  vi.advanceTimersByTime(250);
  expect(session.state.player).not.toBe(incoming);
  // The hand-over is taken half a second before the join, which is at the outgoing song's end.
  vi.advanceTimersByTime(3500);
  expect(mocks.library.advanceToPrepared).toHaveBeenCalledWith("b");
  // The library's change re-creates the view: the outgoing session is let go, and the new session takes the chained song up.
  const outgoing = session.state.player!;
  unload();
  session.dispose();
  expect((outgoing as unknown as { disposed: boolean }).disposed).toBe(true);
  const joined = joinedSession(out, access);
  expect(joined.session.state.player).toBe(incoming);
  expect(joined.session.state.playing).toBe(true);
  expect(mocks.library.handover).toBeNull();
  expect(mocks.players).toHaveLength(2);
  expect(out.send.mock.calls.some(([bytes]) => bytes?.[0] === 252)).toBe(false);
  joined.unload();
  joined.session.dispose();
  vi.useRealTimers();
});

it("does not chain a song that is set to stop the playlist", async () => {
  vi.useFakeTimers();
  const next = { id: "b", title: "B", source: { name: "b.wav", libraryId: "b", audio: source.audio }, stems: {}, settings: {}, player: new StemPlayer({} as Stems) };
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  mocks.library.preparedNext = () => next as never;
  armedSession(output(), { queued: true, playlistPlaying: true });
  await vi.advanceTimersByTimeAsync(10);
  (mocks.players.at(-1) as unknown as { behaviour: string }).behaviour = "stop";
  mocks.position = 56;
  mocks.audioNow = 16;
  vi.advanceTimersByTime(1000);
  expect(mocks.library.advanceToPrepared).not.toHaveBeenCalled();
  expect(mocks.players).toHaveLength(2);
  vi.useRealTimers();
});

it("keeps the next playlist song waiting when none is ready, so the join is a gap", async () => {
  vi.useFakeTimers();
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  mocks.library.preparedNext = () => null;
  armedSession(output(), { queued: true, playlistPlaying: true });
  await vi.advanceTimersByTimeAsync(10);
  mocks.position = 56;
  mocks.audioNow = 16;
  vi.advanceTimersByTime(1000);
  expect(mocks.players).toHaveLength(1);
  vi.useRealTimers();
});

it("keeps the carry reset when panic and disarm runs inside a playing queued set", () => {
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a"];
  const { session } = armedSession(output(), { queued: true, playlistPlaying: true });
  session.panicAndDisarm();
  expect(mocks.library.rememberMidi).toHaveBeenLastCalledWith(null);
});

it("advances the playlist when a queued song ends, and skips by offset", async () => {
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  const { session } = armedSession(output(), { queued: true, playlistPlaying: true });
  session.state.player?.onEnded?.();
  expect(mocks.library.advancePlaylist).toHaveBeenCalled();
  expect(session.state.playing).toBe(false);
  session.skip(1);
  expect(mocks.library.skipPlaylist).toHaveBeenCalledWith(1);
});

it("waits out the start delay, cancels it with a second Play press, and starts with the count-in and pre-roll on the next press", async () => {
  vi.useFakeTimers();
  mocks.lead = undefined;
  const session = new PerformanceSession({ initial: inputs({ bpm: 120 }), carried: null, initialClock: false });
  const unload = session.loadSong(source, null);
  session.update({ timing: { countInBars: 1, beatsPerBar: 4, preRollBeats: 2, startDelay: 3 } });
  const cancelled = session.play();
  await vi.advanceTimersByTimeAsync(2000);
  expect(session.state.playing).toBe(false);
  session.cancelStart();
  await cancelled;
  expect(mocks.lead).toBeUndefined();
  expect(session.state.playing).toBe(false);
  const started = session.play();
  await vi.advanceTimersByTimeAsync(3000);
  await started;
  expect(mocks.lead).toEqual({ bpm: 120, countInBeats: 4, preRollBeats: 2 });
  expect(session.state.playing).toBe(true);
  session.pause();
  unload();
  vi.useRealTimers();
});

it("applies the saved outputs to a new player, again when they change, and shows a warning as a toast", () => {
  const session = new PerformanceSession({ initial: inputs(), carried: null, initialClock: false });
  const unload = session.loadSong(source, null);
  const player = mocks.players.at(-1);
  // Earlier tests leave their sessions bound, so only this player's calls count.
  const applied = () => mocks.outputs.filter((call) => call.player === player).map((call) => call.config);
  expect(applied()).toEqual([DEFAULT_OUTPUTS]);
  useOutputSettings.getState().update({ ...DEFAULT_OUTPUTS, deviceId: "usb-4", label: "Interface" });
  expect(applied()).toHaveLength(2);
  expect(applied()[1]).toMatchObject({ deviceId: "usb-4" });

  mocks.players.at(-1)!.onOutputWarning?.("The interface is not available.");
  expect(mocks.toasts).toEqual([expect.objectContaining({ tone: "fault", body: "The interface is not available." })]);

  unload();
  useOutputSettings.getState().update(DEFAULT_OUTPUTS);
  expect(applied()).toHaveLength(2);
});

describe("sections", () => {
  const verse = (mode: Section["mode"]): Section => ({ id: "verse", name: "Verse", start: 8, end: 16, mode });
  /** Plays the song from `position` with the sections. */
  function playing(sections: Section[], position = 0) {
    const armed = armedSession(output(), { sections });
    mocks.position = position;
    mocks.audioNow = position;
    armed.session.store.setState({ playing: true });
    return armed;
  }
  /** Moves the song and the audio clock to `position`, then runs one 50 ms section tick. */
  function at(position: number) {
    mocks.position = position;
    mocks.audioNow = position;
    vi.advanceTimersByTime(50);
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("decides a loop two seconds ahead, holds the schedule up to its boundary, and jumps the audio back", () => {
    const { session } = playing([verse("loop")]);
    at(13.5);
    expect(mocks.jumps).toHaveLength(0);
    at(14.1);
    expect(mocks.jumps).toEqual([{ to: 8, at: 16 }]);
    expect(mocks.plans.at(-1)).toMatchObject({ cap: 16, jump: { position: 8 } });
    // The jump is taken at the boundary. Nothing pauses: a loop keeps the song playing.
    at(16.1);
    expect(session.state.playing).toBe(true);
    expect(mocks.jumps).toHaveLength(1);
  });

  it("cancels an armed jump: the decision is undone and the hold is lifted", () => {
    const { session } = playing([verse("continue")]);
    session.tapSection("verse");
    expect(session.state.sectionLive.jump).toBe("verse");
    at(14.1);
    expect(mocks.plans.at(-1)).toMatchObject({ cap: 16 });
    session.cancelSectionJump();
    expect(session.state.sectionLive.jump).toBeNull();
    expect(mocks.plans.at(-1)).toEqual({ cap: null, jump: null });
  });

  it("refuses to cancel a jump that is too close, and the jump then stands", () => {
    const { session } = playing([verse("continue")]);
    session.tapSection("verse");
    at(14.1);
    mocks.cancelOk = false;
    session.cancelSectionJump();
    expect(mocks.plans.at(-1)).toMatchObject({ cap: 16 });
  });

  it("pauses at the boundary of a section whose mode is pause", () => {
    const { session } = playing([verse("pause")]);
    at(14.1);
    expect(session.state.playing).toBe(true);
    at(16.05);
    expect(session.state.playing).toBe(false);
  });

  it("stopped, a tap moves the playhead to the section start instead of arming a jump", () => {
    const { session } = armedSession(output(), { sections: [verse("continue")] });
    session.tapSection("verse");
    expect(mocks.position).toBe(8);
    expect(session.state.sectionLive.jump).toBeNull();
  });

  it("a second tap jumps now, after the MIDI lookahead, so the cues already queued still belong to the passage being left", () => {
    const { session } = playing([verse("continue")], 5);
    session.jumpSectionNow("verse");
    // USB lookahead is one second: the jump is at song 6, and the cap holds the schedule there.
    expect(mocks.jumps).toEqual([{ to: 8, at: 6 }]);
    expect(mocks.plans.at(-1)).toMatchObject({ cap: 6, jump: { position: 8 } });
  });

  it("starts a live loop, then releases it: the performer's release is kept for the rest of the pass", () => {
    const { session } = playing([verse("continue")], 10);
    session.toggleSectionLoop("verse");
    expect(session.state.sectionLive.loop).toBe("verse");
    session.releaseSectionLoop();
    expect(session.state.sectionLive.loop).toBeNull();
    expect(session.state.sectionLive.released).toEqual(["verse"]);
  });
});

describe("speed", () => {
  /** Lets the render promises settle, which the fake timers would not do. */
  async function flush() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("swaps a speed change in at the next beat while the song plays, and the MIDI plan carries the new rate", async () => {
    const { session } = armedSession();
    mocks.position = 2;
    mocks.audioNow = 2;
    session.store.setState({ playing: true });
    mocks.players.at(-1)!.isPlaying = true;
    session.setSpeed({ rate: 0.5 });
    await flush();
    // The render is ready, but the swap waits for the tick that carries it out
    expect(mocks.swaps).toHaveLength(0);
    vi.advanceTimersByTime(50);
    expect(mocks.swaps).toHaveLength(1);
    expect(mocks.plans.at(-1)).toMatchObject({ cap: 2.5, jump: { position: 2.5, rate: 0.5 } });
    expect(session.state.speed.rate).toBe(0.5);
    // When the swap takes effect the plan is cleared, and the song keeps playing
    mocks.audioNow = 2.6;
    mocks.position = 2.5;
    vi.advanceTimersByTime(50);
    expect(mocks.plans.at(-1)).toEqual({ cap: null, jump: null });
    expect(session.state.playing).toBe(true);
  });

  it("applies a speed change at once while the song is stopped", async () => {
    const { session } = armedSession();
    session.setSpeed({ semitones: 2 });
    await flush();
    expect(mocks.applied).toHaveLength(1);
    expect(mocks.swaps).toHaveLength(0);
    expect(session.state.speed.semitones).toBe(2);
  });

  it("sends the effective BPM as the start tempo and gives the scheduler the rate", async () => {
    mocks.rate = 0.5;
    const { session } = armedSession(output(), { tempoOnStart: true, bpm: 120 });
    await session.play();
    await vi.advanceTimersByTimeAsync(100);
    const config = mocks.configs.at(-1)!;
    expect(config.rate).toBe(0.5);
    // 120 BPM at 50% is 60 BPM: the tempo message carries 60
    expect(config.tempo).toEqual([
      [176, 73, 0],
      [176, 74, 60],
    ]);
    session.pause();
  });
});

describe("MIDI triggers", () => {
  const sent = (out: { send: { mock: { calls: unknown[][] } } }) => out.send.mock.calls.map(([bytes]) => bytes);
  const chartA = "{midi@load: pc 1 1}\n{midi@play: cc 1 80 127}\n{midi@stop: cc 1 81 127}\n{midi@end: pc 1 9}";
  const chartB = "{midi@load: pc 2 5}\n{midi@play: cc 2 80 127}\n{midi@stop: cc 2 81 127}\n{midi@end: pc 2 6}";
  const playTriggersOf = () => mocks.configs.filter((config) => config.playTriggers?.length).map((config) => config.playTriggers);

  it("sends load once on arm, and sends play with each start and stop on pause", async () => {
    const { session, out } = armedSession(output(), { cues: parseChart(chartA) });
    expect(sent(out)).toEqual([[192, 1]]);
    session.update({ cues: parseChart(chartA) });
    expect(sent(out)).toEqual([[192, 1]]);
    await session.play();
    expect(playTriggersOf()).toEqual([[[176, 80, 127]]]);
    session.pause();
    expect(sent(out)).toEqual([
      [192, 1],
      [176, 81, 127],
    ]);
    await session.play();
    expect(playTriggersOf()).toHaveLength(2);
  });

  it("sends load again when the session disarms and arms for the same song", () => {
    const { session, out } = armedSession(output(), { cues: parseChart(chartA) });
    session.setArmed(false);
    session.setArmed(true);
    expect(sent(out)).toEqual([[192, 1], [192, 1]]);
  });

  it("sends end and then stop when the song reaches its end, and not when nothing was playing", async () => {
    const { session, out } = armedSession(output(), { cues: parseChart(chartA) });
    session.state.player?.onEnded?.();
    expect(sent(out)).toEqual([[192, 1]]);
    await session.play();
    session.state.player?.onEnded?.();
    expect(sent(out)).toEqual([[192, 1], [192, 9], [176, 81, 127]]);
  });

  it("sends each trigger once across a gapless hand-over: A's end and stop, then B's load, and B's play with its start", async () => {
    vi.useFakeTimers();
    const incoming = new StemPlayer({} as Stems);
    const next = { id: "b", title: "B", source: { name: "b.wav", libraryId: "b", audio: source.audio }, stems: {}, settings: {}, player: incoming };
    mocks.library.playlistPlaying = true;
    mocks.library.queue = ["a", "b"];
    mocks.library.preparedNext = () => next as never;
    mocks.library.advanceToPrepared = vi.fn(() => true);
    const { session, out, access, unload } = armedSession(output(), { queued: true, playlistPlaying: true, cues: parseChart(chartA) });
    await vi.advanceTimersByTimeAsync(10);
    expect(session.state.playing).toBe(true);
    expect(sent(out)).toEqual([[192, 1]]);
    mocks.position = 56;
    mocks.audioNow = 16;
    vi.advanceTimersByTime(4000);
    expect(mocks.library.advanceToPrepared).toHaveBeenCalledWith("b");
    expect(sent(out)).toEqual([
      [192, 1],
      [192, 9],
      [176, 81, 127],
    ]);
    unload();
    session.dispose();
    const joined = joinedSession(out, access, { cues: parseChart(chartB) });
    expect(joined.session.state.player).toBe(incoming);
    expect(sent(out)).toEqual([
      [192, 1],
      [192, 9],
      [176, 81, 127],
      [193, 5],
    ]);
    expect(playTriggersOf().at(-1)).toEqual([[177, 80, 127]]);
    vi.useRealTimers();
  });
});

describe("remote actions", () => {
  /** A session on one input, with a view that records what the screen was asked to do. */
  function remoteSession(patch: Partial<SessionInputs> = {}) {
    const input = Object.assign(new EventTarget(), { id: "in", state: "connected" });
    const access = Object.assign(new EventTarget(), { outputs: new Map(), inputs: new Map([["in", input]]) }) as unknown as MIDIAccess;
    const session = new PerformanceSession({
      initial: inputs(patch),
      carried: { access, portId: "", inputId: "in", armed: false, output: undefined },
      initialClock: false,
    });
    session.loadSong(source, null);
    session.bind();
    const view = { scrollLyrics: vi.fn(), fontSize: vi.fn(), toggleStage: vi.fn(), muteGroup: vi.fn(), toggleClick: vi.fn(), tap: vi.fn() };
    session.setView(view);
    const message = (data: number[]) => Object.assign(new Event("midimessage"), { data: Uint8Array.from(data) });
    return { session, input, view, message };
  }
  const press = (key: string, target: EventTarget = window) => {
    const event = new KeyboardEvent("keydown", { key });
    target.dispatchEvent(event);
    return event;
  };
  const withBindings = (session: PerformanceSession, bindings: Binding[]) => session.update({ bindings });

  beforeEach(() => {
    stopLearn();
    useMidiConfiguration.getState().update({ bindings: defaultBindings() });
  });

  it("runs the tempo tap from the T key, and the key is ignored while typing in a field", () => {
    const { session, view } = remoteSession();
    session.keyDown(press("t"));
    expect(view.tap).toHaveBeenCalledTimes(1);
    const field = document.createElement("input");
    document.body.appendChild(field);
    const typed = press("t", field);
    expect(session.keyDown(typed)).toBe(false);
    expect(view.tap).toHaveBeenCalledTimes(1);
    field.remove();
    session.dispose();
  });

  it("a binding that does not apply says why, and changes nothing", () => {
    const { session } = remoteSession();
    const before = session.state.sectionLive;
    session.keyDown(press("PageDown"));
    expect(mocks.toasts.at(-1)).toEqual({ tone: "info", title: "This song has no sections." });
    expect(session.state.sectionLive).toBe(before);
    session.dispose();
  });

  it("refuses play from start in stage mode, and leaves play and pause working", () => {
    const { session } = remoteSession();
    withBindings(session, [{ action: "transport.playFromStart", source: "key", match: { key: "Home" } }]);
    session.locked = true;
    session.keyDown(press("Home"));
    expect(mocks.toasts.at(-1)).toEqual({ tone: "info", title: "Seeking is locked in stage mode." });
    session.dispose();
  });

  it("shows the first press of a double press, and runs the action on the second", () => {
    const { session, view } = remoteSession();
    withBindings(session, [{ action: "tempo.tap", source: "key", match: { key: "y" }, doublePress: true }]);
    session.keyDown(press("y"));
    expect(mocks.toasts.at(-1)).toMatchObject({ title: "Press again to Tap tempo" });
    expect(view.tap).not.toHaveBeenCalled();
    session.keyDown(press("y"));
    expect(view.tap).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it("learns a program change with its bank as one binding on the selected input", () => {
    const { session, message } = remoteSession();
    startLearn({ source: "midi", action: "song.select", index: 2 });
    const input = session.state.access?.inputs.get("in") as unknown as EventTarget;
    input.dispatchEvent(message([0xb2, 0, 1]));
    expect(useRemoteLearn.getState().seen).toContain("program change");
    expect(useRemoteLearn.getState().target).not.toBeNull();
    input.dispatchEvent(message([0xb2, 32, 3]));
    input.dispatchEvent(message([0xc2, 9]));
    const learned = useMidiConfiguration.getState().bindings.at(-1);
    expect(learned).toEqual({ action: "song.select", index: 2, source: "midi", match: { status: 0xc0, channel: 3, data1: 9, bank: 131 } });
    expect(useRemoteLearn.getState().target).toBeNull();
    expect(useRemoteLearn.getState().result).toBe("Bound Ch 3 · Program 9 · bank 131.");
    session.dispose();
  });

  it("names the binding a learned key already runs, and binds nothing", () => {
    const { session } = remoteSession();
    const before = useMidiConfiguration.getState().bindings.length;
    startLearn({ source: "key", action: "song.next" });
    session.keyDown(press("PageDown"));
    expect(useRemoteLearn.getState().result).toBe("Already bound to Key PageDown. Remove that binding first.");
    expect(useMidiConfiguration.getState().bindings).toHaveLength(before);
    session.dispose();
  });

  it("learns a key, and Escape cancels Learn", () => {
    const { session } = remoteSession();
    startLearn({ source: "key", action: "view.stage" });
    session.keyDown(press("F9"));
    expect(useRemoteLearn.getState().result).toBe("Bound Key F9.");
    startLearn({ source: "key", action: "view.stage" });
    session.keyDown(press("Escape"));
    expect(useRemoteLearn.getState().target).toBeNull();
    expect(useRemoteLearn.getState().result).toBe("Learn cancelled.");
    session.dispose();
  });

  it("runs Start and Stop from the input, and ignores our own Stop coming back in", async () => {
    const { session, input, message } = remoteSession();
    input.dispatchEvent(message([250]));
    await vi.waitFor(() => expect(session.state.playing).toBe(true));
    // Our own Stop, echoed by a THRU input, must not stop the song.
    session.sendPerformance([252]);
    input.dispatchEvent(message([252]));
    expect(session.state.playing).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    input.dispatchEvent(message([252]));
    expect(session.state.playing).toBe(false);
    session.dispose();
  });

  it("does nothing with a key while a MIDI message is being learned, and a pedal while a key is", () => {
    const { session, view, input, message } = remoteSession();
    startLearn({ source: "midi", action: "view.stage" });
    expect(session.keyDown(press("t"))).toBe(false);
    expect(view.tap).not.toHaveBeenCalled();
    stopLearn();
    startLearn({ source: "key", action: "view.stage" });
    input.dispatchEvent(message([0xb0, 80, 127]));
    expect(session.state.playing).toBe(false);
    expect(useRemoteLearn.getState().target).not.toBeNull();
    stopLearn();
    session.dispose();
  });

  it("steps the speed down with its key and says when it is at the limit", () => {
    const { session } = remoteSession();
    // The song is shared by the tests above, so its speed is set rather than assumed.
    session.setSpeed({ rate: 1 });
    withBindings(session, [{ action: "speed.down", source: "key", match: { key: "-" } }]);
    session.keyDown(press("-"));
    expect(session.state.speed.rate).toBeCloseTo(0.95);
    for (let i = 0; i < 20; i++) session.keyDown(press("-"));
    expect(session.state.speed.rate).toBe(0.5);
    expect(mocks.toasts.at(-1)).toEqual({ tone: "info", title: "Speed is at its minimum." });
    session.dispose();
  });
});
