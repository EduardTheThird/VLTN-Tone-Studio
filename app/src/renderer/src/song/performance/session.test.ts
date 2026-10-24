import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PerformanceSession, selectArmed, type SessionInputs } from "./session";
import { useMidiDiagnostics } from "./midi-diagnostics";

const mocks = vi.hoisted(() => ({
  position: 0,
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
    resumePlaylist: vi.fn(),
  },
}));
vi.mock("@/song/stems/player", () => ({
  StemPlayer: class {
    duration = 60;
    isPlaying = false;
    onEnded?: () => void;
    get position() {
      return mocks.position;
    }
    async play() {
      this.isPlaying = true;
    }
    pause() {
      this.isPlaying = false;
    }
    async seek(value: number) {
      mocks.position = value;
    }
    async dispose() {}
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
    return { stop: vi.fn(), sync: vi.fn() };
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
