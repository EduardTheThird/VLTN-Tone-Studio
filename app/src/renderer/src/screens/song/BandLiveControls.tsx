import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { BAND_VARIANT_LABELS, type BandVariant } from "@/song/band/live-variants";
import { useSession, type PerformanceSession } from "@/song/performance/session";

export function BandChangeStatus({ session }: { session: PerformanceSession }) {
  const pending = useSession(session, (state) => state.pendingBandVariant);
  return pending ? (
    <span className="flex items-center gap-2">
      <span role="status">{BAND_VARIANT_LABELS[pending.variant]} at next bar</span>
      <Button size="sm" variant="outline" onClick={session.cancelBandVariant}>Cancel band change</Button>
    </span>
  ) : null;
}

export function BandLiveControls({ session }: { session: PerformanceSession }) {
  const player = useSession(session, (state) => state.player);
  const variant = useSession(session, (state) => state.bandVariant);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const cancelHold = () => {
    if (hold.current !== null) clearTimeout(hold.current);
    hold.current = null;
  };
  useEffect(() => cancelHold, []);
  if (!player?.liveBandAvailable) return null;
  const choose = (mode: BandVariant) => session.changeBandVariant(mode);
  const rendered = player.renderedBandAvailable;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Live band changes">
      {(["soft", "normal", "lift", "out"] as const).map((mode) => (
        <Button
          key={mode}
          variant={mode === variant || (mode === "normal" && variant === "drums") ? "default" : "outline"}
          aria-pressed={mode === variant || (mode === "normal" && variant === "drums")}
          disabled={(mode === "soft" || mode === "lift") && !rendered}
          title={mode === "normal" ? "Hold for drums only" : undefined}
          className="min-h-11 min-w-20"
          onPointerDown={mode === "normal" ? () => {
            held.current = false;
            hold.current = setTimeout(() => {
              held.current = true;
              choose("drums");
            }, 500);
          } : undefined}
          onPointerUp={mode === "normal" ? cancelHold : undefined}
          onPointerCancel={mode === "normal" ? cancelHold : undefined}
          onPointerLeave={mode === "normal" ? cancelHold : undefined}
          onContextMenu={mode === "normal" ? (event) => event.preventDefault() : undefined}
          onClick={(event) => {
            if (mode === "normal" && held.current && event.detail !== 0) return;
            choose(mode);
          }}
        >
          {mode === "out" ? "Out" : mode === "normal" && variant === "drums" ? "Drums only" : BAND_VARIANT_LABELS[mode]}
        </Button>
      ))}
      {!rendered && <span className="text-xs text-silkscreen-3">Turn on live band changes in Band settings for Soft and Lift.</span>}
      <BandChangeStatus session={session} />
    </div>
  );
}
