import { useState } from "react";
import { Button } from "@/components/ui/button";
import { effectiveBpm } from "@/song/performance/speed";
import { useSession, type PerformanceSession } from "@/song/performance/session";

const field = "rounded border border-seam bg-transparent p-2";

/**
 * The song's speed, pitch and fine tune, and whether the chord names follow the pitch. The speed slider commits when it is let go,
 * so a drag starts one render, not one for every step.
 */
export function SpeedControls({ session, bpm }: { session: PerformanceSession; bpm: number }) {
  const speed = useSession(session, (s) => s.speed);
  const rendering = useSession(session, (s) => s.rendering);
  const [draft, setDraft] = useState<number | null>(null);
  const percent = draft ?? Math.round(speed.rate * 100);
  const commit = (e: { currentTarget: HTMLInputElement }) => {
    if (draft === null) return;
    setDraft(null);
    session.setSpeed({ rate: Number(e.currentTarget.value) / 100 });
  };
  return (
    <div aria-label="Speed and pitch" className="flex flex-wrap items-center gap-3">
      <h2 className="font-semibold">Speed & pitch</h2>
      <label className="flex items-center gap-2">
        Speed
        <input
          aria-label="Speed"
          className="w-40"
          type="range"
          min="50"
          max="150"
          step="1"
          value={percent}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
        />
      </label>
      <span className="w-12 tabular-nums">{percent}%</span>
      <Button variant="outline" size="sm" disabled={speed.rate === 1} onClick={() => session.setSpeed({ rate: 1 })}>
        Reset speed
      </Button>
      <label>
        Pitch{" "}
        <input
          aria-label="Pitch semitones"
          className={field + " w-20"}
          type="number"
          min="-6"
          max="6"
          value={speed.semitones}
          onChange={(e) => session.setSpeed({ semitones: Number(e.target.value) || 0 })}
        />
      </label>
      <label>
        Fine tune{" "}
        <input
          aria-label="Pitch cents"
          className={field + " w-20"}
          type="number"
          min="-50"
          max="50"
          value={speed.cents}
          onChange={(e) => session.setSpeed({ cents: Number(e.target.value) || 0 })}
        />{" "}
        cents
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" aria-label="Apply pitch to chords" checked={speed.applyToChords} onChange={(e) => session.setSpeed({ applyToChords: e.target.checked })} />
        Apply pitch to chords
      </label>
      <span className="text-sm tabular-nums text-silkscreen-3">Plays at {Math.round(effectiveBpm(bpm, speed.rate))} BPM</span>
      {rendering && (
        <span role="status" className="text-sm text-silkscreen-3">
          Rendering… {rendering.done} of {rendering.total} tracks
        </span>
      )}
    </div>
  );
}
