import { MinusIcon, PlusIcon } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useBoardZoom, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "./zoom";

const BTN = "grid size-7 place-items-center rounded-full text-silkscreen-2 transition-colors enabled:hover:bg-white/12 enabled:hover:text-silkscreen disabled:opacity-35";

/** Map-style zoom bar beside the pedal board: + on top, a vertical slider, − below; the percentage resets to 100%. */
export function ZoomBar({ className }: { className?: string }) {
  const zoom = useBoardZoom((s) => s.zoom);
  const setZoom = useBoardZoom((s) => s.setZoom);
  return (
    <div
      role="group"
      aria-label="Zoom the board"
      className={cn("flex w-10 flex-col items-center gap-1 rounded-2xl bg-[rgb(10_10_12/0.72)] py-1.5 shadow-[inset_0_0_0_1px_var(--glass-edge),0_8px_22px_rgb(0_0_0/0.4)]", className)}
    >
      <button type="button" className={BTN} aria-label="Zoom in" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom(zoom + ZOOM_STEP)}>
        <PlusIcon className="size-4" aria-hidden />
      </button>
      <Slider
        orientation="vertical"
        aria-label="Board zoom"
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={0.05}
        value={[zoom]}
        onValueChange={([v]) => setZoom(v)}
        className="data-[orientation=vertical]:h-24 data-[orientation=vertical]:min-h-0"
      />
      <button type="button" className={BTN} aria-label="Zoom out" disabled={zoom <= ZOOM_MIN} onClick={() => setZoom(zoom - ZOOM_STEP)}>
        <MinusIcon className="size-4" aria-hidden />
      </button>
      <button type="button" title="Reset zoom" aria-label="Reset zoom to 100%" disabled={zoom === 1} onClick={() => setZoom(1)} className="text-[10px] font-semibold text-silkscreen-3 tabular-nums enabled:hover:text-silkscreen">
        {Math.round(zoom * 100)}%
      </button>
    </div>
  );
}
