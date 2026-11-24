import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { showToast } from "@/app/notify";
import { usePedalLibrary } from "@/song/performance/pedal-library";
import { rigDestinations, type RigState } from "@/song/performance/rig-state";
import { manualPresetNumber } from "@/song/performance/pedal-preset-names";
import { selectArmed, useSession, type PerformanceSession } from "@/song/performance/session";
import { usePresetNames } from "./use-preset-names";

const EMPTY_RIG: RigState = {};

export function RigStageControls({ session }: { session: PerformanceSession }) {
  const state = useSession(session, (session) => session.rigState ?? EMPTY_RIG);
  const solo = useSession(session, (session) => session.soloActive ?? false);
  const armed = useSession(session, selectArmed);
  const channel = useSession(session, (session) => session.tempoChannel);
  const library = usePedalLibrary();
  const gp180 = usePresetNames("gp180").presetNames?.names;
  const gp150 = usePresetNames("gp150").presetNames?.names;
  const pedals = useMemo(() => rigDestinations(library, channel ?? 16).map(({ profile }) => {
    const id = profile.id;
    const wire = state[id];
    let name = "";
    if (wire?.slot !== undefined) {
      name = (id === "valeton-gp180" ? gp180?.[wire.slot] : id === "valeton-gp150" ? gp150?.[wire.slot] : undefined)
        ?? library.presets[id]?.find(({ slot }) => slot === wire.slot)?.name ?? "";
      name = [manualPresetNumber(id, wire.slot), name].filter(Boolean).join(" ");
    }
    const label = profile.name.replace(/^Valeton |^BOSS |^Strymon /, "");
    const effect = wire?.enabled === false ? "Bypassed" : wire?.enabled === true ? "Engaged" : undefined;
    return { id, label, name, effect, source: wire?.source };
  }), [library, channel, state, gp180, gp150]);
  const summary = pedals.filter((pedal) => pedal.name).map(({ label, name }) => `${label} ${name}`).join(" · ");
  if (!pedals.length) return null;
  const run = (action: () => string | void) => {
    const hint = action();
    if (hint) showToast({ tone: "info", title: hint });
  };
  return (
    <div className="flex flex-wrap gap-2" aria-label="Stage rig">
      <details className="rounded border border-seam px-2 py-1">
        <summary className="cursor-pointer text-sm" aria-label="Last known rig state">{summary || "Rig state"}</summary>
        <ul className="space-y-1 py-2 text-sm">
          {pedals.map(({ id, label, name, effect, source }) => (
            <li key={id}>{[label, name || "Preset unknown", effect, source === "pedal" ? "From pedal" : source === "sent" ? "Sent by app" : undefined].filter(Boolean).join(" · ")}</li>
          ))}
        </ul>
        <Button variant="outline" size="sm" disabled={!armed} onClick={() => run(() => session.resetRig(true))}>Reset rig to song start</Button>
      </details>
      <Button variant="outline" size="sm" disabled={!armed} onClick={() => run(() => session.resetRig())}>Reset rig to here</Button>
      <Button variant={solo ? "default" : "outline"} size="sm" disabled={!armed} aria-pressed={solo} onClick={() => run(() => session.solo("toggle"))}>Live Solo</Button>
    </div>
  );
}
