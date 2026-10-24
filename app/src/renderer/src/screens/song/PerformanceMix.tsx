import type { Mix } from "@/song/stems/mix";
import type { Stems } from "@/song/types";
import { useSession, type PerformanceSession } from "@/song/performance/session";

/** Per-stem mute and volume. */
export function PerformanceMix({
  session,
  stems,
  mix,
  onMix,
}: {
  session: PerformanceSession;
  stems: Stems | null;
  mix: Mix;
  onMix: (update: (mix: Mix) => Mix) => void;
}) {
  const player = useSession(session, (s) => s.player);
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
        </div>
      ))}
    </div>
  );
}
