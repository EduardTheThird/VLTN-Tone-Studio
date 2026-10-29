// @vitest-environment node
// Local chord accuracy check (spec 81). It runs only when VLTN_CHORD_EVAL names a saved library folder, so it is skipped in every normal
// run, and nothing from a library is read otherwise. Run it from app/:
//
//   VLTN_CHORD_EVAL="/path/to/library" npx vitest run src/renderer/src/song/performance/chord-eval.test.ts
//
// The folder is the library's root (the one holding library.json). Songs whose chart has no timed chords, or whose audio cannot be read,
// are skipped. Audio and chart text are read from the folder and never copied anywhere. Each detector is scored on a 0.1 s grid against
// the chart's chords:
//   - root: the pitch class of the root matches (enharmonics count as equal);
//   - root+quality: the root and the quality class (major, minor, power, other) match;
//   - cover: the share of the chart's chord time where the detector names a chord (not N).
// N is left out of the root and root+quality accuracy on both sides, so a detector is not rewarded for saying nothing; cover shows the rest.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeFlac } from "@shared/flac";
import { parseChart } from "./chart";
import { chartChordEvents, LAST_CHORD_SECONDS, parseChordName, type ChordEvent, type ParsedChord } from "../band/harmony";
import { fft } from "../tonematch/fft";
import { detectChords, type Chord } from "./chords";
import { defaultChordSource } from "./sources";
import { bassOf, harmonyOf } from "../analysis/analysis-audio";
import { parseBeatGrid } from "../band/beat-grid";
import type { PcmAudio, StemName, Stems } from "../types";

const LIBRARY = process.env.VLTN_CHORD_EVAL ?? "";
const STEP_SECONDS = 0.1;
const STEM_NAMES: StemName[] = ["drums", "bass", "other", "vocals", "guitar", "piano"];

/**
 * A frozen copy of the spec-80 detector (`chords.ts` before spec 81), so the eval can show the change. Only this file uses it.
 */
function legacyDetectChords(audio: PcmAudio): Chord[] {
  const n = 8192,
    hop = Math.round(audio.sampleRate / 2);
  const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const result: Chord[] = [];
  for (let start = 0; start < audio.channels[0].length; start += hop) {
    const re = new Float64Array(n),
      im = new Float64Array(n),
      chroma = new Float64Array(12);
    let channel = audio.channels[0],
      loudest = -1;
    for (const candidate of audio.channels) {
      let energy = 0;
      for (let i = start; i < Math.min(candidate.length, start + n); i++) energy += candidate[i] ** 2;
      if (energy > loudest) {
        loudest = energy;
        channel = candidate;
      }
    }
    for (let i = 0; i < n; i++) {
      re[i] = channel[start + i] ?? 0;
      re[i] *= 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    }
    fft(re, im);
    for (let k = 1; k < n / 2; k++) {
      const hz = (k * audio.sampleRate) / n;
      if (hz < 65 || hz > 2000) continue;
      const midi = Math.round(69 + 12 * Math.log2(hz / 440));
      chroma[((midi % 12) + 12) % 12] += re[k] ** 2 + im[k] ** 2;
    }
    const total = chroma.reduce((a, b) => a + b, 0);
    let score = 0,
      name = "N";
    if (total > 0.01)
      for (let root = 0; root < 12; root++)
        for (const third of [4, 3]) {
          const value = (chroma[root] + chroma[(root + third) % 12] + chroma[(root + 7) % 12]) / total;
          if (value > score) {
            score = value;
            name = notes[root] + (third === 3 ? "m" : "");
          }
        }
    if (score < 0.55) name = "N";
    result.push({ time: start / audio.sampleRate, name, confidence: score });
  }
  return legacySmooth(result);
}

/** The spec-80 blip removal, copied with the baseline. */
function legacySmooth(frames: Chord[]): Chord[] {
  const stable = frames.map((frame, i) =>
    i > 0 && i + 1 < frames.length && frame.name !== "N" && frames[i - 1].name === frames[i + 1].name && frames[i - 1].name !== "N"
      ? { ...frame, name: frames[i - 1].name, confidence: Math.min(frames[i - 1].confidence, frames[i + 1].confidence) }
      : frame,
  );
  return stable.filter((frame, i) => i === 0 || frame.name !== stable[i - 1].name);
}

interface LibraryTrack {
  name: string;
  file?: string;
  codec?: string;
}
interface LibrarySongRecord {
  id: string;
  title: string;
  audio: LibraryTrack[];
  settings: Record<string, string>;
}
interface LibraryIndex {
  songs: LibrarySongRecord[];
  revisions: Record<string, string>;
}

/** One song as the eval sees it: the audio the app would analyse, its stems, its chord choice and saved beat grid, and the chart's chords. */
interface EvalSong {
  title: string;
  mix: PcmAudio;
  stems: Stems;
  chordChoice: StemName | "";
  beats: number[] | null;
  truth: ChordEvent[];
  duration: number;
}

/** The detectors the eval compares. The first is the frozen baseline; the last is the detector under test. */
const DETECTORS: { name: string; run: (song: EvalSong) => Chord[] }[] = [
  { name: "baseline (spec 80)", run: (song) => legacyDetectChords(chordAudio(song)) },
  // The current detector gets the inputs the app gives it: the harmony and bass of the analysis, and the song's saved beat grid.
  {
    name: "current",
    run: (song) => detectChords({ harmony: harmonyOf(song.stems, song.mix, song.chordChoice).audio, bass: bassOf(song.stems), beats: song.beats }),
  },
];

/** The audio the chord analysis reads when no chord stem is chosen: the first stem with a signal, else the mix. */
function chordAudio(song: EvalSong): PcmAudio {
  const name = defaultChordSource(song.stems);
  return name ? song.stems[name]! : song.mix;
}

async function readTrack(root: string, revision: string, track: LibraryTrack): Promise<PcmAudio | null> {
  if (track.codec !== "flac") return null;
  const bytes = new Uint8Array(await readFile(join(root, revision, track.file ?? `${track.name}.flac`)));
  return decodeFlac(bytes);
}

/** A song's saved options, or none when they are missing or damaged. */
function parseOptions(text: string | undefined): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Reads one saved song's audio and chart. Null for a song the eval cannot use: no timed chords, no revision, or no readable mix. */
async function loadSong(root: string, index: LibraryIndex, record: LibrarySongRecord): Promise<EvalSong | null> {
  const truth = chartChordEvents(parseChart(record.settings[""] ?? "")).sort((a, b) => a.time - b.time);
  const revision = index.revisions[record.id];
  if (!truth.length || !revision) return null;
  const options = parseOptions(record.settings[":options"]);
  const chordChoice = STEM_NAMES.includes(options.chordChoice as StemName) ? (options.chordChoice as StemName) : "";
  const beats = parseBeatGrid(options.beatGrid)?.beats ?? null;
  const stems: Stems = {};
  let mix: PcmAudio | null = null;
  for (const track of record.audio) {
    if (track.name === "source") mix = await readTrack(root, revision, track);
    else if (STEM_NAMES.includes(track.name as StemName)) stems[track.name as StemName] = (await readTrack(root, revision, track)) ?? undefined;
  }
  if (!mix) return null;
  return { title: record.title, mix, stems, chordChoice, beats, truth, duration: mix.channels[0].length / mix.sampleRate };
}

type Quality = "major" | "minor" | "power" | "other";

function qualityClass(parsed: ParsedChord): Quality {
  if (parsed.quality === "major" || parsed.quality === "minor" || parsed.quality === "power") return parsed.quality;
  return "other";
}

interface Score {
  /** Grid points where the chart and the detector both name a chord. */
  both: number;
  root: number;
  rootQuality: number;
  /** Grid points where the chart names a chord. */
  chart: number;
  /** Grid points where the detector names a chord, counted over `chart`. */
  named: number;
}

const zero = (): Score => ({ both: 0, root: 0, rootQuality: 0, chart: 0, named: 0 });

/** Scores one detector's chords against the chart's chords on a fixed time grid. */
export function scoreChords(truth: readonly ChordEvent[], detected: readonly Chord[], duration: number): Score {
  const score = zero();
  let ti = 0,
    di = 0;
  // The grid stops where the chart's last chord stops (see chartChordEvents), so a silent tail after it is not scored. It is indexed,
  // not summed, so each point lands on the same side of a chord change every run.
  const end = Math.min(duration, truth[truth.length - 1].time + LAST_CHORD_SECONDS);
  for (let i = 0; truth[0].time + i * STEP_SECONDS < end; i++) {
    const t = truth[0].time + i * STEP_SECONDS;
    while (ti + 1 < truth.length && truth[ti + 1].time <= t) ti++;
    while (di + 1 < detected.length && detected[di + 1].time <= t) di++;
    if (truth[ti].time > t) continue;
    const reference = parseChordName(truth[ti].name);
    if (!reference) continue;
    score.chart++;
    const guess = detected.length && detected[di].time <= t ? parseChordName(detected[di].name) : null;
    if (!guess) continue;
    score.named++;
    score.both++;
    if (guess.root === reference.root) {
      score.root++;
      if (qualityClass(guess) === qualityClass(reference)) score.rootQuality++;
    }
  }
  return score;
}

const pct = (part: number, whole: number) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : "n/a");
const cells = (s: Score) => `${pct(s.root, s.both).padStart(6)} ${pct(s.rootQuality, s.both).padStart(7)} ${pct(s.named, s.chart).padStart(6)}`;

/** A table with, per detector, root accuracy, root+quality accuracy and cover, one row per song and a time-weighted total. */
function report(rows: { title: string; scores: Score[] }[], names: string[]): string {
  const total = names.map((_, i) =>
    rows.reduce((acc, row) => {
      const s = row.scores[i];
      return { both: acc.both + s.both, root: acc.root + s.root, rootQuality: acc.rootQuality + s.rootQuality, chart: acc.chart + s.chart, named: acc.named + s.named };
    }, zero()),
  );
  const head = `${"Song".padEnd(36)} | ${names.map((n) => n.slice(0, 21).padEnd(21)).join(" | ")}`;
  const sub = `${"".padEnd(36)} | ${names.map(() => "  root  r+qual  cover").join(" | ")}`;
  const rule = "-".repeat(36) + "-+-" + names.map(() => "-".repeat(21)).join("-+-");
  const body = rows.map((row) => `${row.title.slice(0, 36).padEnd(36)} | ${row.scores.map(cells).join(" | ")}`);
  return [head, sub, rule, ...body, rule, `${"All songs (time-weighted)".padEnd(36)} | ${total.map(cells).join(" | ")}`].join("\n");
}

describe.skipIf(!LIBRARY)("chord accuracy on a local library (spec 81)", () => {
  it(
    "compares the detectors with the chart chords",
    async () => {
      const index = JSON.parse(await readFile(join(LIBRARY, "library.json"), "utf8")) as LibraryIndex;
      const rows: { title: string; scores: Score[] }[] = [];
      let skipped = 0;
      for (const record of index.songs) {
        const song = await loadSong(LIBRARY, index, record);
        if (!song) {
          skipped++;
          continue;
        }
        const scores = DETECTORS.map((detector) => scoreChords(song.truth, detector.run(song), song.duration));
        if (scores.every((s) => s.chart === 0)) continue;
        rows.push({ title: song.title, scores });
      }
      console.log(`\nSkipped (no timed chords, no readable mix): ${skipped} of ${index.songs.length}\n`);
      console.log(report(rows, DETECTORS.map((d) => d.name)));
    },
    60 * 60 * 1000,
  );
});

describe("scoreChords", () => {
  it("counts root and quality agreement, and leaves N out of the accuracy", () => {
    const truth = [
      { time: 0, name: "C" },
      { time: 2, name: "N" },
      { time: 4, name: "Am" },
    ];
    const detected = [
      { time: 0, name: "C", confidence: 1 },
      { time: 2, name: "G", confidence: 1 },
      { time: 4, name: "A5", confidence: 1 },
    ];
    // 0 to 2 s: C against C, all right. 2 to 4 s is N in the chart, so skipped. 4 to 6 s: A5 against Am is the root but not the quality.
    const score = scoreChords(truth, detected, 6);
    expect(score.both).toBe(20 + 20);
    expect(score.root).toBe(20 + 20);
    expect(score.rootQuality).toBe(20);
    expect(score.chart).toBe(40 + 0);
  });
});
