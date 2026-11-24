import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { PerformanceSession, SessionState } from "@/song/performance/session";
import { BandLiveControls } from "./BandLiveControls";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function show(renderedBandAvailable: boolean) {
  const player = { liveBandAvailable: true, renderedBandAvailable } as SessionState["player"];
  const store = createStore<Partial<SessionState>>(() => ({ player, bandVariant: "normal", pendingBandVariant: null }));
  const changeBandVariant = vi.fn();
  const cancelBandVariant = vi.fn();
  const session = { store, changeBandVariant, cancelBandVariant } as unknown as PerformanceSession;
  return { ...render(<BandLiveControls session={session} />), store, changeBandVariant, cancelBandVariant };
}

it("offers Soft and Lift only for prepared audio, and always lets the performer take the band out", () => {
  const view = show(false);
  expect(view.getByRole("button", { name: "Soft" }).hasAttribute("disabled")).toBe(true);
  expect(view.getByRole("button", { name: "Lift" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Out" }));
  expect(view.changeBandVariant).toHaveBeenCalledWith("out");
  act(() => view.store.setState({ pendingBandVariant: { variant: "out", at: 4 } }));
  expect(view.getByRole("status").textContent).toBe("Band out at next bar");
  fireEvent.click(view.getByRole("button", { name: "Cancel band change" }));
  expect(view.cancelBandVariant).toHaveBeenCalledOnce();
});

it("uses a long press on Normal for drums only", () => {
  vi.useFakeTimers();
  const view = show(true);
  const normal = view.getByRole("button", { name: "Normal" });
  fireEvent.pointerDown(normal);
  act(() => vi.advanceTimersByTime(500));
  fireEvent.pointerUp(normal);
  fireEvent.click(normal, { detail: 1 });
  expect(view.changeBandVariant.mock.calls).toEqual([["drums"]]);
});
