import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import type { SliderControl } from "./controls";
import { formatValue } from "./knob-math";

const D = 118;

/**
 * Magnifying glass over the knob being turned: the same drawing again in a round window, cropped to the knob,
 * so the ring and pointer move live. The value is printed big above the glass. Portalled to the body (fixed), because
 * the pedal row clips what sticks out of it.
 */
export function Loupe({ art, view, control: c, frame }: { art: ReactNode; view: [number, number]; control: SliderControl; frame: HTMLElement }) {
  const [W, H] = view;
  const r = frame.getBoundingClientRect();
  const cx = r.left + ((c.x + c.w / 2) / W) * r.width;
  // clear of the value bubble the drawing itself puts over a knob that is turned
  const above = r.top + (c.y / H) * r.height - 28 - (D + 7) - 34;
  const flip = above < 8;
  const top = flip ? r.top + ((c.y + c.h) / H) * r.height + 14 : above;
  const left = Math.min(Math.max(cx - D / 2, 8), window.innerWidth - D - 8);
  const side = c.w * 1.08;
  const viewBox = `${c.x + c.w / 2 - side / 2} ${c.y + c.h / 2 - side / 2} ${side} ${side}`;
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed z-[60] flex animate-in flex-col items-center gap-1.5 fade-in zoom-in-90 duration-150" style={{ left, top, width: D }}>
      <span className="rounded-pill bg-white px-4 py-1 text-[22px] leading-none font-bold text-black tabular-nums shadow-[0_6px_18px_rgb(0_0_0/0.5)]">{formatValue(c.value, c.spec)}</span>
      <div className="rounded-full bg-[linear-gradient(145deg,#f4f5f7,#8b8e95_45%,#3b3d42)] p-[3.5px] shadow-[0_16px_40px_rgb(0_0_0/0.6)]">
        <div className="relative size-[112px] overflow-hidden rounded-full bg-black shadow-[inset_0_0_0_1px_rgb(0_0_0/0.6)]">
          <svg viewBox={viewBox} className="size-full">
            {art}
          </svg>
          <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_22%,rgb(255_255_255/0.4),transparent_38%),radial-gradient(circle_at_50%_50%,transparent_62%,rgb(0_0_0/0.35))]" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
