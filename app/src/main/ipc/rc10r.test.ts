// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { registerRc10rIpc, isRc10rBusy } from "./rc10r";
import { testRc10rRecord } from "@shared/rc10r-test-data";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
  reserve: vi.fn(),
  inspect: vi.fn(),
  plan: vi.fn(),
  write: vi.fn(),
  cancel: vi.fn(),
  recover: vi.fn(),
  eject: vi.fn(),
  release: vi.fn(),
  abandon: vi.fn(),
  busy: false,
}));
vi.mock("electron", () => ({ app: { getPath: () => "/temporary-user-data" } }));
vi.mock("./handle", () => ({ handle: (channel: string, fn: never) => mocks.handlers.set(channel, fn), shellPaths: { allow: vi.fn() } }));
vi.mock("./rc10r-store", () => ({
  Rc10rStore: class {
    get busy() {
      return mocks.busy;
    }
    reserve = mocks.reserve;
    inspect = mocks.inspect;
    plan = mocks.plan;
    write = mocks.write;
    cancel = mocks.cancel;
    recover = mocks.recover;
    eject = mocks.eject;
    release = mocks.release;
    abandon = mocks.abandon;
  },
}));
const sender = Object.assign(new EventEmitter(), { id: 42 });
const event = { sender } as unknown as IpcMainInvokeEvent;
const id = "12345678-1234-1234-1234-123456789abc";
const call = (method: string, ...args: unknown[]) => mocks.handlers.get(`rc10r:${method}`)!(event, ...args);
beforeEach(() => {
  vi.clearAllMocks();
  sender.removeAllListeners();
  mocks.busy = false;
  vi.stubGlobal("process", { ...process, platform: "darwin" });
  registerRc10rIpc(() => ({ webContents: sender }) as unknown as BrowserWindow);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("restricts acquisition to the main window and supported platform", () => {
  expect(() => mocks.handlers.get("rc10r:reserve")!({ sender: { id: 43 } } as IpcMainInvokeEvent)).toThrow(/main window/);
  vi.stubGlobal("process", { ...process, platform: "win32" });
  expect(() => call("reserve")).toThrow(/macOS/);
  expect(mocks.reserve).not.toHaveBeenCalled();
});

it("binds all operations to the renderer owner and covers the whole lease with the quit guard", () => {
  call("reserve");
  call("reserve");
  sender.emit("render-process-gone");
  expect(mocks.abandon).toHaveBeenCalledExactlyOnceWith(42);
  call("inspect", id);
  expect(mocks.inspect).toHaveBeenCalledWith(id, 42);
  const record = testRc10rRecord();
  call("plan", id, record, 1, null);
  expect(mocks.plan).toHaveBeenCalledWith(id, 42, record, 1, null);
  expect(isRc10rBusy()).toBe(false);
  mocks.busy = true;
  expect(isRc10rBusy()).toBe(true);
});

it("rejects malformed tokens, payloads and recovery paths before reaching filesystem code", () => {
  for (const bad of [null, 1, "../../outside", "wrong"]) expect(() => call("inspect", bad)).toThrow(/Invalid/);
  for (const bad of [null, [], new Uint8Array(10), "record"]) expect(() => call("plan", id, bad, 1, null)).toThrow(/Invalid/);
  expect(() => call("plan", id, testRc10rRecord(), "1", null)).toThrow(/Invalid/);
  expect(() => call("recover", id, "../../outside")).toThrow(/Invalid/);
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(mocks.plan).not.toHaveBeenCalled();
  expect(mocks.recover).not.toHaveBeenCalled();
});
