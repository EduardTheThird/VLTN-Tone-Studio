// The band settings, beat grid and the two flags the Band panel keeps in a song's options. Reads go through parseBandSettings and
// parseBeatGrid, so a damaged or older entry falls back to the defaults. Writes keep every other option, as the other settings do.

import { readOptions, setSetting } from "../performance/settings";
import { parseBandSettings, type BandSettings } from "./arrangement";
import { parseBeatGrid, type BeatGrid } from "./beat-grid";

export interface StoredBand {
  settings: BandSettings;
  grid: BeatGrid | null;
  /** True when a setting or the grid changed since the parts were last generated. */
  outOfDate: boolean;
  /** True once the missing-part notice was dismissed for this song. */
  noticeDismissed: boolean;
}

/** The options the Band panel writes. Only the fields given are changed. */
export interface BandPatch {
  band?: BandSettings;
  beatGrid?: BeatGrid | null;
  bandOutOfDate?: boolean;
  bandNoticeDismissed?: boolean;
}

export function readStoredBand(key: string): StoredBand {
  const options = readOptions<Record<string, unknown>>(key, {});
  return {
    settings: parseBandSettings(options.band),
    grid: parseBeatGrid(options.beatGrid),
    outOfDate: options.bandOutOfDate === true,
    noticeDismissed: options.bandNoticeDismissed === true,
  };
}

export function writeStoredBand(key: string, patch: BandPatch): void {
  setSetting(key, ":options", JSON.stringify({ ...readOptions<Record<string, unknown>>(key, {}), ...patch }));
}
