import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { doubleTempo, halveTempo, nudgeGrid, shiftDownbeat, type BeatGrid } from "@/song/band/beat-grid";
import type { ChordAtBeat } from "@/song/band/harmony";
import { BandGrid } from "./BandGrid";

export interface BandGridSectionProps {
  grid: BeatGrid | null;
  harmony: readonly ChordAtBeat[];
  /** True while the panel is busy or the song plays: the grid's actions are then disabled. */
  blocked: boolean;
  busy: boolean;
  /** What the panel is doing now, shown with a spinner, or null. */
  work: string | null;
  /** Replaces the grid, from a correction or a found beat. */
  onGrid(grid: BeatGrid | null): void;
  onFind(): void;
  onCancel(): void;
  /** Builds the grid from the metronome's fixed tempo. */
  onFixed(): void;
  /** Writes a steady grid's tempo to the metronome. */
  onSetTempo(): void;
  /** The tempo the performer set by hand, which the beat is found from when `use` is on. Not shown when not given. */
  myTempo?: { bpm: number; use: boolean; onUse(use: boolean): void };
}

/** The beat grid: find the beat, the corrections to it, the fixed tempo, and the strip that shows it. */
export function BandGridSection({ grid, harmony, blocked, busy, work, onGrid, onFind, onCancel, onFixed, onSetTempo, myTempo }: BandGridSectionProps) {
  return (
    <section aria-label="Beat grid" className="flex flex-col gap-3">
      <h3 className="font-semibold">Beat grid</h3>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={blocked} onClick={onFind}>
          Find the beat
        </Button>
        {myTempo && (
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={myTempo.use} disabled={blocked} onCheckedChange={(value) => myTempo.onUse(value === true)} />
            Use my tempo ({myTempo.bpm} BPM)
          </label>
        )}
        <Button size="sm" variant="outline" disabled={blocked || !grid} onClick={() => grid && onGrid(halveTempo(grid))}>
          Half tempo
        </Button>
        <Button size="sm" variant="outline" disabled={blocked || !grid} onClick={() => grid && onGrid(doubleTempo(grid))}>
          Double tempo
        </Button>
        <Button size="sm" variant="outline" disabled={blocked || !grid} onClick={() => grid && onGrid(shiftDownbeat(grid, -1))}>
          Downbeat ←
        </Button>
        <Button size="sm" variant="outline" disabled={blocked || !grid} onClick={() => grid && onGrid(shiftDownbeat(grid, 1))}>
          Downbeat →
        </Button>
        <Button size="sm" variant="outline" disabled={blocked || !grid} onClick={() => grid && onGrid(nudgeGrid(grid, -0.01))}>
          Nudge −10 ms
        </Button>
        <Button size="sm" variant="outline" disabled={blocked || !grid} onClick={() => grid && onGrid(nudgeGrid(grid, 0.01))}>
          Nudge +10 ms
        </Button>
        <Button size="sm" variant="outline" disabled={blocked} onClick={onFixed}>
          Use fixed BPM
        </Button>
        {busy && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {work && (
        <p role="status" className="flex items-center gap-2">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {work}
        </p>
      )}
      {grid ? (
        <>
          <p>
            {grid.bpm.toFixed(1)} BPM, {grid.steady ? "steady" : "drifting"}, {grid.beats.length} beats, {grid.beatsPerBar} per bar.
          </p>
          {grid.steady && (
            <div>
              <Button size="sm" variant="outline" disabled={blocked} onClick={onSetTempo}>
                Set metronome to this tempo
              </Button>
            </div>
          )}
          <BandGrid grid={grid} harmony={harmony} />
        </>
      ) : (
        <p className="text-silkscreen-3">No beat grid yet. Find the beat, or use the fixed BPM.</p>
      )}
    </section>
  );
}
