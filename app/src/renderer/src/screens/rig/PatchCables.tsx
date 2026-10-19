import { useLayoutEffect, useState, type RefObject } from "react";
import { BLOCK_HEX, shade } from "@/components/gear/art";
import type { BlockCode } from "@/state/device-types";

/** Side jacks sit this far down a 100×150 pedal drawing and stick out 1.6 units past its edges (see Enclosure). */
const JACK_Y = 70 / 150;
const PLUG = 7;

interface Cable {
  x1: number;
  x2: number;
  y: number;
  color: string;
}

/**
 * Patch cables between the side jacks of neighbouring pedals, one per pair, in the colour of the pedal they leave.
 * Drawn behind the pedals inside the scrolling row, so they scroll with it. `codes` is the block code of each pedal in row order.
 */
export function PatchCables({ rowRef, codes }: { rowRef: RefObject<HTMLElement | null>; codes: BlockCode[] }) {
  const [cables, setCables] = useState<Cable[]>([]);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const key = codes.join();

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      const rr = row.getBoundingClientRect();
      const ox = rr.left - row.scrollLeft;
      const oy = rr.top - row.scrollTop;
      const jacks = [...row.querySelectorAll<HTMLElement>(":scope > [role=listitem]")].map((el) => {
        const r = el.querySelector('svg[viewBox="0 0 100 150"]')?.getBoundingClientRect();
        return r && { l: r.left - ox + r.width * 0.016, r: r.left - ox + r.width * 0.984, y: r.top - oy + r.height * JACK_Y };
      });
      const next: Cable[] = [];
      jacks.forEach((a, i) => {
        const b = jacks[i + 1];
        const code = codes[i];
        if (a && b && code) next.push({ x1: a.r, x2: b.l, y: (a.y + b.y) / 2, color: shade(BLOCK_HEX[code] ?? "#8e8e93", -0.3) });
      });
      setCables(next);
      setSize([row.scrollWidth, row.scrollHeight]);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    row.querySelectorAll(":scope > [role=listitem]").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `codes`
  }, [rowRef, key]);

  if (!cables.length) return null;
  return (
    <svg aria-hidden width={size[0]} height={size[1]} className="pointer-events-none absolute top-0 left-0 overflow-visible">
      <defs>
        <linearGradient id="plugsteel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f3f5" />
          <stop offset=".5" stopColor="#b9bcc2" />
          <stop offset="1" stopColor="#7d8087" />
        </linearGradient>
      </defs>
      {cables.map((c, i) => {
        const a = c.x1 + PLUG;
        const b = c.x2 - PLUG;
        const sag = 12 + Math.max(0, b - a) * 0.12;
        const d = `M${a} ${c.y}C${a + (b - a) * 0.3} ${c.y + sag},${b - (b - a) * 0.3} ${c.y + sag},${b} ${c.y}`;
        return (
          <g key={i}>
            <path d={d} transform="translate(0 4)" fill="none" stroke="#000" strokeOpacity={0.35} strokeWidth={4.2} strokeLinecap="round" />
            <path d={d} fill="none" stroke={c.color} strokeWidth={3.6} strokeLinecap="round" />
            <path d={d} transform="translate(0 -0.9)" fill="none" stroke="#fff" strokeOpacity={0.28} strokeWidth={1} strokeLinecap="round" />
            {[
              { x: c.x1, dir: 1 },
              { x: c.x2, dir: -1 },
            ].map(({ x, dir }) => (
              <g key={dir} transform={`translate(${x} ${c.y}) scale(${dir} 1)`}>
                <rect x={0} y={-2.4} width={4} height={4.8} rx={0.8} fill="url(#plugsteel)" />
                <rect x={3.6} y={-3.1} width={3.6} height={6.2} rx={1.6} fill="#1b1b1e" />
                <rect x={3.9} y={-2.7} width={2.2} height={1.2} rx={0.6} fill="#fff" fillOpacity={0.25} />
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
