import type { Mix } from "@/song/stems/mix";
import type { TrackBuses } from "@/song/stems/player";
import type { Stems } from "@/song/types";
import { BUS_LABELS, BUS_NAMES, type BusName } from "@/song/audio/outputs";
import { useSession, type PerformanceSession } from "@/song/performance/session";
import { followsPitch } from "@/song/performance/speed";

/** Per-stem mute and volume, and the output bus each stem plays on. */
export function PerformanceMix({
  session,
  stems,
  mix,
  onMix,
  trackBuses,
  onTrackBus,
}: {
  session: PerformanceSession;
  stems: Stems | null;
  mix: Mix;
  onMix: (update: (mix: Mix) => Mix) => void;
  trackBuses: TrackBuses;
  onTrackBus: (name: string, bus: BusName) => void;
}) {
  const player = useSession(session, (s) => s.player);
  const speed = useSession(session, (s) => s.speed);
  if (!player) return null;
  return (
    <div aria-label="Performance mixer" className="flex flex-wrap gap-3">
      {player.names.map((name) => (
        <div key={name} className="flex items-center gap-2 rounded-lg border border-seam px-3 py-2 text-sm">
          <label>
            <input
              type="checkbox"
              aria-label={`${stems ? name : "Song"} enabled`}
              checked={!mix[name].mute}
              onChange={(e) => onMix((m) => ({ ...m, [name]: { ...m[name], mute: !e.target.checked } }))}
            />{" "}
            {stems ? name : "Song"}
          </label>
          <input
            aria-label={`${stems ? name : "Song"} volume`}
            className="w-24"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={mix[name].volume}
            onChange={(e) => onMix((m) => ({ ...m, [name]: { ...m[name], volume: Number(e.target.value) } }))}
          />
          <span className="w-9 text-right tabular-nums">{Math.round(mix[name].volume * 100)}%</span>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              aria-label={`${name} follows pitch`}
              checked={followsPitch(speed, name)}
              onChange={(e) => session.setSpeed({ followsPitch: { ...speed.followsPitch, [name]: e.target.checked } })}
            />
            Follows pitch
          </label>
          <select
            aria-label={`${stems ? name : "Song"} bus`}
            className="rounded-md border border-seam bg-transparent px-2 py-1"
            value={trackBuses[name] ?? "main"}
            onChange={(e) => onTrackBus(name, e.target.value as BusName)}
          >
            {BUS_NAMES.map((bus) => (
              <option key={bus} value={bus}>
                {BUS_LABELS[bus]}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
