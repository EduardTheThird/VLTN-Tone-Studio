// The band pipeline (spec 50, commit 5b): generates the drum and bass notes of a song, then renders the parts the request asks for. Pure:
// the band worker calls these with the decoded samples, and the tests call them with stub samples. The same request, with the same seed,
// gives the same audio.

import type { BandSettings, SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { generateBass } from "./bass";
import { generateDrums } from "./drums";
import type { ChordAtBeat } from "./harmony";
import type { NoteEvent } from "./note";
import { RENDER_RATE, renderPart } from "./render";
import type { SampleSet } from "./samples";
import { barBeats, beatSpan } from "./timing";
import type { PcmAudio } from "../types";

/** Everything a job needs. It is plain data, so it can be sent to the worker as it is. */
export interface BandRequest {
  grid: BeatGrid;
  harmony: ChordAtBeat[];
  plans: SectionPlan[];
  settings: BandSettings;
  seed: number;
  /** The song's length in frames at RENDER_RATE. The parts are rendered to exactly this length. */
  lengthFrames: number;
  parts: { drums: boolean; bass: boolean };
  /** Where the worker fetches each sample file, by its path in map.json. */
  sampleUrls: Record<string, string>;
}

/** The steps a job reports, in order. */
export type BandStage = "loading" | "generating" | "rendering";

export interface BandResult {
  /** Present only for the parts the request asked for. */
  drums?: PcmAudio;
  bass?: PcmAudio;
  notes: { drums: NoteEvent[]; bass: NoteEvent[] };
}

/** A span of the song, in seconds. */
export interface PreviewWindow {
  start: number;
  end: number;
}

interface Notes {
  drums: NoteEvent[];
  bass: NoteEvent[];
}

/**
 * The notes of the parts the request asks for. Drums are always generated, even when only the bass is wanted, because the bass locks to
 * the kick. Drums that were not asked for are not returned.
 */
function generate(request: BandRequest): Notes {
  const drums = generateDrums(request.grid, request.plans, request.settings, request.seed);
  const bass = request.parts.bass ? generateBass(request.grid, request.harmony, request.plans, request.settings, drums, request.seed) : [];
  return { drums: request.parts.drums ? drums : [], bass };
}

function render(request: BandRequest, notes: Notes, samples: SampleSet, lengthFrames: number, onStage?: (stage: BandStage) => void): BandResult {
  onStage?.("rendering");
  const result: BandResult = { notes };
  if (request.parts.drums) result.drums = renderPart(notes.drums, "drums", samples, lengthFrames, RENDER_RATE).audio;
  if (request.parts.bass) result.bass = renderPart(notes.bass, "bass", samples, lengthFrames, RENDER_RATE).audio;
  return result;
}

/** Generates and renders the whole song's parts. `onStage` is told when each step starts. */
export function runBandJob(request: BandRequest, samples: SampleSet, onStage?: (stage: BandStage) => void): BandResult {
  onStage?.("generating");
  return render(request, generate(request), samples, request.lengthFrames, onStage);
}

/**
 * The span a preview covers: from `fromTime`, for `bars` bars of the grid. The end is the start of the bar after the last one, so a
 * preview that starts on a downbeat is exactly `bars` bars long. Past the last beat the grid's last beat interval is extended.
 */
export function previewWindow(grid: BeatGrid, fromTime: number, bars: number): PreviewWindow {
  const beats = grid.beats;
  if (beats.length === 0) return { start: fromTime, end: fromTime };
  let first = beats.findIndex((time) => time >= fromTime);
  if (first < 0) first = beats.length;
  const endBeat = first + bars * barBeats(grid);
  if (endBeat < beats.length) return { start: fromTime, end: beats[endBeat] };
  const last = beats.length - 1;
  return { start: fromTime, end: beats[last] + (endBeat - last) * beatSpan(beats, last) };
}

/**
 * Renders `bars` bars of the parts from `fromTime`, for listening before a song is saved. The notes are generated for the whole song, so
 * the preview matches what Generate would save. Only notes inside the window are rendered, moved so the window starts at 0.
 */
export function runBandPreview(request: BandRequest, samples: SampleSet, fromTime: number, bars = 4, onStage?: (stage: BandStage) => void): BandResult {
  onStage?.("generating");
  const notes = generate(request);
  const { start, end: windowEnd } = previewWindow(request.grid, fromTime, bars);
  const end = Math.min(windowEnd, request.lengthFrames / RENDER_RATE);
  const frames = Math.max(1, Math.round((end - start) * RENDER_RATE));
  const inWindow = (list: NoteEvent[]): NoteEvent[] =>
    list.filter((note) => note.time >= start && note.time < end).map((note) => ({ ...note, time: note.time - start }));
  return render(request, { drums: inWindow(notes.drums), bass: inWindow(notes.bass) }, samples, frames, onStage);
}

/** The buffers of a result, so the worker can transfer them to the window instead of copying them. */
export function transferables(result: BandResult): ArrayBuffer[] {
  return [result.drums, result.bass].flatMap((part) => (part ? part.channels.map((channel) => channel.buffer as ArrayBuffer) : []));
}
