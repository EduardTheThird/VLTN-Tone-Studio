// Analyses saved songs from the Library without opening them (spec 72). The dialog picks the steps and the songs, refuses to start while a
// song plays, shows the progress, and then the summary, with a line for each song whose tempo changed.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSong } from "@/song/store";
import { useSongLibrary } from "@/song/library";
import { isSongPlaying } from "@/song/performance/playing-state";
import { runLibraryAnalysis } from "@/song/analysis/library-batch";
import {
  BATCH_STEPS,
  defaultChoice,
  describeBatch,
  selectSongs,
  type BatchChoice,
  type BatchOutcome,
  type BatchProgress,
  type BatchSong,
  type LyricsWhich,
} from "@/song/analysis/batch";
import { loadLyricsChoice, type LyricsChoice } from "@/song/performance/lyrics-options";
import { LyricsBatchSettings } from "./LyricsBatchSettings";

const PLAYING_REFUSAL = "Stop playback before analysing songs. The analysis would run while the music plays.";

export interface AnalyseSongsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The saved songs the dialog analyses: the selection, or the whole library. */
  songs: readonly BatchSong[];
}

export function AnalyseSongsDialog({ open, onOpenChange, songs }: AnalyseSongsDialogProps) {
  const openId = useSong((s) => s.source?.libraryId ?? null);
  const [choice, setChoice] = useState<BatchChoice>(defaultChoice);
  const [onlyNeeded, setOnlyNeeded] = useState(true);
  const [replaceManual, setReplaceManual] = useState(false);
  const [lyricsChoice, setLyricsChoice] = useState<LyricsChoice>(loadLyricsChoice);
  const [which, setWhich] = useState<LyricsWhich>("empty");
  const [retime, setRetime] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [outcomes, setOutcomes] = useState<BatchOutcome[] | null>(null);
  const [stopped, setStopped] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cancel = useRef<AbortController | null>(null);

  // A new opening starts from a clean dialog, so an old summary is not shown for the new selection.
  useEffect(() => {
    if (!open) return;
    setOutcomes(null);
    setStopped(false);
    setProblem(null);
  }, [open]);

  const options = { onlyNeeded, replaceManual, choice, openSongId: openId, lyrics: { ...lyricsChoice, which, retime } };
  const { run } = selectSongs(songs, options);
  const changed = (outcomes ?? []).filter((o): o is Extract<BatchOutcome, { status: "analysed" }> => o.status === "analysed" && !!o.tempoChange);

  const start = async () => {
    if (isSongPlaying() || useSongLibrary.getState().playlistPlaying) {
      setProblem(PLAYING_REFUSAL);
      return;
    }
    const controller = new AbortController();
    cancel.current = controller;
    setProblem(null);
    setOutcomes(null);
    setStopped(false);
    setRunning(true);
    try {
      const result = await runLibraryAnalysis(songs, options, controller.signal, setProgress);
      setOutcomes(result);
      setStopped(controller.signal.aborted);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The analysis could not finish.");
    } finally {
      cancel.current = null;
      setRunning(false);
      setProgress(null);
    }
  };

  const openSong = (id: string) => {
    void useSongLibrary.getState().load(id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !running && onOpenChange(value)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Analyse saved songs</DialogTitle>
          <DialogDescription>
            {songs.length} song{songs.length === 1 ? "" : "s"} in the selection. {run.length} will be analysed. The open song is skipped. Each song is analysed
            without opening it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {BATCH_STEPS.map((step) => (
            <label key={step.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={choice[step.id]} disabled={running} onCheckedChange={(value) => setChoice({ ...choice, [step.id]: value === true })} />
              <span>{step.label}</span>
            </label>
          ))}
          {choice.lyrics && (
            <LyricsBatchSettings
              choice={lyricsChoice}
              onChoice={setLyricsChoice}
              which={which}
              onWhich={setWhich}
              retime={retime}
              onRetime={setRetime}
              disabled={running}
              songs={run.length}
            />
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={onlyNeeded} disabled={running} onCheckedChange={(value) => setOnlyNeeded(value === true)} />
            <span>Only songs that need it</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={replaceManual} disabled={running} onCheckedChange={(value) => setReplaceManual(value === true)} />
            <span>Replace tempos I set by hand</span>
          </label>
        </div>
        {running && progress && (
          <p role="status" className="text-sm">
            Analysing {progress.index + 1} of {progress.total}: {progress.title}
            {progress.step ? ` (${progress.step})` : ""}…
          </p>
        )}
        {problem && (
          <p role="status" className="text-sm text-red-400">
            {problem}
          </p>
        )}
        {outcomes && (
          <div className="space-y-2 text-sm">
            <p role="status">{describeBatch(outcomes)}</p>
            {stopped && <p>Stopped. The songs not reached were left as they were.</p>}
            {changed.map((o) => (
              <p key={o.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {o.title}: {o.tempoChange?.from} → {o.tempoChange?.to}
                </span>
                <Button variant="outline" size="sm" onClick={() => openSong(o.id)}>
                  Open
                </Button>
              </p>
            ))}
          </div>
        )}
        <DialogFooter>
          {running ? (
            <Button variant="outline" onClick={() => cancel.current?.abort("cancel")}>
              Stop
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
          <Button disabled={running || run.length === 0} onClick={() => void start()}>
            Analyse {run.length} song{run.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
