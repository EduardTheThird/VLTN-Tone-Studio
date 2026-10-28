import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSong } from "@/song/store";
import { planSections, WHOLE_SONG_ID, type BandSettings, type FollowSource, type SectionPlan } from "@/song/band/arrangement";
import { startBeatGrid, type BeatGridJob } from "@/song/band/beat-grid-client";
import { fixedBeatGrid, type BeatGrid } from "@/song/band/beat-grid";
import { bandSampleUrls, renderPreview, startBandRender, type BandJob } from "@/song/band/band-client";
import { harmonyForSong, type ChordAtBeat } from "@/song/band/harmony";
import { bandRequest, beatSources, chartChordTimes, chordSource, followFor, followSourcesIn, previewMix } from "@/song/band/request";
import { followStatus } from "@/song/band/feel";
import { startChordDetection } from "@/song/band/chord-detect-client";
import { findStyle, STYLES, type StyleId } from "@/song/band/styles";
import type { BandStage } from "@/song/band/band-job";
import type { PcmAudio } from "@/song/types";
import { parseChart, type Cue } from "@/song/performance/chart";
import type { Chord } from "@/song/performance/chords";
import type { Section } from "@/song/performance/sections";
import { readStoredBand, writeStoredBand } from "@/song/band/stored";
import { hasGeneratedParts, presenceLine, type PartKind } from "./band-status";
import { useBandPanel } from "./band-panel-state";
import { BandSections, type BandSectionRow } from "./BandSections";
import { BandGridSection } from "./BandGridSection";
import { BandSettingsForm } from "./BandSettingsForm";

/** The Band panel's inputs from the Performance screen: the song's chart, chords, sections and metronome. */
export interface BandPanelProps {
  /** The song's performance key, where its band settings and grid are saved. */
  songKey: string;
  /** True while the song or a playlist plays. Every action is disabled then. */
  playing: boolean;
  chart: string;
  /** The detected chords, if the chord analysis has finished. */
  chords: Chord[];
  sections: Section[];
  /** The metronome's beats per bar, which is the bar length the beat is found with. */
  beats: number;
  bpm: number;
  firstBeat: number;
  /** Sets the metronome's tempo and first beat. Used by "Set metronome to this tempo". */
  onMetronome(bpm: number, firstBeat: number): void;
  /** The song position now, in seconds. The preview starts here when no section row is selected. */
  getPosition(): number;
}

const PREVIEW_BARS = 4;
const PLAYING_TEXT = "Stop playback to generate parts.";
const NO_SONG_TEXT = "Open a song to generate parts.";

/** Plays a mixed buffer once through a short-lived AudioContext. Returns a function that stops it early. */
function playOnce(audio: PcmAudio, onDone: () => void): () => void {
  const context = new AudioContext();
  const buffer = context.createBuffer(audio.channels.length, audio.channels[0].length, audio.sampleRate);
  audio.channels.forEach((channel, i) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, i));
  const node = context.createBufferSource();
  node.buffer = buffer;
  node.connect(context.destination);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    void context.close();
    onDone();
  };
  node.onended = finish;
  node.start();
  return () => {
    try {
      node.stop();
    } catch {
      // Already stopped.
    }
    finish();
  };
}

/** The Band button, by the mixer. It opens the panel. */
export function BandPanelButton() {
  const show = useBandPanel((s) => s.show);
  return (
    <Button variant="outline" size="sm" onClick={() => show(true)}>
      Band
    </Button>
  );
}

/** The Band panel: the song's beat grid, its band settings and sections, and the actions that generate, preview and remove the parts. */
export function BandPanel(props: BandPanelProps) {
  const open = useBandPanel((s) => s.open);
  const show = useBandPanel((s) => s.show);
  return (
    <Dialog open={open} onOpenChange={show}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Band</DialogTitle>
          <DialogDescription>
            Generate drum and bass parts that follow the song. Changing a setting does not regenerate anything until Generate.
          </DialogDescription>
        </DialogHeader>
        {open && <BandBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function BandBody({ songKey, playing, chart, chords, sections, beats, bpm, firstBeat, onMetronome, getPosition }: BandPanelProps) {
  const [stored] = useState(() => readStoredBand(songKey));
  const [settings, setSettings] = useState<BandSettings>(stored.settings);
  const [grid, setGrid] = useState<BeatGrid | null>(stored.grid);
  const [outOfDate, setOutOfDate] = useState(stored.outOfDate);
  const [notices, setNotices] = useState<string[]>([]);
  const [work, setWork] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const job = useRef<{ cancel(): void } | null>(null);
  const stopPreview = useRef<(() => void) | null>(null);
  const playingNow = useRef(playing);
  useEffect(() => {
    playingNow.current = playing;
  }, [playing]);
  useEffect(() => {
    useSong.getState().checkMissingParts();
    return () => {
      job.current?.cancel();
      stopPreview.current?.();
    };
  }, []);

  const source = useSong((s) => s.source);
  const stems = useSong((s) => s.stems);
  const tracks = useSong((s) => s.tracks);
  const missing = useSong((s) => s.missingParts);
  const cues = useMemo<Cue[]>(() => parseChart(chart), [chart]);
  const songEnd = source ? source.audio.channels[0].length / source.audio.sampleRate : 0;
  const plans = useMemo(() => planSections(sections, songEnd, settings), [sections, songEnd, settings]);
  const harmony = useMemo<ChordAtBeat[]>(() => (grid ? harmonyForSong(grid, cues, chords, songEnd) : []), [grid, cues, chords, songEnd]);
  const busy = work !== null;
  // With no song there is nothing to find a beat in or to render, so every action waits for one.
  const blocked = busy || playing || source === null;
  const generated = hasGeneratedParts(tracks);
  const style = findStyle(settings.style) ?? STYLES.rock;
  const followSources: FollowSource[] = ["auto", ...(followSourcesIn(stems) as FollowSource[])];

  const save = (next: BandSettings) => {
    setSettings(next);
    setOutOfDate(true);
    writeStoredBand(songKey, { band: next, bandOutOfDate: true });
  };
  const change = (patch: Partial<BandSettings>) => save({ ...settings, ...patch });
  const changeStyle = (id: StyleId) => {
    const next = findStyle(id);
    // A walking bass is only offered for a style that walks, so a walking choice falls back to roots when the style changes away from it.
    save({
      ...settings,
      style: id,
      swing: next?.swingDefault ?? settings.swing,
      bassMode: settings.bassMode === "walking" && !next?.bass.walking ? "roots" : settings.bassMode,
    });
  };
  /** Writes a row's override. A song without sections keeps its one row's overrides under WHOLE_SONG_ID. */
  const changeRow = (sectionId: string | null, patch: Partial<SectionPlan>) => {
    const key = sectionId ?? WHOLE_SONG_ID;
    const current = settings.sections[key] ?? {};
    save({ ...settings, sections: { ...settings.sections, [key]: { ...current, ...patch } } });
  };

  const applyGrid = (next: BeatGrid | null) => {
    setGrid(next);
    setOutOfDate(true);
    writeStoredBand(songKey, { beatGrid: next, bandOutOfDate: true });
  };

  /**
   * Runs one action that can fail or be cancelled. An error or a cancel becomes a notice in the panel, and the job and the busy line are
   * cleared, so an action cannot leave the panel busy, and nothing it does closes the dialog.
   */
  const attempt = async (cancelled: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      setNotices([aborted ? cancelled : error instanceof Error ? error.message : String(error)]);
    } finally {
      job.current = null;
      setWork(null);
    }
  };

  const rows: BandSectionRow[] = plans.map((plan) => ({
    plan,
    name: plan.sectionId === null ? "Whole song" : (sections.find((section) => section.id === plan.sectionId)?.name ?? "Section"),
  }));

  /** Finds the beat in the song's audio. The drums stem is read when present, else the pitched stems, else the mix. */
  const findBeat = async () => {
    const current = useSong.getState().source;
    if (!current) return setNotices(["Load a song before finding the beat."]);
    setNotices([]);
    setWork("Finding the beat…");
    await attempt("Finding the beat was cancelled.", async () => {
      const found: BeatGridJob = startBeatGrid({
        sources: beatSources(useSong.getState().stems, current.audio),
        sampleRate: current.audio.sampleRate,
        beatsPerBar: beats,
        chordChanges: chartChordTimes(cues),
      });
      job.current = found;
      const next = await found.done;
      if (next.beats.length === 0) setNotices(["No beat was found in this song. Use fixed BPM, or set the tempo by hand."]);
      else applyGrid(next);
    });
  };

  /**
   * Finds chords in the bass-free audio, when the chart and the chord analysis gave none. Null when the step was cancelled. The job is the
   * panel's current job, so Cancel stops it the same way it stops the render.
   */
  const detectChords = async (audio: PcmAudio): Promise<Chord[] | null> => {
    setWork("Detecting chords…");
    const detecting = startChordDetection(chordSource(useSong.getState().stems, audio));
    job.current = detecting;
    try {
      return await detecting.done;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return null;
      throw error;
    } finally {
      job.current = null;
    }
  };

  const generate = async (using: BandSettings) => {
    const current = useSong.getState().source;
    if (!current) return setNotices(["Load a song before generating parts."]);
    if (!grid) return setNotices(["Find the beat first, so the parts have a grid to follow."]);
    if (!using.parts.drums && !using.parts.bass) return setNotices(["Turn on drums or bass first."]);
    await attempt("Generating the parts was cancelled. The tracks were not changed.", async () => {
      const input = {
        grid,
        cues,
        chords,
        sections,
        settings: using,
        songEnd,
        lengthFrames: current.audio.channels[0].length,
        sampleUrls: bandSampleUrls(),
        follow: followFor(using, useSong.getState().stems, current.audio),
        mix: current.audio,
      };
      let request = bandRequest(input);
      const notes: string[] = [];
      if (using.parts.bass && !request.harmony.some((entry) => entry.chord)) {
        // Neither the chart nor the screen's analysis has chords, so the bass would rest all song. Detect them from the audio first.
        let found: Chord[] | null = [];
        try {
          found = await detectChords(current.audio);
        } catch (error) {
          notes.push(error instanceof Error ? error.message : String(error));
        }
        if (found === null) return setNotices(["Generating the parts was cancelled. The tracks were not changed."]);
        if (found.length) request = bandRequest({ ...input, chords: found });
        if (!request.harmony.some((entry) => entry.chord)) {
          notes.push("No chords were found in the chart or the audio, so the bass will rest. Add chords to the chart, then generate again.");
        }
      }
      setNotices(notes);
      setWork(stageText("loading"));
      const rendering: BandJob = startBandRender(request);
      job.current = rendering;
      rendering.onProgress((stage) => setWork(stageText(stage)));
      const result = await rendering.done;
      if (result.follow) notes.push(followStatus(result.follow));
      // A part that is turned off loses its generated track in the same update as the parts that are applied.
      const turnedOff = (["drums", "bass"] as const).filter((kind) => !using.parts[kind]);
      const applied = useSong.getState().applyGeneratedParts({ drums: result.drums, bass: result.bass }, { playing: playingNow.current, remove: turnedOff });
      setNotices([...notes, ...applied]);
      if (applied.length === 0) {
        setOutOfDate(false);
        writeStoredBand(songKey, { bandOutOfDate: false });
      }
    });
  };

  const tryAnother = () => {
    const next = { ...settings, seed: 1 + Math.floor(Math.random() * 0xfffffffe) };
    save(next);
    void generate(next);
  };

  const preview = async () => {
    const current = useSong.getState().source;
    if (!current) return setNotices(["Load a song before previewing."]);
    if (!grid) return setNotices(["Find the beat first, so the preview has a grid to follow."]);
    if (!settings.parts.drums && !settings.parts.bass) return setNotices(["Turn on drums or bass to preview them."]);
    const from = selected !== null ? rows[selected].plan.start : getPosition();
    setNotices([]);
    setWork("Rendering the preview…");
    await attempt("Rendering the preview was cancelled.", async () => {
      const request = bandRequest({
        grid,
        cues,
        chords,
        sections,
        settings,
        songEnd,
        lengthFrames: current.audio.channels[0].length,
        sampleUrls: bandSampleUrls(),
        follow: followFor(settings, useSong.getState().stems, current.audio),
        mix: current.audio,
      });
      const rendering: BandJob = renderPreview(request, from, PREVIEW_BARS);
      job.current = rendering;
      const result = await rendering.done;
      const mixed = previewMix(current.audio, from, result);
      setWork(null);
      stopPreview.current = playOnce(mixed, () => {
        stopPreview.current = null;
        setPreviewing(false);
      });
      setPreviewing(true);
    });
  };

  const removeParts = () => {
    setConfirmRemove(false);
    try {
      setNotices(useSong.getState().removeGeneratedParts({ playing: playingNow.current }));
    } catch (error) {
      setNotices([error instanceof Error ? error.message : String(error)]);
    }
  };

  const usesFixed = () => {
    const current = useSong.getState().source;
    if (!current) return setNotices(["Load a song before using a fixed tempo."]);
    setNotices([]);
    applyGrid(fixedBeatGrid(bpm, firstBeat, beats, songEnd));
  };

  const setTo = () => {
    if (!grid?.steady) return;
    const tempo = Math.round(grid.steady.bpm * 100) / 100;
    if (tempo < 30 || tempo > 300) return setNotices(["The tempo is outside the metronome's range of 30 to 300 BPM."]);
    onMetronome(tempo, Math.round(Math.max(0, grid.steady.firstBeat) * 1000) / 1000);
    setNotices(["The metronome now runs at this tempo."]);
  };

  const partLine = (kind: PartKind) => presenceLine(kind, missing?.[kind] ?? "unknown", missing?.absentSections[kind] ?? [], sections);

  return (
    <div className="flex flex-col gap-5 text-sm">
      <section aria-label="Band status" className="flex flex-col gap-1 rounded-lg border border-seam px-3 py-2">
        <p>{partLine("drums")}</p>
        <p>{partLine("bass")}</p>
        <p>{generated ? "Generated drum and bass tracks are in the mixer." : "No generated parts yet."}</p>
        {outOfDate && <p className="text-led-warn">Parts out of date. Press Generate to apply the changes.</p>}
      </section>

      <BandGridSection
        grid={grid}
        harmony={harmony}
        blocked={blocked}
        busy={busy}
        work={work}
        onGrid={applyGrid}
        onFind={() => void findBeat()}
        onCancel={() => job.current?.cancel()}
        onFixed={usesFixed}
        onSetTempo={setTo}
      />

      <BandSettingsForm settings={settings} style={style} followSources={followSources} onChange={change} onStyle={changeStyle} />

      <section aria-label="Sections" className="flex flex-col gap-2">
        <h3 className="font-semibold">Sections</h3>
        <BandSections rows={rows} disabled={blocked} selected={selected} onSelect={setSelected} onChange={changeRow} />
      </section>

      <section aria-label="Band actions" className="flex flex-col gap-2">
        {source === null && (
          <p role="note" className="text-led-warn">
            {NO_SONG_TEXT}
          </p>
        )}
        {playing && (
          <p role="note" className="text-led-warn">
            {PLAYING_TEXT}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={blocked || !grid} onClick={() => void generate(settings)}>
            Generate
          </Button>
          <Button variant="outline" disabled={blocked || !grid} onClick={tryAnother}>
            Try another
          </Button>
          <Button variant="outline" disabled={blocked || !generated} onClick={() => setConfirmRemove(true)}>
            Remove generated parts
          </Button>
          <Button variant="outline" disabled={blocked || !grid} onClick={() => (previewing ? stopPreview.current?.() : void preview())}>
            {previewing ? "Stop preview" : `Preview ${PREVIEW_BARS} bars`}
          </Button>
        </div>
        {notices.length > 0 && (
          <ul role="status" className="flex list-disc flex-col gap-1 pl-5 text-led-warn">
            {notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the generated parts?</AlertDialogTitle>
            <AlertDialogDescription>The generated drum and bass tracks are removed from the song. Your own tracks are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction onClick={removeParts}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function stageText(stage: BandStage): string {
  if (stage === "loading") return "Loading the drum and bass samples…";
  if (stage === "generating") return "Writing the notes…";
  return "Rendering the parts…";
}
