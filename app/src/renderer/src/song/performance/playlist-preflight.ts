import type { LibraryPreflightSong } from "@shared/song-library";
import { STEM_NAMES } from "@shared/host/song";
import { parseChart } from "./chart";
import { midiPreflight, type PreflightOptions } from "./midi-preflight";
import { parseSections } from "./sections";
import { storedShape } from "./song-shape";
import { playRange } from "./transition";
import { clampSpeed, effectiveBpm } from "./speed";

/** The part of a song that plays, when its stored options trim it. Null for a song that plays whole. */
function trimRange(duration: number, options: object): { start: number; end: number } | undefined {
  const shape = storedShape(options as Record<string, unknown>);
  if (shape.trimStart === undefined && shape.trimEnd === undefined) return undefined;
  return playRange(duration, shape);
}
export interface PlaylistCheck {
  entry: number;
  id: string;
  title: string;
  errors: string[];
  warnings: string[];
  /** Information only, shown without the warning label */
  notes: string[];
}
export function playlistPreflight(
  ids: string[],
  songs: LibraryPreflightSong[],
  config: {
    tempoOnStart: boolean;
    tempoChannel: number;
    outputName?: string;
    pedals: PreflightOptions["pedals"];
    /** Whether a song's speed or pitch render was built in advance. Unset means the render is not checked. */
    renderReady?: (id: string) => boolean;
  },
): PlaylistCheck[] {
  const byId = new Map(songs.map((s) => [s.id, s]));
  return ids.map((id, entry) => {
    const saved = byId.get(id),
      song = saved?.song;
    const errors = [...(saved?.errors ?? ["Song was not checked."])],
      warnings: string[] = [],
      notes: string[] = [];
    if (song) {
      if (config.tempoOnStart && !config.outputName)
        warnings.push("Automatic tempo is enabled but no MIDI output preference is saved. Select and arm the intended output before performing.");
      let options: { clock?: boolean; sections?: unknown; beats?: unknown; firstBeat?: unknown } = {};
      try {
        const value = JSON.parse(song.settings[":options"] || "{}");
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        options = value;
      } catch {
        errors.push("Saved performance options are invalid.");
      }
      const raw = song.settings[":bpm"];
      const bpm = raw ? Number(raw) : 120;
      if (!raw) warnings.push("No saved BPM; playback defaults to 120. Confirm the recording tempo.");
      if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) errors.push("Saved BPM must be between 30 and 300.");
      // The pedal is sent the tempo the song plays at, so the tempo range applies to the BPM times the saved speed.
      const speed = clampSpeed(options as Record<string, unknown>);
      const played = effectiveBpm(bpm, speed.rate);
      if (Number.isFinite(played) && config.tempoOnStart && (played < 40 || played > 300))
        errors.push(`At ${Math.round(speed.rate * 100)}% this song plays at ${Math.round(played)} BPM; automatic pedal tempo requires 40–300 BPM.`);
      const changed = speed.rate !== 1 || speed.semitones !== 0 || speed.cents !== 0;
      // The first song renders as it loads and the second is the one the set prepares next, so a render that is not ready for either is
      // a warning. Later songs are prepared in turn and are only noted, so the warnings stay for what needs doing.
      if (changed && config.renderReady && !config.renderReady(id)) {
        const text = "Its speed or pitch is not rendered in advance yet. It plays at its own speed until the render is ready.";
        if (entry <= 1) warnings.push(text);
        else notes.push(text);
      }
      if (config.tempoOnStart && options.clock)
        warnings.push("Saved continuous clock is enabled alongside automatic tempo. Disable continuous clock for this setup.");
      const stems = STEM_NAMES.flatMap((name) => song.audio.filter((a) => a.name === name));
      const tracks = stems.length ? stems : song.audio;
      const duration = tracks[0].frames / tracks[0].sampleRate;
      if (Math.max(...tracks.map((a) => a.frames / a.sampleRate)) - Math.min(...tracks.map((a) => a.frames / a.sampleRate)) > 0.05)
        warnings.push("Playback tracks have different lengths; check the end of this song.");
      try {
        const report = midiPreflight(parseChart(song.settings[""] || ""), {
          duration,
          clock: options.clock === true,
          tempoChannel: config.tempoOnStart ? config.tempoChannel : undefined,
          outputName: config.outputName,
          pedals: config.pedals,
          sections: parseSections(options.sections),
          range: trimRange(duration, options),
          bpm,
          beats: typeof options.beats === "number" ? options.beats : 4,
          firstBeat: typeof options.firstBeat === "number" ? options.firstBeat : 0,
        });
        warnings.push(...report.issues.map((i) => i.text));
      } catch (error) {
        errors.push(`Chart cannot play: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { entry: entry + 1, id, title: song?.title ?? "Missing song", errors, warnings, notes };
  });
}
