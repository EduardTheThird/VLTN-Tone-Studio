import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mix } from "@/song/stems/mix";
import type { Stems, PcmAudio } from "@/song/types";
import type { TrackInfo } from "@/song/tracks";
import type { PartChoices } from "@/song/band/part-choice";
import { PerformanceMix } from "./PerformanceMix";

const mocks = vi.hoisted(() => ({ names: [] as string[], speed: { followsPitch: {}, rate: 1 } as Record<string, unknown> }));
vi.mock("@/song/performance/session", () => ({
  useSession: (_session: unknown, select: (state: unknown) => unknown) => select({ player: { names: mocks.names }, speed: mocks.speed }),
}));

const pcm = (): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(4)] });
const session = { setSpeed: vi.fn() } as never;
const mix: Mix = {};

/** A split song with drums and bass, and a generated drums and bass track each. */
const split = () => {
  mocks.names = ["drums", "bass", "track1", "track2"];
  const stems = { drums: pcm(), bass: pcm() } as Stems;
  const tracks: Record<string, TrackInfo> = {
    drums: { kind: "stem", name: "drums" },
    bass: { kind: "stem", name: "bass" },
    track1: { kind: "user", name: "Drums (generated)" },
    track2: { kind: "user", name: "Bass (generated)" },
  };
  return { stems, tracks };
};

function renderMix(partChoices: PartChoices) {
  const { stems, tracks } = split();
  return render(
    <PerformanceMix
      session={session}
      stems={stems}
      tracks={tracks}
      mix={mix}
      onMix={vi.fn()}
      trackBuses={{}}
      onTrackBus={vi.fn()}
      onTrackInfo={vi.fn()}
      partChoices={partChoices}
    />,
  );
}

/** The mixer row of a track, found from its enabled checkbox. */
const rowOf = (label: string) => screen.getByLabelText(`${label} enabled`).closest<HTMLElement>(".rounded-lg") as HTMLElement;

afterEach(cleanup);

describe("PerformanceMix: what plays", () => {
  it("marks the original drums as off when the generated drums play", () => {
    renderMix({ drums: "generated", bass: "original" });
    expect(within(rowOf("drums")).getByText("Off: generated plays")).toBeTruthy();
    expect(within(rowOf("Drums (generated)")).queryByText(/^Off:/)).toBeNull();
    expect(within(rowOf("bass")).queryByText(/^Off:/)).toBeNull();
  });

  it("marks the generated tracks as off when the originals play", () => {
    renderMix({ drums: "original", bass: "original" });
    expect(within(rowOf("Drums (generated)")).getByText("Off: original plays")).toBeTruthy();
    expect(within(rowOf("Bass (generated)")).getByText("Off: original plays")).toBeTruthy();
    expect(within(rowOf("drums")).queryByText(/^Off:/)).toBeNull();
  });

  it("marks nothing when both play", () => {
    renderMix({ drums: "both", bass: "both" });
    expect(screen.queryByText(/^Off:/)).toBeNull();
  });

  it("keeps each row's mute checkbox in its state, since the badge does not change the mute levels", () => {
    renderMix({ drums: "generated", bass: "original" });
    expect((screen.getByLabelText("drums enabled") as HTMLInputElement).checked).toBe(true);
  });
});
