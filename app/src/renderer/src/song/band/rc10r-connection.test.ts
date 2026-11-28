import { afterEach, describe, expect, it, vi } from "vitest";
import { Rc10rConnection, rc10rControl, rc10rState } from "./rc10r-connection";
import type { Rc10rApi } from "@shared/host/rc10r";

function fixture(options: { occupied?: boolean; extra?: boolean; noAck?: boolean; silentWrites?: boolean; ignoreWrites?: boolean } = {}) {
  const input = new EventTarget();
  const log: string[] = [];
  const open = vi.fn(async () => ({}));
  const wait = vi.fn(async (_ms: number) => {}),
    trace = vi.fn();
  const states = [Number(options.occupied ?? false), 0];
  Object.assign(input, { id: "in", name: "BOSS_RC-10R", state: "connected", open });
  const output = {
    id: "out",
    name: "BOSS_RC-10R",
    state: "connected",
    open,
    send: vi.fn((bytes: number[]) => {
      log.push(`midi:${bytes[7]}:${bytes[11]}:${bytes[12]}`);
      if (options.noAck) return;
      if (bytes[7] === 0x12) {
        if (!options.ignoreWrites) states[bytes[11]] = bytes[12];
        if (options.silentWrites) return;
      }
      const value = states[bytes[11]];
      const event = new Event("midimessage");
      Object.assign(event, { data: new Uint8Array(rc10rControl("write", bytes[11] as 0 | 1, value)) });
      input.dispatchEvent(event);
    }),
  };
  const api: Rc10rApi = {
    reserve: vi.fn(async () => "lease"),
    inspect: vi.fn(async () => ({ id: "lease", patterns: [], recoveries: [] })),
    plan: vi.fn(),
    write: vi.fn(async () => {
      log.push("write");
    }),
    cancel: vi.fn(async () => {}),
    recover: vi.fn(async () => {}),
    eject: vi.fn(async () => {
      log.push("eject");
    }),
    release: vi.fn(async () => {
      log.push("release");
    }),
    loops: vi.fn(async () => ({ loops: [] })),
    loopAudio: vi.fn(async () => new Uint8Array()),
    backups: vi.fn(async () => ({ count: 0, bytes: 0, removable: 0 })),
    pruneBackups: vi.fn(async () => ({ count: 0, bytes: 0, removable: 0 })),
  };
  const access = {
    sysexEnabled: true,
    inputs: new Map([["in", input]]),
    outputs: new Map([["out", output], ...(options.extra ? [["extra", output] as const] : [])]),
  };
  const release = vi.fn();
  const connection = new Rc10rConnection({
    api,
    access: async () => access as unknown as MIDIAccess,
    claim: () => release,
    wait,
    log: trace,
    timeoutMs: 50,
    pollMs: 10,
  });
  return { connection, output, input, api, log, release, wait, trace };
}
afterEach(() => vi.useRealTimers());
describe("RC-10R MIDI and storage ownership", () => {
  it("keeps connection and cleanup working if diagnostic logging fails", async () => {
    const f = fixture();
    f.trace.mockImplementation(() => {
      throw new Error("log unavailable");
    });
    await f.connection.open();
    await f.connection.close();
    expect(f.connection.active).toBe(false);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("polls editor-on, mount and editor-off state when writes have no unsolicited echo", async () => {
    vi.useFakeTimers();
    const f = fixture({ silentWrites: true });
    const opening = f.connection.open();
    await vi.advanceTimersByTimeAsync(30);
    await opening;
    expect(f.api.inspect).toHaveBeenCalledOnce();
    expect(f.output.send.mock.calls.map(([bytes]) => [bytes[7], bytes[11], bytes[12]])).toEqual([
      [0x11, 0, 0],
      [0x12, 0, 1],
      [0x11, 0, 0],
      [0x12, 1, 1],
      [0x11, 1, 0],
    ]);
    const closing = f.connection.close();
    await vi.advanceTimersByTimeAsync(20);
    await closing;
    expect(f.log.slice(-4)).toEqual(["eject", "midi:18:0:0", "midi:17:0:0", "release"]);
    const count = f.output.send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(f.output.send).toHaveBeenCalledTimes(count);
  });
  it("refuses a wrong polled state at the deadline and never reaches filesystem inspection", async () => {
    vi.useFakeTimers();
    const f = fixture({ silentWrites: true, ignoreWrites: true });
    const opening = f.connection.open().catch((error) => error);
    await vi.advanceTimersByTimeAsync(100);
    expect((await opening).message).toContain("write editor state 1");
    expect(f.api.inspect).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("matches captured connection frames and refuses corrupt or unrelated state replies", () => {
    expect(rc10rControl("read", 0)).toEqual([240, 65, 16, 0, 0, 0, 95, 17, 127, 112, 0, 0, 0, 0, 0, 1, 16, 247]);
    const bytes = new Uint8Array(rc10rControl("write", 0, 1));
    expect(rc10rState(bytes, 0)).toBe(1);
    bytes[13]++;
    expect(rc10rState(bytes, 0)).toBeNull();
    expect(rc10rState(new Uint8Array(rc10rControl("write", 1, 1)), 0)).toBeNull();
  });
  it("ejects and waits for editor-off before releasing the stage", async () => {
    const f = fixture();
    await f.connection.open();
    expect(f.connection.active).toBe(true);
    await f.connection.write();
    await f.connection.close();
    expect(f.log.slice(-3)).toEqual(["eject", "midi:18:0:0", "release"]);
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.connection.active).toBe(false);
    expect(f.wait.mock.calls).toEqual([[1000], [1000], [1000]]);
    expect(f.trace).toHaveBeenCalledWith("OUT f0 41 10 00 00 00 5f 12 7f 70 00 00 01 10 f7");
    expect(f.trace).toHaveBeenCalledWith("IN f0 41 10 00 00 00 5f 12 7f 70 00 00 01 10 f7");
  });
  it("never writes editor-off or ejects a session already owned by somebody else", async () => {
    const f = fixture({ occupied: true });
    await expect(f.connection.open()).rejects.toThrow(/Another editor/);
    expect(f.output.send).toHaveBeenCalledTimes(1);
    expect(f.api.eject).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("refuses ambiguous ports without sending MIDI", async () => {
    const f = fixture({ extra: true });
    await expect(f.connection.open()).rejects.toThrow(/exactly one/);
    expect(f.output.send).not.toHaveBeenCalled();
    expect(f.connection.active).toBe(false);
  });
  it("keeps ownership on failed eject and permits a safe disconnect retry", async () => {
    const f = fixture();
    await f.connection.open();
    vi.mocked(f.api.eject).mockRejectedValueOnce(new Error("busy"));
    await expect(f.connection.close()).rejects.toThrow(/busy/);
    expect(f.release).not.toHaveBeenCalled();
    expect(f.output.send.mock.calls).toHaveLength(3);
    await f.connection.close();
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("times out without treating a missing reply as success", async () => {
    vi.useFakeTimers();
    const f = fixture({ noAck: true });
    const result = f.connection.open().catch((error) => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBeInstanceOf(Error);
    expect(f.output.send).toHaveBeenCalledTimes(1);
    expect(f.api.inspect).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("cancels writes but still completes disconnect, and requires disconnected USB for manual release", async () => {
    const f = fixture();
    await f.connection.open();
    await f.connection.cancel();
    await expect(f.connection.write()).rejects.toThrow(/cancelled/);
    await expect(f.connection.releaseDisconnected()).rejects.toThrow(/Disconnect USB/);
    f.output.state = "disconnected";
    await f.connection.releaseDisconnected();
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.api.write).not.toHaveBeenCalled();
  });
});
