// Beat tracking for a recording, so generated parts can follow a band that keeps no click. The steps are onset strength (spectral
// flux), tempo (autocorrelation), beats (dynamic programming), the downbeat (bar phase) and a straight-line check for steady songs.
// Everything here is pure: the worker (beat-grid-worker.ts) runs it off the main thread, and no WebAudio or store is touched.

import { hann, powerSpectrum } from "../tonematch/fft";
import type { PcmAudio } from "../types";

/** Samples in one analysis frame. */
export const FFT_SIZE = 2048;
/** Samples between frames. At 44.1 kHz that is about 86 frames a second. Frame t is centred on sample t × HOP. */
export const HOP = 512;
/** Log-spaced mel bands the onset strength sums over. */
export const MEL_BANDS = 40;
/** Lowest and highest edges of the mel bands, in Hz. */
export const MEL_LOW_HZ = 30;
export const MEL_HIGH_HZ = 16000;
/** Bins below this are averaged into the low-band curve, which carries kick and bass evidence for the downbeat. */
export const LOW_BAND_HZ = 200;
/** Magnitudes are scaled by this before the log, so quiet detail still registers. */
export const LOG_COMPRESSION = 1000;
/** Length, in seconds, of the window whose mean is subtracted from the flux (half before and half after each frame). */
export const LOCAL_MEAN_SECONDS = 1;
/** Tempo search range. Lags outside it are never considered. */
export const TEMPO_MIN_BPM = 50;
export const TEMPO_MAX_BPM = 220;
/** The tempo prior is log-Gaussian, centred on this BPM. Most band music sits near it, so ties go to a tempo near 110. */
export const TEMPO_PRIOR_BPM = 110;
/** Width of the tempo prior, in octaves (its standard deviation on a log2 scale). */
export const TEMPO_PRIOR_OCTAVES = 0.8;
/**
 * Gaussian smoothing of the onset curve before the autocorrelation, in frames. A sharp onset is only correlated at whole-frame lags, so
 * a beat period that falls between frames (150 BPM is 34.45 frames) scored far below its double. Smoothing makes the score almost
 * independent of the fraction.
 */
export const TEMPO_SMOOTH_FRAMES = 1.5;
/** A best tempo below this is checked for its double, because a fast band can show its half as the strongest pulse. */
export const TEMPO_FAST_BPM = 100;
/** The double is taken when its autocorrelation is at least this share of the best one's. */
export const TEMPO_FAST_RATIO = 0.8;
/**
 * Beat tracker penalty for an interval that differs from the period, on a log scale: a 10% stretch costs about 1 unit, roughly the size
 * of one beat's onset peak once the onset is scaled to unit RMS. Tracks drift of a few percent without losing beats.
 */
export const TRACK_PENALTY = 100;
/** Beat intervals the tracker may use, as fractions of the period. Half and double are allowed, so a missed beat can be bridged. */
export const TRACK_MIN_INTERVAL = 0.5;
export const TRACK_MAX_INTERVAL = 2;
/** A chord change this close to a beat (seconds) counts toward that beat's bar phase. */
export const CHORD_WINDOW_SECONDS = 0.07;
/** Weight of chord-change evidence against low-band evidence when choosing the downbeat. Both are scaled to 0 to 1. */
export const CHORD_WEIGHT = 0.5;
/** A song is steady when every beat is this close (seconds) to a straight line through all of them. */
export const STEADY_TOLERANCE_SECONDS = 0.015;
/** The largest shift one nudge may make, in seconds. */
export const NUDGE_MAX_SECONDS = 0.1;

export interface OnsetStrength {
  /** Onset strength per frame, after the local mean is removed. */
  onset: Float64Array;
  /** Low-band flux per frame, on the same frames. */
  low: Float64Array;
  /** Frames a second. */
  frameRate: number;
}

export interface TempoEstimate {
  /** The best tempo, refined to a fraction of a frame. Zero when there is no periodic onset to find. */
  bpm: number;
  /** The best tempo first, then its half and its double, so the user can pick the one that matches the song. */
  candidates: number[];
}

export interface BeatGrid {
  beatsPerBar: number;
  /** Beat times in seconds, from the start of the audio. */
  beats: number[];
  /** Index into `beats` of the first downbeat, in 0 to beatsPerBar − 1. */
  downbeat: number;
  /** The median beat interval as a tempo. Zero when there are fewer than two beats. */
  bpm: number;
  /** Set when every beat fits a straight line; the metronome can then run on `bpm` and `firstBeat`. */
  steady: { bpm: number; firstBeat: number } | null;
}

interface MelBand {
  bins: number[];
  weights: number[];
}

/**
 * Sums the sources to one mono track, scaled so its peak is 1. Sources of different lengths are padded with silence. Float32 halves the
 * memory of a long song, and the tracker does not need more precision.
 */
export function monoSum(sources: readonly PcmAudio[]): Float32Array {
  const length = sources.reduce((max, source) => Math.max(max, source.channels[0]?.length ?? 0), 0);
  const mono = new Float32Array(length);
  for (const source of sources) {
    const channels = source.channels;
    for (const channel of channels) {
      for (let i = 0; i < channel.length; i++) mono[i] += channel[i] / channels.length;
    }
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(mono[i]));
  if (peak > 0) for (let i = 0; i < length; i++) mono[i] /= peak;
  return mono;
}

/** Triangular mel filters over the FFT bins. A band can be empty at the bottom of the range, where a bin is wider than the band. */
function melBands(sampleRate: number): MelBand[] {
  const toMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
  const toHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);
  const low = toMel(MEL_LOW_HZ),
    high = toMel(Math.min(MEL_HIGH_HZ, sampleRate / 2));
  const edges = Array.from({ length: MEL_BANDS + 2 }, (_, i) => (toHz(low + ((high - low) * i) / (MEL_BANDS + 1)) * FFT_SIZE) / sampleRate);
  return Array.from({ length: MEL_BANDS }, (_, m) => {
    const left = edges[m],
      centre = edges[m + 1],
      right = edges[m + 2];
    const band: MelBand = { bins: [], weights: [] };
    for (let k = Math.max(0, Math.floor(left)); k <= Math.min(FFT_SIZE / 2, Math.ceil(right)); k++) {
      const weight = k <= centre ? (k - left) / Math.max(centre - left, 1e-9) : (right - k) / Math.max(right - centre, 1e-9);
      if (weight > 0) {
        band.bins.push(k);
        band.weights.push(Math.min(1, weight));
      }
    }
    return band;
  });
}

/** Half-wave rectified change from the previous frame, summed over the bands. Frame 0 has no previous frame and reads as zero. */
function spectralFlux(levels: Float64Array, bands: number): Float64Array {
  const frames = levels.length / bands;
  const flux = new Float64Array(frames);
  for (let t = 1; t < frames; t++) {
    let sum = 0;
    for (let b = 0; b < bands; b++) {
      const rise = levels[t * bands + b] - levels[(t - 1) * bands + b];
      if (rise > 0) sum += rise;
    }
    flux[t] = sum;
  }
  return flux;
}

/** Subtracts the mean of the `half` frames either side of each frame, then clips at zero. Steady beats then stand out from the sustained level. */
function removeLocalMean(curve: Float64Array, half: number): Float64Array {
  const n = curve.length,
    prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + curve[i];
  const out = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    const lo = Math.max(0, t - half),
      hi = Math.min(n, t + half + 1);
    out[t] = Math.max(0, curve[t] - (prefix[hi] - prefix[lo]) / (hi - lo));
  }
  return out;
}

/**
 * Onset strength of the sources, summed to mono. The full curve uses log-compressed mel bands; the low curve uses the bins below
 * LOW_BAND_HZ. Both are spectral flux, half-wave rectified, with the local mean removed.
 */
export function onsetStrength(sources: readonly PcmAudio[], sampleRate: number): OnsetStrength {
  const mono = monoSum(sources);
  const frames = Math.ceil(mono.length / HOP),
    frameRate = sampleRate / HOP;
  const bins = FFT_SIZE / 2 + 1,
    half = FFT_SIZE / 2;
  const window = hann(FFT_SIZE),
    bands = melBands(sampleRate),
    lowBins = Math.min(bins - 1, Math.floor((LOW_BAND_HZ * FFT_SIZE) / sampleRate));
  const re = new Float64Array(FFT_SIZE),
    im = new Float64Array(FFT_SIZE),
    frame = new Float64Array(FFT_SIZE),
    power = new Float64Array(bins),
    amp = new Float64Array(bins);
  const levels = new Float64Array(frames * MEL_BANDS),
    lowLevels = new Float64Array(frames);
  // Scales |X| so a full-scale sine reads about 1, whatever the frame length.
  const scale = 4 / FFT_SIZE;
  for (let t = 0; t < frames; t++) {
    const start = t * HOP - half;
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = start + i;
      frame[i] = s >= 0 && s < mono.length ? mono[s] : 0;
    }
    powerSpectrum(frame, window, re, im, power);
    for (let k = 0; k < bins; k++) amp[k] = Math.sqrt(power[k]) * scale;
    for (let m = 0; m < MEL_BANDS; m++) {
      const band = bands[m];
      let sum = 0;
      for (let j = 0; j < band.bins.length; j++) sum += band.weights[j] * amp[band.bins[j]];
      levels[t * MEL_BANDS + m] = Math.log1p(LOG_COMPRESSION * sum);
    }
    let lowSum = 0;
    for (let k = 1; k <= lowBins; k++) lowSum += amp[k];
    lowLevels[t] = Math.log1p((LOG_COMPRESSION * lowSum) / Math.max(1, lowBins));
  }
  const halfWindow = Math.max(1, Math.round((LOCAL_MEAN_SECONDS * frameRate) / 2));
  return {
    onset: removeLocalMean(spectralFlux(levels, MEL_BANDS), halfWindow),
    low: removeLocalMean(spectralFlux(lowLevels, 1), halfWindow),
    frameRate,
  };
}

/**
 * The tempo by autocorrelation of the onset curve, weighted by a log-Gaussian prior near TEMPO_PRIOR_BPM. The best lag is refined by a
 * parabola through its neighbours. The half and double of the best tempo are returned too, since the autocorrelation of a song with a
 * steady pulse peaks at several multiples.
 */
export function estimateTempo(onset: ArrayLike<number>, frameRate: number): TempoEstimate {
  const n = onset.length;
  const minLag = Math.max(1, Math.floor((60 * frameRate) / TEMPO_MAX_BPM)),
    maxLag = Math.ceil((60 * frameRate) / TEMPO_MIN_BPM);
  if (n <= maxLag + 1) return { bpm: 0, candidates: [] };
  const smooth = smoothCurve(onset, TEMPO_SMOOTH_FRAMES);
  let mean = 0;
  for (let t = 0; t < n; t++) mean += smooth[t];
  mean /= n;
  const x = new Float64Array(n);
  for (let t = 0; t < n; t++) x[t] = smooth[t] - mean;
  // Autocorrelation at each lag, normalised by the energy at lag 0 and by the number of pairs.
  const acf = new Float64Array(maxLag + 2);
  let energy = 0;
  for (let t = 0; t < n; t++) energy += x[t] * x[t];
  if (!(energy > 0)) return { bpm: 0, candidates: [] };
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let t = 0; t + lag < n; t++) sum += x[t] * x[t + lag];
    acf[lag] = sum / (n - lag) / (energy / n);
  }
  let best = minLag,
    bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * frameRate) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / TEMPO_PRIOR_BPM) / TEMPO_PRIOR_OCTAVES) ** 2);
    const score = acf[lag] * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (!(acf[best] > 0)) return { bpm: 0, candidates: [] };
  // The prior alone favours a slow tempo: at 170 BPM the 85 BPM lag scores higher. If the best is below TEMPO_FAST_BPM and its faster
  // double is in range with nearly the same autocorrelation, the faster tempo is the pulse the band plays.
  const slowLag = peakLag(acf, best);
  const fasterLag = Math.round(slowLag / 2);
  if ((60 * frameRate) / slowLag < TEMPO_FAST_BPM && fasterLag >= minLag && acf[fasterLag] >= TEMPO_FAST_RATIO * acf[best]) best = fasterLag;
  const bpm = (60 * frameRate) / peakLag(acf, best);
  return { bpm, candidates: [bpm, bpm / 2, bpm * 2] };
}

/** The autocorrelation peak at `lag`, refined by a parabola through its neighbours, in frames. Needs `acf` to cover lag + 1. */
function peakLag(acf: Float64Array, lag: number): number {
  const a = acf[lag - 1],
    b = acf[lag],
    c = acf[lag + 1];
  const denominator = a - 2 * b + c;
  return denominator < 0 ? lag + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator)) : lag;
}

/** Gaussian smoothing over `sigma` frames. Near the ends it averages over the samples that exist. */
function smoothCurve(curve: ArrayLike<number>, sigma: number): Float64Array {
  const radius = Math.ceil(3 * sigma);
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const n = curve.length,
    out = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    let sum = 0,
      weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const u = t + k;
      if (u >= 0 && u < n) {
        sum += curve[u] * kernel[k + radius];
        weight += kernel[k + radius];
      }
    }
    out[t] = sum / weight;
  }
  return out;
}

/**
 * Beat times from dynamic programming. Each frame's score is its onset plus the best score of an earlier frame one beat-interval away,
 * minus the tempo penalty for that interval. The path with the highest score is traced back. Beat times are refined to a sub-frame peak.
 */
export function trackBeats(onset: ArrayLike<number>, frameRate: number, bpm: number): number[] {
  const n = onset.length;
  if (!(bpm > 0) || !(frameRate > 0) || n === 0) return [];
  let energy = 0;
  for (let t = 0; t < n; t++) energy += onset[t] * onset[t];
  const rms = Math.sqrt(energy / n);
  if (!(rms > 0)) return [];
  const period = (60 * frameRate) / bpm;
  const minLag = Math.max(1, Math.round(period * TRACK_MIN_INTERVAL)),
    maxLag = Math.max(minLag, Math.round(period * TRACK_MAX_INTERVAL));
  const penalty = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) penalty[lag] = TRACK_PENALTY * Math.log(lag / period) ** 2;
  const score = new Float64Array(n),
    previous = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    const here = onset[t] / rms;
    let best = -Infinity,
      from = -1;
    for (let lag = minLag; lag <= maxLag && t - lag >= 0; lag++) {
      const candidate = score[t - lag] - penalty[lag];
      if (candidate > best) {
        best = candidate;
        from = t - lag;
      }
    }
    // Continuing a path only pays when its score is positive. Otherwise this frame starts a new path.
    if (from >= 0 && best > 0) {
      score[t] = here + best;
      previous[t] = from;
    } else score[t] = here;
  }
  let end = 0;
  for (let t = 1; t < n; t++) if (score[t] > score[end]) end = t;
  const frames: number[] = [];
  for (let t = end; t !== -1; t = previous[t]) frames.push(t);
  return frames.reverse().map((t) => {
    let offset = 0;
    if (t > 0 && t < n - 1) {
      const a = onset[t - 1] / rms,
        b = onset[t] / rms,
        c = onset[t + 1] / rms;
      const denominator = a - 2 * b + c;
      if (denominator < 0) offset = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator));
    }
    return (t + offset) / frameRate;
  });
}

/**
 * The bar phase, as an index into `beats`. Each phase scores its low-band onset, scaled to 0 to 1 by the strongest phase, plus
 * CHORD_WEIGHT times its share of the chord changes that fall within CHORD_WINDOW_SECONDS of one of its beats. Ties go to the earlier beat.
 */
export function pickDownbeat(
  beats: readonly number[],
  lowOnset: ArrayLike<number>,
  frameRate: number,
  beatsPerBar: number,
  chordChanges: readonly number[] = [],
): number {
  const bar = Math.max(1, Math.floor(beatsPerBar));
  if (!beats.length) return 0;
  const lowSum = new Float64Array(bar),
    chordHits = new Float64Array(bar);
  beats.forEach((beat, i) => {
    const frame = Math.round(beat * frameRate);
    let level = 0;
    for (let f = frame - 1; f <= frame + 1; f++) if (f >= 0 && f < lowOnset.length) level = Math.max(level, lowOnset[f]);
    lowSum[i % bar] += level;
  });
  for (const change of chordChanges) {
    let nearest = -1,
      gap = Infinity;
    beats.forEach((beat, i) => {
      if (Math.abs(beat - change) < gap) {
        gap = Math.abs(beat - change);
        nearest = i;
      }
    });
    if (nearest >= 0 && gap <= CHORD_WINDOW_SECONDS) chordHits[nearest % bar]++;
  }
  const lowMax = Math.max(...lowSum),
    hitTotal = chordHits.reduce((a, b) => a + b, 0);
  let bestPhase = 0,
    bestScore = -Infinity;
  for (let p = 0; p < bar; p++) {
    const score = (lowMax > 0 ? lowSum[p] / lowMax : 0) + CHORD_WEIGHT * (chordHits[p] / Math.max(1, hitTotal));
    if (score > bestScore) {
      bestScore = score;
      bestPhase = p;
    }
  }
  return bestPhase;
}

/** A straight line through the beats, if every beat is within STEADY_TOLERANCE_SECONDS of it. Needs at least four beats. */
export function fitSteady(beats: readonly number[]): { bpm: number; firstBeat: number } | null {
  const n = beats.length;
  if (n < 4) return null;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += beats[i];
    sxx += i * i;
    sxy += i * beats[i];
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx),
    intercept = (sy - slope * sx) / n;
  if (!(slope > 0)) return null;
  for (let i = 0; i < n; i++) if (Math.abs(beats[i] - (intercept + slope * i)) > STEADY_TOLERANCE_SECONDS) return null;
  return { bpm: 60 / slope, firstBeat: intercept };
}

/** Median beat interval as a tempo. Zero when there are fewer than two beats. */
function medianBpm(beats: readonly number[]): number {
  if (beats.length < 2) return 0;
  const intervals = beats
    .slice(1)
    .map((beat, i) => beat - beats[i])
    .sort((a, b) => a - b);
  const middle = intervals[Math.floor(intervals.length / 2)];
  return middle > 0 ? 60 / middle : 0;
}

function makeGrid(beatsPerBar: number, beats: number[], downbeat: number): BeatGrid {
  return { beatsPerBar, beats, downbeat, bpm: medianBpm(beats), steady: fitSteady(beats) };
}

/** The whole pipeline: onset strength, tempo, beats, then the downbeat. Chord changes are optional and in seconds. */
export function detectBeatGrid(sources: readonly PcmAudio[], sampleRate: number, beatsPerBar: number, chordChanges: readonly number[] = []): BeatGrid {
  const { onset, low, frameRate } = onsetStrength(sources, sampleRate);
  const { bpm } = estimateTempo(onset, frameRate);
  const beats = trackBeats(onset, frameRate, bpm);
  const downbeat = pickDownbeat(beats, low, frameRate, beatsPerBar, chordChanges);
  return makeGrid(beatsPerBar, beats, downbeat);
}

/** Keeps every other beat, starting with the downbeat's beat, so the tempo halves and the bar keeps its beats per bar. */
export function halveTempo(grid: BeatGrid): BeatGrid {
  const bar = Math.max(1, Math.floor(grid.beatsPerBar));
  const keep = grid.downbeat % 2;
  const beats = grid.beats.filter((_, i) => i % 2 === keep);
  return makeGrid(grid.beatsPerBar, beats, Math.floor(grid.downbeat / 2) % bar);
}

/** Adds the midpoint between each pair of beats, so the tempo doubles and the downbeat stays on the same beat in time. */
export function doubleTempo(grid: BeatGrid): BeatGrid {
  const bar = Math.max(1, Math.floor(grid.beatsPerBar));
  const beats: number[] = [];
  grid.beats.forEach((beat, i) => {
    beats.push(beat);
    if (i + 1 < grid.beats.length) beats.push((beat + grid.beats[i + 1]) / 2);
  });
  return makeGrid(grid.beatsPerBar, beats, (2 * grid.downbeat) % bar);
}

/** Moves the downbeat by `step` beats, wrapping within the bar. */
export function shiftDownbeat(grid: BeatGrid, step: number): BeatGrid {
  const bar = Math.max(1, Math.floor(grid.beatsPerBar));
  return { ...grid, downbeat: (((grid.downbeat + step) % bar) + bar) % bar };
}

/**
 * Moves every beat by the same amount, at most NUDGE_MAX_SECONDS per call. A beat that would fall before the start is dropped, and the
 * downbeat moves back by the number dropped, so it stays on the same beat in time.
 */
export function nudgeGrid(grid: BeatGrid, seconds: number): BeatGrid {
  const shift = Math.max(-NUDGE_MAX_SECONDS, Math.min(NUDGE_MAX_SECONDS, Number.isFinite(seconds) ? seconds : 0));
  const bar = Math.max(1, Math.floor(grid.beatsPerBar));
  const kept = grid.beats.map((beat) => beat + shift).filter((beat) => beat >= 0);
  const dropped = grid.beats.length - kept.length;
  return makeGrid(grid.beatsPerBar, kept, (((grid.downbeat - dropped) % bar) + bar) % bar);
}
