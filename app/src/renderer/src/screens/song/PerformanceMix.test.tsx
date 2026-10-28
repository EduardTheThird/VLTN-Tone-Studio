import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore } from "zustand";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PerformanceMix } from "./PerformanceMix";
import type { PerformanceSession } from "@/song/performance/session";
import type { Mix } from "@/song/stems/mix";
import type { TrackInfo } from "@/song/tracks";

/** A session that only has what the mixer reads: the player's track names and the speed. */
function fakeSession(names: string[], rate = 1) {
  const store = createStore(() => ({ player: { names }, speed: { rate, semitones: 0, cents: 0, capo: 0, applyToChords: false, followsPitch: {} } }));
  return { store, setSpeed: vi.fn() } as unknown as PerformanceSession;
}

const tracks: Record<string, TrackInfo> = {
  track0: { kind: "user", name: "Click", bus: "click", transpose: false },
  track1: { kind: "user", name: "Keys", muteGroups: [1] },
  track2: { kind: "user", name: "Pads", muteGroups: [1] },
};
const mix: Mix = {
  track0: { volume: 1, mute: false, solo: false },
  track1: { volume: 1, mute: true, solo: false },
  track2: { volume: 1, mute: false, solo: false },
};

function renderMix(overrides: Partial<Parameters<typeof PerformanceMix>[0]> = {}) {
  const onMix = vi.fn<(update: (mix: Mix) => Mix) => void>();
  const onTrackInfo = vi.fn<(key: string, patch: Partial<Omit<TrackInfo, "kind">>) => void>();
  render(
    <PerformanceMix
      session={fakeSession(["track0", "track1", "track2"])}
      stems={{}}
      tracks={tracks}
      mix={mix}
      trackBuses={{}}
      onTrackBus={vi.fn()}
      {...overrides}
      onMix={onMix}
      onTrackInfo={onTrackInfo}
    />,
  );
  return { onMix, onTrackInfo };
}

afterEach(cleanup);

describe("performance mixer", () => {
  it("warns that a click track is stretched at a speed other than 100%", () => {
    renderMix({ session: fakeSession(["track0", "track1", "track2"], 0.8) });
    expect(screen.getByRole("status").textContent).toContain("Click is stretched to 80%");
  });

  it("says nothing about the click at 100%", () => {
    renderMix();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("unmuting a track in a mute group mutes the others in that group", () => {
    const { onMix } = renderMix();
    fireEvent.click(screen.getByLabelText("Keys enabled"));
    const update = onMix.mock.calls[0][0] as (m: Mix) => Mix;
    const next = update(mix);
    expect(next.track1.mute).toBe(false);
    expect(next.track2.mute).toBe(true);
    expect(next.track0.mute).toBe(false);
  });

  it("soloing a muted track in a mute group plays it alone, unmuting it", () => {
    const { onMix } = renderMix();
    fireEvent.click(screen.getByLabelText("Keys solo"));
    const next = (onMix.mock.calls[0][0] as (m: Mix) => Mix)(mix);
    expect(next.track1).toMatchObject({ mute: false, solo: true });
    expect(next.track2.mute).toBe(true);
    expect(next.track0.mute).toBe(false);
  });

  it("the group button plays its members and mutes the rest", () => {
    const { onMix } = renderMix();
    fireEvent.click(screen.getByRole("button", { name: "Group 1" }));
    const next = (onMix.mock.calls[0][0] as (m: Mix) => Mix)(mix);
    expect(next.track1.mute).toBe(false);
    expect(next.track2.mute).toBe(false);
    expect(next.track0.mute).toBe(true);
  });

  it("sets a track's pan from its slider", () => {
    const { onMix } = renderMix();
    fireEvent.change(screen.getByLabelText("Keys pan"), { target: { value: "-0.5" } });
    const next = (onMix.mock.calls[0][0] as (m: Mix) => Mix)(mix);
    expect(next.track1.pan).toBe(-0.5);
  });

  it("saves a track's mute group membership when it is toggled", () => {
    const { onTrackInfo } = renderMix();
    fireEvent.click(screen.getByLabelText("Click in group 2"));
    expect(onTrackInfo).toHaveBeenCalledWith("track0", { muteGroups: [2] });
  });
});
