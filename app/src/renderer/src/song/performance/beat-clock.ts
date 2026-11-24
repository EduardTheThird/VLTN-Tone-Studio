/** The MIDI clock sends 24 pulses for each quarter note. */
export const CLOCK_PPQN = 24;
const MAX_STEP_CHANGE = 0.08;

export type ClockSource = "tempo" | "beats";

export interface ClockGrid {
  beats: readonly number[];
  beatsPerBar: number;
  downbeat: number;
  barStarts?: readonly number[];
}

/** A missing choice belongs to the written tempo on previously saved songs. */
export function clockSource(value: unknown, newSong: boolean): ClockSource {
  if (value === "tempo" || value === "beats") return value;
  return newSong ? "beats" : "tempo";
}

/** A grid needs a real interval. Reject intervals outside the MIDI clock's usable tempo range. */
export function usableClockGrid(grid: ClockGrid | null | undefined): grid is ClockGrid {
  return !!grid && grid.beats.length >= 2 && grid.beats.every((beat, i) => {
    if (!Number.isFinite(beat) || beat < 0) return false;
    if (i === 0) return true;
    const length = beat - grid.beats[i - 1];
    return length >= 0.1 && length <= 6;
  });
}

/** Average quarter-note tempo of the first two bars, using a shorter span when the grid ends early. */
export function openingBeatTempo(grid: ClockGrid | null): number | null {
  if (!usableClockGrid(grid)) return null;
  const start = Math.min(grid.downbeat, grid.beats.length - 2);
  const second = grid.barStarts?.[1] ?? start + grid.beatsPerBar;
  const end = Math.min(grid.barStarts?.[2] ?? second + grid.beatsPerBar, grid.beats.length - 1);
  return (60 * (end - start)) / (grid.beats[end] - grid.beats[start]);
}

function slew(target: number, previous: number): number {
  return Math.min(previous * (1 + MAX_STEP_CHANGE), Math.max(previous * (1 - MAX_STEP_CHANGE), target));
}

/**
 * A pulse interval close to the preceding one keeps its linear spacing. On an abrupt change, ease toward a new spacing.
 * The eased intervals still have to add up to the exact beat length, so fit their target spacing before scheduling any of them.
 */
function easedOffsets(length: number, previous: number): number[] | null {
  const average = length / CLOCK_PPQN;
  if (slew(average, previous) === average) return null;
  const offsets = new Array<number>(CLOCK_PPQN + 1);
  const fill = (target: number) => {
    let step = previous;
    offsets[0] = 0;
    for (let i = 1; i <= CLOCK_PPQN; i++) {
      step = slew(target, step);
      offsets[i] = offsets[i - 1] + step;
    }
    return offsets[CLOCK_PPQN];
  };
  let lo = 0;
  let hi = length;
  for (let i = 0; i < 36; i++) {
    const middle = (lo + hi) / 2;
    if (fill(middle) < length) lo = middle;
    else hi = middle;
  }
  const span = fill((lo + hi) / 2);
  // A sufficiently extreme grid error can make the exact endpoint unreachable at the slew limit. Preserve the beat
  // and distribute the correction through the interval, rather than bunch up pulses at its end.
  if (Math.abs(span - length) > 1e-8) {
    for (let i = 1; i < CLOCK_PPQN; i++) offsets[i] *= length / span;
  }
  offsets[CLOCK_PPQN] = length;
  return offsets;
}

/** Converts between the beat grid's integer MIDI pulses and audio time in song seconds. */
export class BeatClock {
  private readonly offsets = new Map<number, number[]>();
  private readonly last: number;
  private readonly firstStep: number;
  private readonly lastStep: number;

  constructor(private readonly beats: readonly number[]) {
    this.last = beats.length - 1;
    this.firstStep = (beats[1] - beats[0]) / CLOCK_PPQN;
    this.lastStep = (beats[this.last] - beats[this.last - 1]) / CLOCK_PPQN;
    let previous = this.firstStep;
    for (let beat = 1; beat < this.last; beat++) {
      const length = beats[beat + 1] - beats[beat];
      const offsets = easedOffsets(length, previous);
      if (offsets) this.offsets.set(beat, offsets);
      previous = offsets ? length - offsets[CLOCK_PPQN - 1] : length / CLOCK_PPQN;
    }
  }

  at(pulse: number): number {
    if (pulse < 0) return this.beats[0] + pulse * this.firstStep;
    if (pulse >= this.last * CLOCK_PPQN) return this.beats[this.last] + (pulse - this.last * CLOCK_PPQN) * this.lastStep;
    const beat = Math.floor(pulse / CLOCK_PPQN);
    const within = pulse - beat * CLOCK_PPQN;
    return this.beats[beat] + (this.offsets.get(beat)?.[within] ?? ((this.beats[beat + 1] - this.beats[beat]) * within) / CLOCK_PPQN);
  }

  /** The next pulse on or after this position, including extrapolated pulses in the count-in or ending. */
  next(position: number): number {
    let from: number;
    let to: number;
    if (position < this.beats[0]) return Math.ceil((position - this.beats[0]) / this.firstStep - 1e-9);
    if (position >= this.beats[this.last])
      return this.last * CLOCK_PPQN + Math.ceil((position - this.beats[this.last]) / this.lastStep - 1e-9);
    let low = 0;
    let high = this.last;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.beats[middle] <= position) low = middle;
      else high = middle;
    }
    from = low * CLOCK_PPQN;
    to = high * CLOCK_PPQN;
    while (from < to) {
      const middle = Math.floor((from + to) / 2);
      if (this.at(middle) < position - 1e-9) from = middle + 1;
      else to = middle;
    }
    return from;
  }
}
