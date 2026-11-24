import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createStore } from "zustand";
import { emptyPedalSettings } from "@shared/pedal-settings";
import { usePedalLibrary } from "@/song/performance/pedal-library";
import { type PerformanceSession, type SessionState } from "@/song/performance/session";
import { useSongLibrary } from "@/song/library";
import { emptyLibrary } from "@shared/song-library";
import { MyRig } from "./MyRig";

function fixture() {
  usePedalLibrary.setState({ ...emptyPedalSettings(), owned: ["strymon-timeline"] });
  useSongLibrary.setState({
    index: {
      ...emptyLibrary(),
      songs: [
        {
          id: "song",
          title: "Test",
          duration: 20,
          artist: "",
          sourceName: "test.wav",
          audio: [],
          updated: "",
          settings: { "": "[00:00] {midi:cc 1 0 0} {midi:pc 1 2}\n[00:02] {midi:cc 1 0 0} {midi:pc 1 4}" },
        },
      ],
    },
  });
  const output = { id: "ble", name: "Rig test", state: "connected" };
  const store = createStore<SessionState>(
    () =>
      ({
        portId: "bluetooth-midi",
        bluetooth: output,
        armedOutput: output,
        starting: false,
        playing: false,
        bpm: 120,
      }) as unknown as SessionState,
  );
  const sendPerformance = vi.fn();
  const session = {
    store,
    get state() {
      return store.getState();
    },
    sendPerformance,
  } as unknown as PerformanceSession;
  render(<MyRig session={session} />);
  return { sendPerformance, store };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  usePedalLibrary.setState(emptyPedalSettings());
  useSongLibrary.setState({ index: emptyLibrary() });
});

it("recalls two used presets with a two-second delay and only confirms success when answered", () => {
  vi.useFakeTimers();
  const { sendPerformance } = fixture();
  fireEvent.click(screen.getByRole("button", { name: "Recall a preset and back" }));
  expect(sendPerformance.mock.calls).toEqual([[[0xb0, 0, 0]], [[0xc0, 2]]]);
  act(() => vi.advanceTimersByTime(1999));
  expect(sendPerformance).toHaveBeenCalledTimes(2);
  act(() => vi.advanceTimersByTime(1));
  expect(sendPerformance.mock.calls.slice(-2)).toEqual([[[0xb0, 0, 0]], [[0xc0, 4]]]);
  expect(screen.queryByText(/last successful test/i)).toBeNull();
  fireEvent.click(within(screen.getByRole("group", { name: "Did it change?" })).getByRole("button", { name: "Yes" }));
  expect(screen.getByText(/last successful test confirmed/i)).toBeTruthy();
});

it("does not send the return recall after disarming the active output", () => {
  vi.useFakeTimers();
  const { sendPerformance, store } = fixture();
  fireEvent.click(screen.getByRole("button", { name: "Recall a preset and back" }));
  act(() => {
    store.setState({ armedOutput: null });
    vi.advanceTimersByTime(2000);
  });
  expect(sendPerformance).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/test interrupted/i)).toBeTruthy();
});

it("opens a printable setup sheet with the same pedal and cable instructions", () => {
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  fixture();
  fireEvent.click(screen.getByRole("button", { name: "Setup sheet" }));
  const sheet = screen.getByRole("dialog", { name: "Rig setup sheet" });
  expect(within(sheet).getByText("Strymon TimeLine")).toBeTruthy();
  expect(within(sheet).getByText("Presets in the library: 01A, 02A.")).toBeTruthy();
  fireEvent.click(within(sheet).getByRole("button", { name: "Print setup sheet" }));
  expect(print).toHaveBeenCalledOnce();
});

it("offers the pedal channel and routing checks after an unsuccessful test", () => {
  vi.useFakeTimers();
  fixture();
  fireEvent.click(screen.getByRole("button", { name: "Recall a preset and back" }));
  act(() => vi.advanceTimersByTime(2000));
  fireEvent.click(within(screen.getByRole("group", { name: "Did it change?" })).getByRole("button", { name: "No" }));
  expect(screen.getByText(/Check Strymon TimeLine.*MIDI receive channel 1.*FS jack MIDI OUT/)).toBeTruthy();
  expect(screen.queryByText(/last successful test/i)).toBeNull();
});
