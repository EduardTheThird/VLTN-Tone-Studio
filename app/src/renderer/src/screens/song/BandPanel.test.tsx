import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PcmAudio } from "@/song/types";
import type { BeatGrid } from "@/song/band/beat-grid";
import { fixedBeatGrid } from "@/song/band/beat-grid";
import type { Section } from "@/song/performance/sections";
import { useBandPanel } from "./band-panel-state";

const mocks = vi.hoisted(() => ({
  startBeatGrid: vi.fn(),
  startBandRender: vi.fn(),
  renderPreview: vi.fn(),
  store: null as unknown as { getState(): unknown; setState(patch: unknown): void },
}));

vi.mock("@/song/store", async () => {
  const { create } = await import("zustand");
  const useSong = create(() => ({
    source: null as null | { name: string; audio: PcmAudio },
    stems: null,
    tracks: {} as Record<string, unknown>,
    missingParts: null,
    checkMissingParts: vi.fn(),
    applyGeneratedParts: vi.fn(() => [] as string[]),
    removeGeneratedParts: vi.fn(() => [] as string[]),
  }));
  mocks.store = useSong as unknown as typeof mocks.store;
  return { useSong };
});
vi.mock("@/song/band/beat-grid-client", () => ({ startBeatGrid: mocks.startBeatGrid }));
vi.mock("@/song/band/band-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/song/band/band-client")>()),
  bandSampleUrls: () => ({}),
  startBandRender: mocks.startBandRender,
  renderPreview: mocks.renderPreview,
}));

// Imported after the mocks, so they see the mocked store.
const { useSong } = await import("@/song/store");
const { BandPanel } = await import("./BandPanel");

const KEY = "vltn.performance.v1:band-panel-test:8:44100";
const SECONDS = 8;
const SECTIONS: Section[] = [
  { id: "verse", name: "Verse", start: 0, end: 4, mode: "continue" },
  { id: "chorus", name: "Chorus", start: 4, end: 8, mode: "continue" },
];

/** A stored grid at 120 BPM over the eight seconds: sixteen beats, four to a bar. */
const grid: BeatGrid = fixedBeatGrid(120, 0, 4, SECONDS);

function song(): { name: string; audio: PcmAudio } {
  return { name: "Song.wav", audio: { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] } };
}

function stored(options: Record<string, unknown>) {
  localStorage.setItem(`${KEY}:options`, JSON.stringify(options));
}
function savedOptions(): Record<string, any> {
  return JSON.parse(localStorage.getItem(`${KEY}:options`) ?? "{}");
}

function renderPanel(overrides: Partial<Parameters<typeof BandPanel>[0]> = {}) {
  useBandPanel.getState().show(true);
  const props = {
    songKey: KEY,
    playing: false,
    chart: "",
    chords: [],
    sections: [] as Section[],
    beats: 4,
    bpm: 120,
    firstBeat: 0,
    onMetronome: vi.fn(),
    getPosition: () => 0,
    ...overrides,
  };
  return { ...render(<BandPanel {...props} />), props };
}

/** Picks an option of a shadcn select, opened from its trigger with the keyboard. */
function pick(trigger: HTMLElement, option: string) {
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: option }));
}

// jsdom has no layout: the Radix select and slider measure with these.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false) as unknown as typeof Element.prototype.hasPointerCapture;
  localStorage.clear();
  useSong.setState({
    source: song(),
    stems: null,
    tracks: {},
    missingParts: null,
    checkMissingParts: vi.fn(),
    applyGeneratedParts: vi.fn(() => []),
    removeGeneratedParts: vi.fn(() => []),
  });
  mocks.startBeatGrid.mockReset();
  mocks.startBandRender.mockReset();
  mocks.renderPreview.mockReset();
});
afterEach(() => {
  cleanup();
  useBandPanel.getState().show(false);
});

describe("Band panel", () => {
  it("renders with the defaults, and checks for missing parts when it opens", () => {
    renderPanel();
    expect(useSong.getState().checkMissingParts).toHaveBeenCalled();
    expect((screen.getByRole("switch", { name: "Generate drums" }) as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByRole("switch", { name: "Generate bass" }) as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Style" }).textContent).toContain("Rock");
    expect(screen.getByText("No generated parts yet.")).toBeTruthy();
    expect(screen.getByText("No beat grid yet. Find the beat, or use the fixed BPM.")).toBeTruthy();
    expect(screen.queryByText(/out of date/)).toBeNull();
    expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables every action while playing, and says to stop playback", () => {
    stored({ beatGrid: grid, band: undefined });
    renderPanel({ playing: true });
    expect(screen.getByText("Stop playback to generate parts.")).toBeTruthy();
    const actions = [
      "Find the beat",
      "Half tempo",
      "Double tempo",
      "Downbeat ←",
      "Downbeat →",
      "Nudge −10 ms",
      "Nudge +10 ms",
      "Use fixed BPM",
      "Generate",
      "Try another",
      "Remove generated parts",
      "Preview 4 bars",
    ];
    for (const name of actions) expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled, name).toBe(true);
    expect(mocks.startBeatGrid).not.toHaveBeenCalled();
  });

  it("changing the style or complexity saves at once and marks the parts out of date", () => {
    renderPanel();
    pick(screen.getByRole("combobox", { name: "Style" }), "Funk");
    expect(savedOptions().band.style).toBe("funk");
    expect(savedOptions().bandOutOfDate).toBe(true);
    expect(screen.getByText(/Parts out of date/)).toBeTruthy();
    // Funk's own swing default is saved with the style.
    expect(savedOptions().band.swing).toBe(0);

    const complexity = screen.getAllByRole("slider")[0];
    fireEvent.keyDown(complexity, { key: "ArrowRight" });
    expect(savedOptions().band.complexity).toBeCloseTo(0.55, 5);
    expect(useSong.getState().applyGeneratedParts).not.toHaveBeenCalled();
    expect(mocks.startBandRender).not.toHaveBeenCalled();
  });

  it("finds the beat through the beat tracker and shows the tempo", async () => {
    mocks.startBeatGrid.mockReturnValue({ done: Promise.resolve(grid), cancel: vi.fn() });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Find the beat" }));
    expect(mocks.startBeatGrid).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 44100, beatsPerBar: 4, chordChanges: [] }));
    expect(await screen.findByText(/120\.0 BPM, steady, 16 beats/)).toBeTruthy();
    expect(savedOptions().beatGrid.beats).toHaveLength(16);
  });

  it("applies the corrections to the stored grid", () => {
    stored({ beatGrid: grid });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Half tempo" }));
    expect(savedOptions().beatGrid.beats).toHaveLength(8);
    expect(savedOptions().beatGrid.bpm).toBeCloseTo(60, 5);
    // Doubling adds a midpoint between each pair of beats, so eight beats give fifteen.
    fireEvent.click(screen.getByRole("button", { name: "Double tempo" }));
    expect(savedOptions().beatGrid.beats).toHaveLength(15);
    fireEvent.click(screen.getByRole("button", { name: "Downbeat →" }));
    expect(savedOptions().beatGrid.downbeat).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Nudge +10 ms" }));
    expect(savedOptions().beatGrid.beats[0]).toBeCloseTo(0.01, 6);
    expect(savedOptions().bandOutOfDate).toBe(true);
  });

  it("sets the metronome only when asked, from a steady grid", () => {
    stored({ beatGrid: grid });
    const { props } = renderPanel();
    expect(props.onMetronome).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Set metronome to this tempo" }));
    expect(props.onMetronome).toHaveBeenCalledWith(120, 0);
  });

  it("generates the parts with the harmony and plans, applies them, and clears the out-of-date flag", async () => {
    stored({ beatGrid: grid, bandOutOfDate: true });
    const drums = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    const bass = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    mocks.startBandRender.mockReturnValue({
      done: Promise.resolve({ drums, bass, notes: { drums: [], bass: [] } }),
      onProgress: vi.fn(),
      cancel: vi.fn(),
    });
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    expect(screen.getByText(/Parts out of date/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(useSong.getState().applyGeneratedParts).toHaveBeenCalledWith({ drums, bass }, { playing: false }));
    const request = mocks.startBandRender.mock.calls[0][0];
    expect(request.grid.beats).toHaveLength(16);
    expect(request.harmony).toHaveLength(16);
    expect(request.plans.map((plan: { sectionId: string }) => plan.sectionId)).toEqual(["verse", "chorus"]);
    await waitFor(() => expect(savedOptions().bandOutOfDate).toBe(false));
    expect(screen.queryByText(/Parts out of date/)).toBeNull();
  });

  it("asks before removing the generated parts, and removes them only on confirm", async () => {
    useSong.setState({ tracks: { track1: { kind: "user", name: "Drums (generated)", bus: "main", transpose: false } } });
    stored({ beatGrid: grid });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Remove generated parts" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remove the generated parts?")).toBeTruthy();
    expect(useSong.getState().removeGeneratedParts).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(useSong.getState().removeGeneratedParts).toHaveBeenCalledWith({ playing: false });
  });

  it("writes the section overrides, and a row's drums and fill", () => {
    renderPanel({ sections: SECTIONS });
    expect(screen.getByRole("button", { name: "Verse" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Fill at the end of Verse" }));
    expect(savedOptions().band.sections.verse.fill).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Drums in Chorus" }));
    expect(savedOptions().band.sections.chorus.play).toEqual({ drums: false, bass: true });
    pick(screen.getByRole("combobox", { name: "Energy of Chorus" }), "5");
    expect(savedOptions().band.sections.chorus.energy).toBe(5);
  });

  it("shows one whole-song row when the song has no sections", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Whole song" })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Fill at the end of Whole song" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the notice a generation returns, and keeps the flag when the parts were refused", async () => {
    stored({ beatGrid: grid, bandOutOfDate: true });
    useSong.setState({ applyGeneratedParts: vi.fn(() => ["Stop playback to change the generated parts."]) });
    mocks.startBandRender.mockReturnValue({
      done: Promise.resolve({ drums: { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] }, notes: { drums: [], bass: [] } }),
      onProgress: vi.fn(),
      cancel: vi.fn(),
    });
    renderPanel({ chart: "[C]" });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText("Stop playback to change the generated parts.")).toBeTruthy();
    expect(screen.getByText(/Parts out of date/)).toBeTruthy();
  });

  it("says why nothing is generated when there is no grid, and when no part is on", () => {
    renderPanel();
    expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    stored({ beatGrid: grid, band: { parts: { drums: false, bass: false } } });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(screen.getByText("Turn on drums or bass first.")).toBeTruthy();
    expect(mocks.startBandRender).not.toHaveBeenCalled();
  });
});
