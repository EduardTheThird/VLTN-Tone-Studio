import { defaultStemMix, type Mix, type StemMix } from "@/song/stems/mix";
import type { TrackBuses } from "@/song/stems/player";
import type { Stems } from "@/song/types";
import { BUS_LABELS, BUS_NAMES, type BusName } from "@/song/audio/outputs";
import { useSession, type PerformanceSession } from "@/song/performance/session";
import { followsPitch } from "@/song/performance/speed";
import { clickStretchWarning, setSolo, silenceGroupmates, type TrackInfo } from "@/song/tracks";

/** The mute groups a track belongs to, by key, as the exclusive rule reads them. */
function groupsOf(tracks: Record<string, TrackInfo>): Record<string, number[]> {
  return Object.fromEntries(Object.entries(tracks).map(([key, info]) => [key, info.muteGroups ?? []]));
}

/** The mix with `name` muted or unmuted. Unmuting (or soloing) a track in an exclusive group mutes the rest of that group. */
function withMute(mix: Mix, groups: Record<string, number[]>, name: string, mute: boolean): Mix {
  const next = { ...mix, [name]: { ...(mix[name] ?? defaultStemMix()), mute } };
  return mute ? next : silenceGroupmates(next, groups, name);
}

/**
 * Per-track mute, solo, volume and pan, the output bus each track plays on, and the pitch choice. Each track's name, colour and
 * mute groups come from what the song saved for it. A click-like track stretched at speed gets a warning, not a silent stretch.
 */
export function PerformanceMix({
  session,
  stems,
  tracks,
  mix,
  onMix,
  trackBuses,
  onTrackBus,
  onTrackInfo,
}: {
  session: PerformanceSession;
  stems: Stems | null;
  tracks: Record<string, TrackInfo>;
  mix: Mix;
  onMix: (update: (mix: Mix) => Mix) => void;
  trackBuses: TrackBuses;
  onTrackBus: (name: string, bus: BusName) => void;
  onTrackInfo: (key: string, patch: Partial<Omit<TrackInfo, "kind">>) => void;
}) {
  const player = useSession(session, (s) => s.player);
  const speed = useSession(session, (s) => s.speed);
  if (!player) return null;
  const groups = groupsOf(tracks);
  const busOf = (name: string): BusName => trackBuses[name] ?? tracks[name]?.bus ?? "main";
  const warning = clickStretchWarning(
    speed.rate,
    player.names.map((name) => ({ key: name, name: tracks[name]?.name ?? name, bus: busOf(name) })),
  );
  const label = (name: string) => (stems ? (tracks[name]?.name ?? name) : "Song");
  const usedGroups = [...new Set(Object.values(groups).flat())].sort((a, b) => a - b);
  return (
    <div aria-label="Performance mixer" className="flex flex-col gap-3">
      {usedGroups.length > 0 && (
        <div aria-label="Mute groups" className="flex flex-wrap gap-2 text-sm">
          {usedGroups.map((group) => {
            const members = player.names.filter((name) => groups[name]?.includes(group));
            const active = player.names.every((name) => (members.includes(name) ? !mix[name]?.mute : mix[name]?.mute));
            return (
              <button
                key={group}
                type="button"
                aria-pressed={active}
                className={`rounded-pill border px-3 py-1 ${active ? "border-led-on text-led-on" : "border-seam"}`}
                onClick={() =>
                  // The group is a scene: its tracks play and the rest are muted. The exclusive rule is not applied here, or it would mute the group's own members.
                  onMix((current) => {
                    const next = { ...current };
                    for (const name of player.names) next[name] = { ...(current[name] ?? defaultStemMix()), mute: active ? false : !members.includes(name) };
                    return next;
                  })
                }
              >
                Group {group}
              </button>
            );
          })}
        </div>
      )}
      {warning && (
        <p role="status" className="rounded-lg border border-seam px-3 py-2 text-sm text-led-warn">
          {warning}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {player.names.map((name) => {
          const entry: StemMix = mix[name] ?? defaultStemMix();
          const info = tracks[name];
          return (
            <div key={name} className="flex flex-wrap items-center gap-2 rounded-lg border border-seam px-3 py-2 text-sm">
              <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: info?.color ?? "#94a3b8" }} />
              <label>
                <input
                  type="checkbox"
                  aria-label={`${label(name)} enabled`}
                  checked={!entry.mute}
                  onChange={(e) => {
                    // Read the input now: an updater runs after React has put a controlled input back, so its value would be stale.
                    const enabled = e.target.checked;
                    onMix((m) => withMute(m, groups, name, !enabled));
                  }}
                />{" "}
                {label(name)}
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  aria-label={`${label(name)} solo`}
                  checked={entry.solo}
                  onChange={(e) => {
                    const solo = e.target.checked;
                    onMix((m) => setSolo(m, groups, name, solo));
                  }}
                />
                Solo
              </label>
              <input
                aria-label={`${label(name)} volume`}
                className="w-24"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={entry.volume}
                onChange={(e) => {
                  const volume = Number(e.target.value);
                  onMix((m) => ({ ...m, [name]: { ...(m[name] ?? defaultStemMix()), volume } }));
                }}
              />
              <span className="w-9 text-right tabular-nums">{Math.round(entry.volume * 100)}%</span>
              <input
                aria-label={`${label(name)} pan`}
                className="w-20"
                type="range"
                min="-1"
                max="1"
                step="0.05"
                value={entry.pan ?? 0}
                onChange={(e) => {
                  const pan = Number(e.target.value);
                  onMix((m) => ({ ...m, [name]: { ...(m[name] ?? defaultStemMix()), pan } }));
                }}
              />
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  aria-label={`${label(name)} follows pitch`}
                  checked={followsPitch(speed, name)}
                  onChange={(e) => session.setSpeed({ followsPitch: { ...speed.followsPitch, [name]: e.target.checked } })}
                />
                Follows pitch
              </label>
              <select
                aria-label={`${label(name)} bus`}
                className="rounded-md border border-seam bg-transparent px-2 py-1"
                value={busOf(name)}
                onChange={(e) => onTrackBus(name, e.target.value as BusName)}
              >
                {BUS_NAMES.map((bus) => (
                  <option key={bus} value={bus}>
                    {BUS_LABELS[bus]}
                  </option>
                ))}
              </select>
              {info?.kind === "user" && (
                <fieldset className="flex gap-1" aria-label={`${label(name)} mute groups`}>
                  {[1, 2, 3, 4, 5, 6].map((group) => {
                    const member = info.muteGroups?.includes(group) ?? false;
                    return (
                      <button
                        key={group}
                        type="button"
                        aria-pressed={member}
                        aria-label={`${label(name)} in group ${group}`}
                        className={`size-6 rounded-md border text-xs ${member ? "border-led-on text-led-on" : "border-seam"}`}
                        onClick={() => {
                          const next = member ? (info.muteGroups ?? []).filter((g) => g !== group) : [...(info.muteGroups ?? []), group].sort((a, b) => a - b);
                          onTrackInfo(name, { muteGroups: next });
                        }}
                      >
                        {group}
                      </button>
                    );
                  })}
                </fieldset>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
