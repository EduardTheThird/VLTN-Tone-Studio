import { host } from "@/host";
import { useStageActivity } from "@/state/stage-activity";
import type { BandSettings } from "./arrangement";
import { startBandRender, type BandJob } from "./band-client";
import { bandRequest, playsThreeFourDefault, THREE_FOUR_NOTE, extendedRangeNote, type BandInputs } from "./request";
import { applyPartTone } from "./part-tone";
import { renderPartChain } from "./bass-chain";
import { automaticUpdateBlock } from "./tone-check";
import { followStatus } from "./feel";
import { levelStatus } from "./level";
import { hasExtras, type ExitAudio } from "./extras";
import type { PcmAudio } from "../types";
import type { Chord } from "../performance/chords";
import { info, type BandNotice } from "@/screens/song/band-status";
import { stageText, BASS_TONE_TEXT, DRUM_TONE_TEXT } from "@/screens/song/band-panel-helpers";

export interface RegenerateOptions {
  input: BandInputs;
  detectChords(): Promise<Chord[] | null>;
  onWork?(text: string): void;
  onNotices?(notices: (string | BandNotice)[]): void;
  onJob?(job: BandJob): void;
  /** Explicit Generate retains its confirmed clean fallback and replacement behaviour. Automatic callers use the safe default. */
  explicit?: boolean;
}

/** Renders a song without mutating its settings or audio. The caller publishes the fully prepared result in one save. */
export async function regenerateSong(_songKey: string, options: RegenerateOptions) {
  if (useStageActivity.getState().busy) throw new Error("Stop playback to update the set");
  const input = options.input;
  const requested = input.settings;
  const using: BandSettings = options.explicit
    ? requested
    : {
        ...requested,
        parts: {
          drums: requested.parts.drums && !requested.rendered.drums,
          bass: requested.parts.bass && !requested.rendered.bass,
        },
      };
  if (!options.explicit) {
    const blocked = await automaticUpdateBlock(using, host.tones);
    if (blocked) throw new Error(blocked);
  }
  const tonePart = async (audio: PcmAudio, tone: BandSettings["bassTone"], part: "drums" | "bass") => {
    const toned = await applyPartTone(audio, tone, host.tones, renderPartChain, part);
    if (!options.explicit && toned.notice) throw new Error(toned.notice);
    return toned;
  };
  let request = bandRequest({ ...input, settings: using });
  const notes: (string | BandNotice)[] = [];
  if (playsThreeFourDefault(request)) notes.push(info(THREE_FOUR_NOTE));
  const lowKeyNote = using.parts.bass ? extendedRangeNote(request) : null;
  if (lowKeyNote) notes.push(info(lowKeyNote));
  if (using.parts.bass && !request.harmony.some((entry) => entry.chord)) {
    // Neither the chart nor the screen's analysis has chords, so the bass would rest all song. Detect them from the audio first.
    let found: Chord[] | null = [];
    try {
      found = await options.detectChords();
    } catch (error) {
      notes.push(error instanceof Error ? error.message : String(error));
    }
    if (found === null) {
      const error = new Error("Generating the parts was cancelled. The tracks were not changed.");
      error.name = "AbortError";
      throw error;
    }
    if (found.length) request = bandRequest({ ...input, settings: using, chords: found });
    if (!request.harmony.some((entry) => entry.chord)) {
      notes.push("No chords were found in the chart or the audio, so the bass will rest. Add chords to the chart, then generate again.");
    }
  }
  options.onNotices?.(notes);
  options.onWork?.(stageText("loading"));
  const rendering: BandJob = startBandRender(request);
  options.onJob?.(rendering);
  rendering.onProgress((stage) => options.onWork?.(stageText(stage)));
  const result = await rendering.done;
  // The bass tone is applied before the bass is saved, so the saved bass is the one Generate made. A tone that can't be used
  // leaves the clean bass and a notice.
  let bass = result.bass;
  let drums = result.drums;
  let countIn = result.countIn;
  const renderedTone: BandSettings["renderedTone"] = {};
  if (drums && using.drumTone.kind === "chain") {
    options.onWork?.(DRUM_TONE_TEXT);
    const toned = await tonePart(drums, using.drumTone, "drums");
    drums = toned.audio;
    renderedTone.drums = toned.tone;
    if (toned.notice) notes.push(toned.notice);
    // The drummer's count goes through the same kit tone, so it sounds like the drums it leads into.
    if (countIn && toned.tone === "chain") countIn = { ...countIn, audio: (await tonePart(countIn.audio, using.drumTone, "drums")).audio };
  }
  if (bass && using.bassTone.kind !== "clean") {
    options.onWork?.(BASS_TONE_TEXT);
    const toned = await tonePart(bass, using.bassTone, "bass");
    bass = toned.audio;
    renderedTone.bass = toned.tone;
    if (toned.notice) notes.push(toned.notice);
  }
  // A vamp's exit bar goes through the same tone as its part, so the swap on the last pass has no change of sound.
  const exits: Record<"drums" | "bass", Record<string, ExitAudio>> = { drums: {}, bass: {} };
  for (const [id, exit] of Object.entries(result.exits ?? {})) {
    for (const kind of ["drums", "bass"] as const) {
      let audio = exit[kind];
      if (!audio) continue;
      const tone = kind === "drums" ? using.drumTone : using.bassTone;
      if (tone.kind !== "clean" && renderedTone[kind] === "chain") audio = (await tonePart(audio, tone, kind)).audio;
      exits[kind][id] = { audio, from: exit.from, to: exit.to };
    }
  }
  if (result.follow) notes.push(info(followStatus(result.follow)));
  const levels = levelStatus(result.levels);
  if (levels) notes.push(info(levels));

  if (useStageActivity.getState().busy) throw new Error("Stop playback to update the set");
  const partExtras = { drums: { countIn, exits: exits.drums }, bass: { exits: exits.bass } };
  const extras = {
    ...(drums && hasExtras(partExtras.drums) ? { drums: partExtras.drums } : {}),
    ...(bass && hasExtras(partExtras.bass) ? { bass: partExtras.bass } : {}),
  };
  return { request, result, drums, bass, renderedTone, notes, extras };
}

/** Bookkeeping shared by Generate and a set upgrade. Rendered parts outside this render retain all their metadata. */
export function regeneratedSettings(
  latest: BandSettings,
  using: BandSettings,
  prepared: Awaited<ReturnType<typeof regenerateSong>>,
  turnedOff: readonly ("drums" | "bass")[] = [],
  applied = true,
): BandSettings {
  const firstNote = { ...latest.firstNote };
  const rendered = { ...latest.rendered };
  const renderedTone = { ...latest.renderedTone };
  for (const kind of ["drums", "bass"] as const) {
    if (using.parts[kind]) {
      renderedTone[kind] = prepared.renderedTone[kind] ?? "clean";
      const times = prepared.result.notes[kind].map((note) => note.time);
      if (times.length) firstNote[kind] = Math.min(...times);
      else delete firstNote[kind];
    }
    if (applied && (using.parts[kind] || turnedOff.includes(kind))) delete rendered[kind];
  }
  return { ...latest, firstNote, rendered, ...(applied ? { renderedTone } : {}) };
}
