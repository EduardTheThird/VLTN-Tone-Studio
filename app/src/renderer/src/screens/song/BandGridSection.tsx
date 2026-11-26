import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { doubleTempo, halveTempo, nudgeGrid, setGridMeter, shiftDownbeat, type BeatGrid } from "@/song/band/beat-grid";
import { barStarts, moveBarLine } from "@/song/band/timing";
import type { ChordAtBeat } from "@/song/band/harmony";
import { BandGrid } from "./BandGrid";
import { BassNoteEditor, BassNoteList, type BassNotesContext } from "./BassNotes";

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
  /** The performer's bass notes (spec 87): the strip's beats pick one to edit, and the list shows them. Not shown when not given. */
  bassNotes?: Omit<BassNotesContext, "grid" | "harmony">;
  /** Which half to show: the timing controls and the tempo summary (Timing tab), or the chord strip with the bass notes (Notes tab). */
  view: "timing" | "notes";
}

/** The beat grid, in two views: the timing controls (find the beat, corrections, fixed tempo), or the chord strip and the bass notes. */
export function BandGridSection({
  grid,
  harmony,
  blocked,
  busy,
  work,
  onGrid,
  onFind,
  onCancel,
  onFixed,
  onSetTempo,
  myTempo,
  bassNotes,
  view,
}: BandGridSectionProps) {
  // The beat whose bass note is open in the editor. A beat is toggled off by picking it again.
  const [bar, setBar] = useState(2);
  const [editing, setEditing] = useState<number | null>(null);
  if (view === "notes") {
    return (
      <section aria-label="Bass notes" className="flex min-w-0 flex-col gap-3">
        {grid ? (
          <>
            <BandGrid
              grid={grid}
              harmony={harmony}
              overrides={bassNotes?.overrides}
              selected={editing}
              onSelect={bassNotes ? (beat) => setEditing(editing === beat ? null : beat) : undefined}
            />
            {bassNotes && editing !== null && editing < grid.beats.length && (
              <BassNoteEditor key={editing} beat={editing} context={{ ...bassNotes, grid, harmony }} onClose={() => setEditing(null)} />
            )}
            {bassNotes && <BassNoteList harmony={harmony} overrides={bassNotes.overrides} disabled={bassNotes.disabled} onChange={bassNotes.onChange} />}
          </>
        ) : (
          <p className="text-silkscreen-3">No chord strip yet. Find the beat on the Timing tab first.</p>
        )}
      </section>
    );
  }
  return (
    <section aria-label="Beat grid" className="flex min-w-0 flex-col gap-3">
      {grid && <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">Meter
          <select aria-label="Band meter" disabled={blocked} className="rounded border border-seam bg-background p-1"
            value={grid.meter ?? `${grid.beatsPerBar}/4`} onChange={(event) => onGrid(setGridMeter(grid, event.target.value as "2/4" | "3/4" | "4/4" | "6/8"))}>
            {![2, 3, 4].includes(grid.beatsPerBar) && <option value={`${grid.beatsPerBar}/4`} disabled>{grid.beatsPerBar}/4 (current)</option>}
            <option>2/4</option><option>3/4</option><option>4/4</option><option value="6/8">6/8 (two dotted-quarter pulses)</option>
          </select>
        </label>
        <label className="flex items-center gap-2">Bar to move
          <input type="number" className="w-16 rounded border border-seam bg-background p-1" min={2} max={barStarts(grid).length}
            disabled={blocked || barStarts(grid).length < 2} value={bar} onChange={(event) => setBar(Number(event.target.value))} />
        </label>
        <Button size="sm" variant="outline" disabled={blocked || moveBarLine(grid, bar - 1, -1) === grid} onClick={() => onGrid(moveBarLine(grid, bar - 1, -1))}>Bar line earlier</Button>
        <Button size="sm" variant="outline" disabled={blocked || moveBarLine(grid, bar - 1, 1) === grid} onClick={() => onGrid(moveBarLine(grid, bar - 1, 1))}>Bar line later</Button>
        <p className="w-full text-xs text-silkscreen-3">Move a bar line by one pulse. Beat times and the following bar line stay put.</p>
      </div>}
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
        </>
      ) : (
        <p className="text-silkscreen-3">No beat grid yet. Find the beat, or use the fixed BPM.</p>
      )}
    </section>
  );
}
