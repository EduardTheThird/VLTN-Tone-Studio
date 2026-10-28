import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PcmAudio } from "@/song/types";
import type { BeatGrid } from "@/song/band/beat-grid";
import { fixedBeatGrid } from "@/song/band/beat-grid";
import { parseSmf } from "@/song/performance/smf";
import type { Section } from "@/song/performance/sections";
import { useBandPanel } from "./band-panel-state";

const mocks = vi.hoisted(() => ({
  startBeatGrid: vi.fn(),
  startBandRender: vi.fn(),
  renderPreview: vi.fn(),
  startChordDetection: vi.fn(),
  saveFiles: vi.fn(async (_files: unknown, _title: string) => null as string | null),
  store: null as unknown as { getState(): unknown; setState(patch: unknown): void },
}));

vi.mock("@/host", () => ({ host: { song: { saveFiles: mocks.saveFiles } } }));

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
vi.mock("@/song/band/chord-detect-client", () => ({ startChordDetection: mocks.startChordDetection }));
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
  mocks.saveFiles.mockClear();
  mocks.startBandRender.mockReset();
  mocks.renderPreview.mockReset();
  // By default the detector finds nothing, so the bass rests unless a test gives it chords.
  mocks.startChordDetection.mockReset();
  mocks.startChordDetection.mockReturnValue({ done: Promise.resolve([]), cancel: vi.fn() });
});
afterEach(() => {
  cleanup();
  useBandPanel.getState().show(false);
});

describe("Band panel", () => {
  it("exports the last Generate's notes as a MIDI file named after the song, and only after Generate", async () => {
    stored({ beatGrid: grid, bandOutOfDate: true });
    const silent = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    const kick = { time: 0.5, pitch: 36, velocity: 100, duration: 0.1 };
    const bassNote = { time: 1, pitch: 40, velocity: 90, duration: 0.5 };
    mocks.startBandRender.mockReturnValue({
      done: Promise.resolve({ drums: silent, bass: silent, notes: { drums: [kick], bass: [bassNote] } }),
      onProgress: vi.fn(),
      cancel: vi.fn(),
    });
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    const exporting = screen.getByRole("button", { name: "Export MIDI…" }) as HTMLButtonElement;
    expect(exporting.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(exporting.disabled).toBe(false));
    fireEvent.click(exporting);
    await waitFor(() => expect(mocks.saveFiles).toHaveBeenCalledTimes(1));
    const [files, title] = mocks.saveFiles.mock.calls[0] as unknown as [{ name: string; bytes: Uint8Array }[], string];
    expect(files.map((file) => file.name)).toEqual(["Song - band.mid"]);
    expect(title).toBe("Export band MIDI");
    const messages = parseSmf(files[0].bytes).filter((message) => message.bytes.length === 3);
    expect(messages.map((message) => message.bytes)).toEqual([
      [0x99, 36, 100],
      [0x89, 36, 0],
      [0x90, 40, 90],
      [0x80, 40, 0],
    ]);
  });

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

  it("the humanise amount and feel save, and mark the parts out of date", () => {
    renderPanel();
    // The sliders come in order: complexity, swing, then humanise. The aria-label sits on the root, not the thumb.
    fireEvent.keyDown(screen.getAllByRole("slider")[2], { key: "ArrowRight" });
    expect(savedOptions().band.humanise.amount).toBeCloseTo(0.55, 5);
    expect(savedOptions().bandOutOfDate).toBe(true);
    pick(screen.getByRole("combobox", { name: "Humanise feel" }), "Pushed");
    expect(savedOptions().band.humanise).toEqual({ amount: expect.any(Number), feel: "pushed" });
    expect(savedOptions().band.humanise.amount).toBeCloseTo(0.55, 5);
    expect(useSong.getState().applyGeneratedParts).not.toHaveBeenCalled();
  });

  it("the follow switch saves the setting, and the source select lists only the stems that exist", () => {
    useSong.setState({ stems: { guitar: song().audio, drums: song().audio } as never });
    renderPanel();
    expect((screen.getByRole("switch", { name: "Follow my playing" }) as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Follow source" }), { key: "Enter" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Auto", "Guitar", "Mix"]);
    fireEvent.click(screen.getByRole("option", { name: "Mix" }));
    expect(savedOptions().band.followSource).toBe("mix");
    fireEvent.click(screen.getByRole("switch", { name: "Follow my playing" }));
    expect(savedOptions().band.followPlaying).toBe(false);
  });

  it("says after Generate whether the parts followed the playing, or why they did not", async () => {
    useSong.setState({ stems: { guitar: song().audio } as never });
    stored({ beatGrid: grid, bandOutOfDate: true });
    const silent = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    mocks.startBandRender.mockReturnValue({
      done: Promise.resolve({ drums: silent, bass: silent, notes: { drums: [], bass: [] }, follow: { source: "guitar", following: false } }),
      onProgress: vi.fn(),
      cancel: vi.fn(),
    });
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(screen.getByText("Follow my playing: not enough clear rhythm in the guitar")).toBeTruthy());
    expect(mocks.startBandRender.mock.calls[0][0].follow.source).toBe("guitar");
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
    await waitFor(() => expect(useSong.getState().applyGeneratedParts).toHaveBeenCalledWith({ drums, bass }, { playing: false, remove: [] }));
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

  it("edits the one row of a song without sections, and saves it under the whole-song key", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Whole song" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Fill at the end of Whole song" }));
    expect(savedOptions().band.sections.song.fill).toBe(false);
    pick(screen.getByRole("combobox", { name: "Energy of Whole song" }), "5");
    expect(savedOptions().band.sections.song.energy).toBe(5);
    pick(screen.getByRole("combobox", { name: "Style of Whole song" }), "Metal");
    expect(savedOptions().band.sections.song.style).toBe("metal");
    fireEvent.click(screen.getByRole("checkbox", { name: "Bass in Whole song" }));
    expect(savedOptions().band.sections.song.play).toEqual({ drums: true, bass: false });
  });

  it("detects chords from the audio when the chart and the analysis have none, and generates with them", async () => {
    stored({ beatGrid: grid });
    mocks.startChordDetection.mockReturnValue({ done: Promise.resolve([{ time: 0, name: "Am", confidence: 0.9 }]), cancel: vi.fn() });
    const drums = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    mocks.startBandRender.mockReturnValue({ done: Promise.resolve({ drums, notes: { drums: [], bass: [] } }), onProgress: vi.fn(), cancel: vi.fn() });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(mocks.startBandRender).toHaveBeenCalled());
    expect(mocks.startChordDetection).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 44100 }));
    expect(mocks.startBandRender.mock.calls[0][0].harmony[0].chord?.name).toBe("Am");
    expect(screen.queryByText(/No chords were found/)).toBeNull();
  });

  it("says the bass will rest when detection finds nothing either", async () => {
    stored({ beatGrid: grid });
    mocks.startBandRender.mockReturnValue({ done: Promise.resolve({ notes: { drums: [], bass: [] } }), onProgress: vi.fn(), cancel: vi.fn() });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText(/No chords were found in the chart or the audio/)).toBeTruthy();
    expect(mocks.startBandRender).toHaveBeenCalled();
  });

  it("does not detect chords when the bass is off", async () => {
    stored({ beatGrid: grid, band: { parts: { drums: true, bass: false } } });
    mocks.startBandRender.mockReturnValue({ done: Promise.resolve({ notes: { drums: [], bass: [] } }), onProgress: vi.fn(), cancel: vi.fn() });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(mocks.startBandRender).toHaveBeenCalled());
    expect(mocks.startChordDetection).not.toHaveBeenCalled();
  });

  it("cancels chord detection with the Cancel button, and changes no track", async () => {
    stored({ beatGrid: grid });
    let fail: (error: Error) => void = () => {};
    const cancel = vi.fn(() => {
      const error = new Error("Chord detection was cancelled.");
      error.name = "AbortError";
      fail(error);
    });
    mocks.startChordDetection.mockReturnValue({ done: new Promise<never>((_, reject) => (fail = reject)), cancel });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalled();
    expect(await screen.findByText("Generating the parts was cancelled. The tracks were not changed.")).toBeTruthy();
    expect(mocks.startBandRender).not.toHaveBeenCalled();
    expect(useSong.getState().applyGeneratedParts).not.toHaveBeenCalled();
  });

  it("passes a turned-off part to the store, so its generated track goes in the same update", async () => {
    stored({ beatGrid: grid, band: { parts: { drums: false, bass: true } } });
    const bass = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    mocks.startBandRender.mockReturnValue({ done: Promise.resolve({ bass, notes: { drums: [], bass: [] } }), onProgress: vi.fn(), cancel: vi.fn() });
    renderPanel({ chart: "[C]" });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(useSong.getState().applyGeneratedParts).toHaveBeenCalledWith({ drums: undefined, bass }, { playing: false, remove: ["drums"] }));
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

  it("with no song loaded, disables every action and says to open a song", () => {
    useSong.setState({ source: null });
    stored({ beatGrid: grid, band: { parts: { drums: true, bass: true } } });
    renderPanel();
    expect(screen.getByText("Open a song to generate parts.")).toBeTruthy();
    for (const name of [
      "Find the beat",
      "Use fixed BPM",
      "Half tempo",
      "Double tempo",
      "Downbeat ←",
      "Downbeat →",
      "Nudge −10 ms",
      "Nudge +10 ms",
      "Set metronome to this tempo",
      "Generate",
      "Try another",
      "Preview 4 bars",
    ]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled, name).toBe(true);
    }
    fireEvent.click(screen.getByRole("button", { name: "Find the beat" }));
    expect(mocks.startBeatGrid).not.toHaveBeenCalled();
    expect(useBandPanel.getState().open).toBe(true);
  });

  it("keeps the panel open and shows as a notice when the beat tracker cannot start", async () => {
    mocks.startBeatGrid.mockImplementation(() => {
      throw new Error("The beat tracker could not start.");
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Find the beat" }));
    expect(await screen.findByText("The beat tracker could not start.")).toBeTruthy();
    expect(screen.queryByText("Finding the beat…")).toBeNull();
    expect(useBandPanel.getState().open).toBe(true);
    expect((screen.getByRole("button", { name: "Find the beat" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the panel open and shows as a notice when a generation cannot start", async () => {
    mocks.startChordDetection.mockReturnValue({ done: Promise.resolve([]), cancel: vi.fn() });
    mocks.startBandRender.mockImplementation(() => {
      throw new Error("The samples could not load.");
    });
    stored({ beatGrid: grid });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText("The samples could not load.")).toBeTruthy();
    expect(screen.queryByText("Writing the notes…")).toBeNull();
    expect(useBandPanel.getState().open).toBe(true);
    expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(false);
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
