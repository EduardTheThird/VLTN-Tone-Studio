import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { rc10rPorts, useRc10rDevice } from "./rc10r-device";

function fixture() {
  const inputs = new Map(),
    outputs = new Map();
  const access = Object.assign(new EventTarget(), { inputs, outputs });
  const send = vi.fn(),
    open = vi.fn();
  const port = { name: "BOSS_RC-10R", state: "connected", send, open };
  const request = vi.fn(async () => access as unknown as MIDIAccess);
  vi.stubGlobal("navigator", { requestMIDIAccess: request });
  return { inputs, outputs, access, port, send, open, request };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("detects and hot-plugs one RC-10R pairing without opening ports or sending MIDI", async () => {
  const f = fixture();
  const { result, unmount } = renderHook(() => useRc10rDevice(true));
  await waitFor(() => expect(result.current.message).toContain("Connect the RC-10R"));
  act(() => {
    f.inputs.set("in", f.port);
    f.outputs.set("out", f.port);
    f.access.dispatchEvent(new Event("statechange"));
  });
  expect(result.current.connected).toBe(true);
  act(() => {
    f.outputs.set("second", f.port);
    f.access.dispatchEvent(new Event("statechange"));
  });
  expect(result.current.connected).toBe(false);
  expect(result.current.message).toContain("More than one");
  act(() => {
    f.outputs.clear();
    f.access.dispatchEvent(new Event("statechange"));
  });
  expect(result.current.connected).toBe(false);
  unmount();
  expect(f.open).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
});

it("does not request permissions on unsupported hosts and explains denied access", async () => {
  const f = fixture();
  const view = renderHook(({ enabled }) => useRc10rDevice(enabled), { initialProps: { enabled: false } });
  expect(f.request).not.toHaveBeenCalled();
  f.request.mockRejectedValueOnce(new Error("denied"));
  view.rerender({ enabled: true });
  await waitFor(() => expect(view.result.current.message).toContain("Allow MIDI access"));
});

it("requires the exact device name and both connected directions", () => {
  const f = fixture();
  f.inputs.set("in", { ...f.port, name: "RC-10R" });
  f.inputs.set("other", { ...f.port, name: "IAC RC-10R" });
  f.outputs.set("out", { ...f.port, state: "disconnected" });
  const ports = rc10rPorts(f.access as unknown as MIDIAccess);
  expect(ports.inputs).toHaveLength(1);
  expect(ports.outputs).toHaveLength(0);
});
