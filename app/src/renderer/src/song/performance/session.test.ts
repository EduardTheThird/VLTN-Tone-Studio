import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PerformanceSession, selectArmed, type SessionInputs } from "./session";
import { useMidiDiagnostics } from "./midi-diagnostics";

const mocks = vi.hoisted(() => ({
  position: 0,
  faults: [] as ((message: string) => void)[],
  library: { playlistPlaying: false, queue: [] as string[], position: 0, pausePlaylist: vi.fn(), rememberMidi: vi.fn() },
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
  startMidiScheduler: (_config: unknown, _send: unknown, fault: (message: string) => void) => {
    mocks.faults.push(fault);
    return { stop: vi.fn(), sync: vi.fn() };
  },
}));

const source = { name: "song.wav", audio: { sampleRate: 44100, channels: [new Float32Array(10)] } };
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
