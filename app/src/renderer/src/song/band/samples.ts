// Samples for the generated drum and bass parts (spec 50). The FLAC files and samples/map.json ship with the app; their licences are in
// NOTICE.md next to this file. Loading decodes every file once and keeps the result in memory. The pickers are pure, so the generators
// and their tests can use them without any audio.
//
// Handing the samples to the band worker (commit 5b): the decoded channels are Float32Arrays in the main thread. Posting them to the
// worker copies them, and transferring them detaches them from this cache. So the worker should own its own copy: it can fetch the
// URLs from `sampleFileUrls()` and decode them with `decodeTrack` itself, so the main thread never holds the audio that the worker plays.

import { decodeTrack } from "../codec/flac-client";
import type { PcmAudio } from "../types";
import sampleMapJson from "./samples/map.json";

/** A velocity range, inclusive at both ends. */
export type VelocityRange = [number, number];

export interface DrumLayer {
  velocity: VelocityRange;
  /** The velocity the sample was recorded at. Its gain is velocity / nominal. */
  nominal: number;
  /** Semitones to play the sample up or down. Only the GM 47 (mid tom) layers set it. */
  transpose: number;
  audio: PcmAudio;
}

export interface BassSample {
  /** The MIDI note the sample was recorded at. */
  root: number;
  layer: "p" | "f";
  velocity: VelocityRange;
  audio: PcmAudio;
}

export interface SampleSet {
  /** Drum layers by GM pitch, sorted by velocity. */
  drums: Map<number, DrumLayer[]>;
  bass: BassSample[];
}

/** What samples/map.json holds. File paths are relative to samples/. */
export interface SampleMap {
  sampleRate: number;
  drums: Record<string, { name: string; layers: { file: string; velocity: VelocityRange; nominal: number; transpose?: number }[] }>;
  bass: { file: string; root: number; layer: "p" | "f"; velocity: VelocityRange }[];
}

export interface DrumPick {
  audio: PcmAudio;
  gain: number;
  transpose: number;
}

export interface BassPick {
  audio: PcmAudio;
  playbackRate: number;
}

function fail(message: string): never {
  throw new Error(`Invalid sample map: ${message}`);
}

/** Checks the parsed map.json and returns it typed. Throws with the first problem it finds. */
export function readSampleMap(value: unknown): SampleMap {
  const map = value as Partial<SampleMap> | null;
  if (!map || typeof map !== "object") fail("not an object");
  if (!Number.isFinite(map.sampleRate) || (map.sampleRate ?? 0) <= 0) fail("sampleRate");
  if (!map.drums || typeof map.drums !== "object") fail("drums");
  if (!Array.isArray(map.bass)) fail("bass");
  const isRange = (r: unknown): r is VelocityRange => Array.isArray(r) && r.length === 2 && r.every(Number.isInteger);
  for (const [pitch, entry] of Object.entries(map.drums ?? {})) {
    if (!/^\d+$/.test(pitch) || !Array.isArray(entry.layers) || entry.layers.length === 0) fail(`drum ${pitch}`);
    for (const layer of entry.layers)
      if (typeof layer.file !== "string" || !isRange(layer.velocity) || !Number.isFinite(layer.nominal)) fail(`drum ${pitch} layer`);
  }
  for (const sample of map.bass ?? []) {
    if (typeof sample.file !== "string" || !Number.isInteger(sample.root) || (sample.layer !== "p" && sample.layer !== "f") || !isRange(sample.velocity)) {
      fail(`bass ${sample.file}`);
    }
  }
  return map as SampleMap;
}

/** The bundled map. Read once at import; a malformed file fails the first test run, not the first song. */
export const SAMPLE_MAP: SampleMap = readSampleMap(sampleMapJson);

const clampVelocity = (velocity: number): number => Math.min(127, Math.max(1, Math.round(velocity)));

/** The layer whose range holds the velocity, or the nearest one when no range does. */
function layerFor<T extends { velocity: VelocityRange }>(layers: readonly T[], velocity: number): T | undefined {
  let best: T | undefined;
  let bestDistance = Infinity;
  for (const layer of layers) {
    const [low, high] = layer.velocity;
    const distance = velocity < low ? low - velocity : velocity > high ? velocity - high : 0;
    if (distance < bestDistance) {
      best = layer;
      bestDistance = distance;
      if (distance === 0) break;
    }
  }
  return best;
}

/** The layer and gain for one drum hit. A GM pitch with no layers throws; the tests check every pitch the styles use has some. */
export function pickDrumSample(set: SampleSet, pitch: number, velocity: number): DrumPick {
  const layers = set.drums.get(pitch);
  const layer = layers && layerFor(layers, clampVelocity(velocity));
  if (!layer) throw new Error(`No drum sample for GM pitch ${pitch}.`);
  return { audio: layer.audio, gain: clampVelocity(velocity) / layer.nominal, transpose: layer.transpose };
}

/** The nearest root, its layer for the velocity, and the rate that moves the sample to the note (equal temperament). */
export function pickBassSample(set: SampleSet, midi: number, velocity: number): BassPick {
  let root: number | undefined;
  for (const sample of set.bass) {
    if (root === undefined || Math.abs(sample.root - midi) < Math.abs(root - midi)) root = sample.root;
  }
  if (root === undefined) throw new Error("No bass samples are loaded.");
  const sample = layerFor(
    set.bass.filter((s) => s.root === root),
    clampVelocity(velocity),
  );
  if (!sample) throw new Error(`No bass layer for root ${root}.`);
  return { audio: sample.audio, playbackRate: 2 ** ((midi - root) / 12) };
}

/**
 * Builds the set from the map and a decoded audio file for each path. Kept apart from the fetching so it runs in tests with stub audio.
 * Drum layers are sorted by velocity, and the transpose defaults to 0.
 */
export function sampleSetFrom(map: SampleMap, audioFor: (file: string) => PcmAudio): SampleSet {
  const drums = new Map<number, DrumLayer[]>();
  for (const [pitch, entry] of Object.entries(map.drums)) {
    const layers = entry.layers.map((layer) => ({
      velocity: layer.velocity,
      nominal: layer.nominal,
      transpose: layer.transpose ?? 0,
      audio: audioFor(layer.file),
    }));
    drums.set(
      Number(pitch),
      layers.sort((a, b) => a.velocity[0] - b.velocity[0]),
    );
  }
  const bass = map.bass.map((sample) => ({ root: sample.root, layer: sample.layer, velocity: sample.velocity, audio: audioFor(sample.file) }));
  return { drums, bass };
}

// Vite emits each FLAC as an asset and gives its URL (the same pattern as the Gp5 fixtures and the capture clips).
const SAMPLE_URLS = import.meta.glob("./samples/**/*.flac", { query: "?url", import: "default", eager: true }) as Record<string, string>;

/** The bundled URL of each sample, by its path in map.json (for example `drums/kick-soft.flac`). */
export function sampleFileUrls(): Map<string, string> {
  const urls = new Map<string, string>();
  for (const [path, url] of Object.entries(SAMPLE_URLS)) urls.set(path.replace("./samples/", ""), url);
  return urls;
}

/** Decodes the files a few at a time, so the codec does not start every worker at once. */
const DECODE_BATCH = 8;

async function decodeAll(files: string[], urls: Map<string, string>): Promise<Map<string, PcmAudio>> {
  const decoded = new Map<string, PcmAudio>();
  for (let i = 0; i < files.length; i += DECODE_BATCH) {
    const batch = files.slice(i, i + DECODE_BATCH);
    const audio = await Promise.all(
      batch.map(async (file) => {
        const url = urls.get(file);
        if (!url) throw new Error(`Sample ${file} is missing from the app.`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load sample ${file}.`);
        return decodeTrack(await response.arrayBuffer());
      }),
    );
    batch.forEach((file, index) => decoded.set(file, audio[index]));
  }
  return decoded;
}

let loaded: Promise<SampleSet> | undefined;

/** Loads and decodes every sample once, then returns the same set on every call. A failed load is retried on the next call. */
export function loadSampleSet(): Promise<SampleSet> {
  loaded ??= (async () => {
    const files = [...new Set([...Object.values(SAMPLE_MAP.drums).flatMap((e) => e.layers.map((l) => l.file)), ...SAMPLE_MAP.bass.map((s) => s.file)])];
    const decoded = await decodeAll(files, sampleFileUrls());
    return sampleSetFrom(SAMPLE_MAP, (file) => {
      const audio = decoded.get(file);
      if (!audio) throw new Error(`Sample ${file} was not decoded.`);
      return audio;
    });
  })().catch((error: unknown) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}
