import { host } from "@/host";
import { useStageActivity } from "@/state/stage-activity";
import { sessionLog } from "@/state/session-log";
import { flacName, trackKey, trackKindOf, type LibraryAudio, type LibrarySong } from "@shared/song-library";
import { loadSongAudio, acceptUpgradedSong } from "../library";
import { encodeTrack } from "../codec/flac-client";
import { freeTrackKeys } from "../import/import-tracks";
import { regenerateSong, regeneratedSettings } from "../band/regenerate";
import { bandSampleUrls } from "../band/band-client";
import { parseBeatGrid } from "../band/beat-grid";
import { followFor, keysFromOptions, levelStems } from "../band/request";
import { parseBandNotes, updatedBandNotes } from "../band/stored-notes";
import { EXTRAS_NAMES, EXTRAS_RECORD_KEY, packExtras } from "../band/extras";
import { automaticUpdateBlock } from "../band/tone-check";
import { startChordDetection } from "../band/chord-detect-client";
import { bassOf, harmonyOf } from "../analysis/analysis-audio";
import { parseAnalysis } from "../analysis/song-analysis";
import type { PcmAudio } from "../types";
import { parseChart } from "./chart";
import { parseSections } from "./sections";
import { flushSettings } from "./settings";
import { storedShape } from "./song-shape";
import type { MidiMacro } from "./midi-macros";
import { planSetUpgrade, relabelPresetCues, upgradeSongOptions, savedGeneratedKeys, type CueNaming, type SetUpgradeOptions } from "./set-upgrade";

export interface UpgradeRow {
  id: string;
  title: string;
  band: string;
  bass: string;
  cues: string;
  save: string;
}

const idle = () => {
  if (useStageActivity.getState().busy) throw new Error("Stop playback to update the set");
};
const recordOf = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {});

/** Prepares all changes in memory and publishes through the normal atomic library save. No settings writes occur before that save. */
export async function upgradeSavedSong(
  song: LibrarySong,
  options: SetUpgradeOptions,
  names: readonly CueNaming[],
  macros: readonly MidiMacro[],
): Promise<UpgradeRow> {
  idle();
  const plan = planSetUpgrade(song, options);
  const row: UpgradeRow = { id: song.id, title: song.title, band: plan.band, bass: plan.bass, cues: "Skipped: Not selected", save: "Skipped: No changes" };
  const original = upgradeSongOptions(song);
  let saved = { ...original };
  let chart = song.settings[""] ?? "";
  const audio = [...song.audio];
  const assets: { name: string; bytes: Uint8Array }[] = [];
  const replacements: Record<string, PcmAudio> = {};
  if (plan.render) {
    const blocked = await automaticUpdateBlock(plan.settings, host.tones);
    if (blocked) return { ...row, band: `Skipped: ${blocked}`, bass: `Skipped: ${blocked}`, cues: `Skipped: ${blocked}`, save: "Skipped: Song unchanged" };
    const grid = parseBeatGrid(saved.beatGrid);
    if (!grid) throw new Error("Find the beat first, so the parts have a grid to follow.");
    const { source, stems } = await loadSongAudio(song.id, true);
    idle();
    const analysis = parseAnalysis(saved.analysis);
    const using = { ...plan.settings, parts: { drums: plan.generated.includes("drums"), bass: plan.generated.includes("bass") } };
    const prepared = await regenerateSong(song.id, {
      input: {
        grid,
        settings: using,
        cues: parseChart(chart, macros),
        chords: analysis?.chords?.chords ?? [],
        sections: parseSections(saved.sections),
        songEnd: source.channels[0].length / source.sampleRate,
        trimEnd: storedShape(saved).trimEnd,
        lengthFrames: source.channels[0].length,
        sampleUrls: bandSampleUrls(),
        mix: source,
        follow: followFor(using, stems, source),
        originals: levelStems(stems),
        bassLine: analysis?.bassLine?.beats,
        hints: analysis?.sections,
        ...keysFromOptions(saved, song.key),
      },
      detectChords: () => startChordDetection({ harmony: harmonyOf(stems, source).audio, bass: bassOf(stems), beats: grid.beats }).done,
    });
    const generated = recordOf(saved.generatedParts);
    const manifests = recordOf(saved.bandExtras);
    const previous = savedGeneratedKeys(song);
    const putAudio = async (key: string, pcm: PcmAudio, name: string, transpose: boolean) => {
      const bytes = await encodeTrack(pcm, 16);
      const entry: LibraryAudio = {
        ...audio.find((entry) => trackKey(entry) === key),
        name,
        kind: "user",
        file: flacName(key),
        codec: "flac",
        sampleRate: pcm.sampleRate,
        frames: pcm.channels[0].length,
        channels: pcm.channels.length,
        bytes: bytes.length,
        sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), (v) =>
          v.toString(16).padStart(2, "0"),
        ).join(""),
        transpose,
      };
      const index = audio.findIndex((entry) => trackKey(entry) === key);
      if (index >= 0) audio[index] = entry;
      else audio.push(entry);
      assets.push({ name: entry.file!, bytes });
      replacements[key] = pcm;
    };
    for (const kind of plan.generated) {
      const pcm = prepared[kind];
      const key = previous[kind];
      if (!pcm || !key) throw new Error(`The generated ${kind} could not be prepared. Song unchanged.`);
      if (
        pcm.sampleRate !== source.sampleRate ||
        pcm.channels[0].length < source.channels[0].length ||
        pcm.channels.some((channel) => channel.length !== pcm.channels[0].length)
      )
        throw new Error(`The generated ${kind} part does not match the song's length, so it was not added.`);
      await putAudio(key, pcm, audio.find((entry) => trackKey(entry) === key)!.name, kind === "bass");
      const extraKey = EXTRAS_RECORD_KEY[kind];
      const oldExtra = generated[extraKey];
      const ownedExtra =
        typeof oldExtra === "string" &&
        audio.some((track) => trackKey(track) === oldExtra && trackKindOf(track) === "user" && track.name === EXTRAS_NAMES[kind])
          ? oldExtra
          : undefined;
      const packed = prepared.extras[kind] && packExtras(prepared.extras[kind]);
      if (packed) {
        const key = ownedExtra ?? freeTrackKeys(audio.map(trackKey), 1)[0];
        if (!key) throw new Error("No space for the band's count-in or loop exits. Song unchanged.");
        await putAudio(key, packed.audio, EXTRAS_NAMES[kind], false);
        generated[extraKey] = key;
        manifests[kind] = packed.manifest;
      } else {
        if (ownedExtra)
          audio.splice(
            audio.findIndex((track) => trackKey(track) === ownedExtra),
            1,
          );
        delete generated[extraKey];
        delete manifests[kind];
      }
    }
    saved = {
      ...saved,
      band: regeneratedSettings(plan.settings, using, prepared),
      bandNotes: updatedBandNotes(
        parseBandNotes(saved.bandNotes),
        prepared.result.notes,
        using.parts,
        plan.settings.parts,
        plan.settings.engine,
        plan.settings.seed,
      ),
      generatedParts: generated,
      bandExtras: manifests,
      bandOutOfDate: false,
      bandTempoChanged: false,
    };
    if (row.band === "To do") row.band = "Done";
    if (plan.warm) row.bass = "Done: Warm";
  }
  if (options.nameCues) {
    if (!names.length) row.cues = "Skipped: Connect the pedal to read its preset names";
    else {
      const result = relabelPresetCues(chart, names, macros);
      chart = result.chart;
      row.cues = `${result.renamed ? "Done" : "Skipped"}: ${result.renamed} named · ${result.unnamed} without a name`;
    }
  }
  if (plan.render || chart !== (song.settings[""] ?? "")) {
    idle();
    // A song edited while the render ran is never overwritten by the older snapshot.
    await flushSettings();
    const current = (await host.song.library!.index()).songs.find((entry) => entry.id === song.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(song)) throw new Error("The song changed during the update. Try again after saving it.");
    idle();
    const next: LibrarySong = {
      ...song,
      audio,
      settings: { ...song.settings, "": chart, ":options": plan.render ? JSON.stringify(saved) : (song.settings[":options"] ?? "") },
      updated: new Date().toISOString(),
    };
    await host.song.library!.save(next, assets);
    acceptUpgradedSong(next, replacements);
    row.save = "Done";
  }
  return row;
}

/** Runs sequentially. Cancel means finish this atomic song, then leave every later song untouched. Failures do not stop the next song. */
export async function runSetUpgrade(
  songs: readonly LibrarySong[],
  options: SetUpgradeOptions,
  context: {
    cancelled(): boolean;
    upgrade(song: LibrarySong, options: SetUpgradeOptions): Promise<UpgradeRow>;
    onRow(row: UpgradeRow, index: number): void;
  },
) {
  const rows: UpgradeRow[] = [];
  for (const song of songs) {
    if (context.cancelled()) break;
    let row: UpgradeRow;
    try {
      idle();
      row = await context.upgrade(song, options);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      row = {
        id: song.id,
        title: song.title,
        band: `Failed: ${reason}`,
        bass: `Failed: ${reason}`,
        cues: `Failed: ${reason}`,
        save: "Skipped: Song unchanged",
      };
    }
    rows.push(row);
    sessionLog("Set upgrade", `${song.title}: band ${row.band}; bass ${row.bass}; cues ${row.cues}; save ${row.save}`);
    context.onRow(row, rows.length - 1);
    if (useStageActivity.getState().busy) break;
  }
  return rows;
}
