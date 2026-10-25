import { useState } from "react";
import { measureLoudnessInWorker } from "@/song/audio/loudness-client";
import { normalisingGain, TARGET_LUFS, withLoudness, type SongLoudness } from "@/song/audio/loudness";
import { getSetting, setSetting } from "@/song/performance/settings";
import type { PcmAudio } from "@/song/types";

/**
 * Normalises a song's volume to the target loudness. The song is measured once, in a worker, and the level is kept with the song. The
 * gain is applied to every track, so the mix keeps its balance.
 */
export function SongLoudnessControl({
  audio,
  storageKey,
  value,
  onChange,
}: {
  audio: PcmAudio | null;
  storageKey: string;
  value: SongLoudness;
  onChange: (next: SongLoudness) => void;
}) {
  const [measuring, setMeasuring] = useState(false);
  const [error, setError] = useState("");
  const save = (next: SongLoudness) => {
    setSetting(storageKey, ":options", withLoudness(getSetting(storageKey, ":options"), next));
    onChange(next);
  };
  const toggle = async (normalise: boolean) => {
    setError("");
    if (!normalise || value.lufs !== null) return save({ ...value, normalise });
    if (!audio) return setError("Load the song before normalising it.");
    setMeasuring(true);
    try {
      const lufs = await measureLoudnessInWorker(audio);
      if (!Number.isFinite(lufs)) return setError("This song is silent, so there is nothing to normalise.");
      save({ lufs, normalise: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMeasuring(false);
    }
  };
  const gainDb = value.lufs === null ? null : 20 * Math.log10(normalisingGain(value.lufs));
  return (
    <section aria-label="Song loudness" className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" aria-label="Normalise song volume" checked={value.normalise} disabled={measuring} onChange={(e) => void toggle(e.target.checked)} />
        Normalise song volume to {TARGET_LUFS} LUFS
      </label>
      <span className="opacity-70">
        {measuring
          ? "Measuring…"
          : gainDb === null
            ? "Not measured yet"
            : `Measured ${value.lufs!.toFixed(1)} LUFS, gain ${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)} dB`}
      </span>
      {error && (
        <span role="alert" className="text-led-fault">
          {error}
        </span>
      )}
    </section>
  );
}
