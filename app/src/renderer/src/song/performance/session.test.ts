import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StemPlayer } from "@/song/stems/player";
import type { Stems } from "@/song/types";
import { PerformanceSession, selectArmed, type SessionInputs } from "./session";
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
  players: [] as { onOutputWarning: ((message: string) => void) | null }[],
  lead: undefined as unknown,
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
vi.mock("@/song/library", () => ({ useSongLibrary: { getState: () => mocks.library } }));
vi.mock("@/song/performance/midi-scheduler-client", () => ({
  midiNow: () => performance.timeOrigin + performance.now(),
  prepareMidiScheduler: () => ({ worker: { terminate: vi.fn() }, ready: Promise.resolve(), cancel: vi.fn() }),
  startMidiScheduler: (_config: unknown, send: (typeof mocks.sends)[number], fault: (message: string) => void) => {
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
  const { session, out, unload } = armedSession(output(), { queued: true, playlistPlaying: true });
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
  // The library's change arrives: the outgoing song is let go, and the chained song is adopted without a new player.
  const outgoing = session.state.player!;
  unload();
  expect((outgoing as unknown as { disposed: boolean }).disposed).toBe(true);
  session.loadSong({ ...next.source }, null);
  expect(session.state.player).toBe(incoming);
  expect(session.state.playing).toBe(true);
  expect(mocks.players).toHaveLength(2);
  expect(out.send.mock.calls.some(([bytes]) => bytes?.[0] === 252)).toBe(false);
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
