import { beforeEach, expect, it, vi } from "vitest";
import { regenerateSong, regeneratedSettings } from "./regenerate";
import { DEFAULT_BAND_SETTINGS, type BandSettings } from "./arrangement";
import { fixedBeatGrid } from "./beat-grid";
import { bandRequest, type BandInputs } from "./request";
import { bandNotesOf } from "./stored-notes";
import { DRUM_PITCHES } from "./note";
import type { SampleSet } from "./samples";
import { runBandJob } from "./band-job";
import { resetStageActivity, useStageActivity } from "@/state/stage-activity";

const mock = vi.hoisted(() => ({ render: vi.fn(), read: vi.fn() }));
vi.mock("@/host", () => ({ host: { tones: { readLocalNam: mock.read } } }));
vi.mock("./band-client", () => ({ startBandRender: mock.render }));
vi.mock("./bass-chain", () => ({ renderPartChain: vi.fn() }));
const sample = { sampleRate: 44100, channels: [new Float32Array(4410).fill(0.1)] };
const samples: SampleSet = {
  drums: new Map(DRUM_PITCHES.map((pitch) => [pitch, [{ velocity: [1, 127], nominal: 100, transpose: 0, takes: [sample] }]])),
  bass: [36, 48, 60].map((root) => ({ root, layer: "p", velocity: [1, 127], audio: sample })),
};
const input = (settings: BandSettings = structuredClone(DEFAULT_BAND_SETTINGS)): BandInputs => ({
  grid: fixedBeatGrid(120, 0, 4, 8),
  cues: [],
  chords: [{ time: 0, name: "C", confidence: 1 }],
  sections: [],
  settings,
  songEnd: 8,
  lengthFrames: 8 * 44100,
  sampleUrls: {},
});
beforeEach(() => {
  resetStageActivity();
  mock.render.mockReset().mockImplementation((request) => ({
    done: Promise.resolve(runBandJob(request, samples)),
    onProgress: vi.fn(),
    cancel: vi.fn(),
  }));
});
it("uses the same request, notes and saved settings as Generate, retaining hand edits", async () => {
  const fixture = input();
  const before = structuredClone(fixture);
  const made = await regenerateSong("fixture", { input: fixture, detectChords: async () => [] });
  const expected = runBandJob(bandRequest(fixture), samples);
  expect(made.result.notes).toEqual(expected.notes);
  expect(bandNotesOf(made.result.notes, fixture.settings.engine, fixture.settings.seed)).toEqual(
    bandNotesOf(expected.notes, fixture.settings.engine, fixture.settings.seed),
  );
  const saved = regeneratedSettings(fixture.settings, fixture.settings, made);
  expect(saved.firstNote.bass).toBe(expected.notes.bass[0]?.time);
  expect(saved.bassOverrides).toEqual(fixture.settings.bassOverrides);
  expect(saved.marks).toEqual(fixture.settings.marks);
  expect(fixture).toEqual(before);
});
it("never renders the performer's own rendered part", async () => {
  const fixture = input();
  fixture.settings.rendered.drums = { name: "My drums.wav", importedAt: "2026-11-14" };
  const before = structuredClone(fixture.settings.rendered);
  const made = await regenerateSong("fixture", { input: fixture, detectChords: async () => [] });
  expect(mock.render.mock.calls[0][0].parts.drums).toBe(false);
  expect(made.drums).toBeUndefined();
  expect(regeneratedSettings(fixture.settings, made.request.settings, made).rendered).toEqual(before);
});
it("skips a missing tone with the automatic-update message and no mutations", async () => {
  const fixture = input();
  fixture.settings.bassTone = {
    kind: "chain",
    blocks: [{ type: "capture", role: "amp", on: true, inputDb: 0, outputDb: 0, mix: 1, file: { source: "file", name: "Lost", path: "/missing.nam" } }],
    fast: false,
    dryWet: 1,
  };
  mock.read.mockRejectedValueOnce(new Error("missing"));
  const before = structuredClone(fixture);
  await expect(regenerateSong("fixture", { input: fixture, detectChords: async () => [] })).rejects.toThrow(
    "Not updated: the bass tone's amp capture is missing. Download it or switch to Clean, then Generate.",
  );
  expect(mock.render).not.toHaveBeenCalled();
  expect(fixture).toEqual(before);
});
it("refuses while stage activity is busy", async () => {
  useStageActivity.setState({ busy: true });
  await expect(regenerateSong("fixture", { input: input(), detectChords: async () => [] })).rejects.toThrow("Stop playback");
  expect(mock.render).not.toHaveBeenCalled();
});

it("allows the transport's stopped preparation but keeps bulk updates blocked", async () => {
  const { setStageBusy } = await import("@/state/stage-activity");
  const owner = {};
  setStageBusy(true, owner);
  const preparation = { owner, stopped: () => true };
  await expect(regenerateSong("fixture", { input: input(), detectChords: async () => [], preparation: () => preparation })).resolves.toBeDefined();
  await expect(regenerateSong("fixture", { input: input(), detectChords: async () => [] })).rejects.toThrow("Stop playback");
});

it("does not publish a render when Pause revokes its pre-play permission", async () => {
  const { setStageBusy } = await import("@/state/stage-activity");
  const owner = {};
  setStageBusy(true, owner);
  let stopped = true;
  mock.render.mockImplementation((request) => {
    stopped = false;
    return { done: Promise.resolve(runBandJob(request, samples)), onProgress: vi.fn(), cancel: vi.fn() };
  });
  await expect(
    regenerateSong("fixture", { input: input(), detectChords: async () => [], preparation: () => ({ owner, stopped: () => stopped }) }),
  ).rejects.toThrow("Stop playback");
});
