import { useRef, useState, type PointerEvent } from "react";
import type { Energy } from "@/song/band/styles";

export interface SectionLevels {
  busy: Energy;
  loud: Energy;
}

const clampLevel = (level: number): Energy => Math.max(1, Math.min(5, level)) as Energy;

export function BandSectionPad({ value, automatic, overridden, disabled, onChange }: {
  value: SectionLevels;
  automatic: SectionLevels;
  overridden: boolean;
  disabled?: boolean;
  onChange(levels: SectionLevels | null, preview: boolean): void;
}) {
  const active = useRef<number | null>(null);
  const [draft, setDraft] = useState<SectionLevels | null>(null);
  const shown = draft ?? value;
  const at = (event: PointerEvent<HTMLDivElement>): SectionLevels => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      busy: clampLevel(Math.floor((event.clientX - bounds.left) / bounds.width * 5) + 1),
      loud: clampLevel(5 - Math.floor((event.clientY - bounds.top) / bounds.height * 5)),
    };
  };
  const write = (next: SectionLevels, preview: boolean) => {
    onChange(next.busy === automatic.busy && next.loud === automatic.loud ? null : next, preview);
  };
  const dot = ({ busy, loud }: SectionLevels) => ({ left: `${(busy - 0.5) * 20}%`, top: `${(5.5 - loud) * 20}%` });
  return (
    <div
      role="group"
      aria-label={`Busy ${shown.busy}, loud ${shown.loud}`}
      aria-disabled={disabled || undefined}
      title="Busy left to right, loud bottom to top. Drag to preview. Arrow keys move, Delete clears."
      tabIndex={disabled ? -1 : 0}
      className="relative size-16 shrink-0 touch-none rounded border border-white/20 bg-white/5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ backgroundImage: "linear-gradient(to right, #ffffff20 1px, transparent 1px), linear-gradient(to bottom, #ffffff20 1px, transparent 1px)", backgroundSize: "20% 20%" }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || active.current !== null) return;
        active.current = event.pointerId;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.currentTarget.focus();
        setDraft(at(event));
      }}
      onPointerMove={(event) => {
        if (active.current === event.pointerId) setDraft(at(event));
      }}
      onPointerUp={(event) => {
        if (active.current !== event.pointerId) return;
        active.current = null;
        setDraft(null);
        if (!disabled) write(at(event), true);
      }}
      onPointerCancel={() => { active.current = null; setDraft(null); }}
      onLostPointerCapture={() => { active.current = null; setDraft(null); }}
      onKeyDown={(event) => {
        if (disabled) return;
        const del = event.key === "Delete" || event.key === "Backspace";
        const offsets: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1] };
        const step = offsets[event.key];
        if (!step && !del) return;
        event.preventDefault();
        if (del) onChange(null, false);
        else write({ busy: clampLevel(shown.busy + step[0]), loud: clampLevel(shown.loud + step[1]) }, false);
      }}
    >
      <span aria-hidden className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/75" style={dot(automatic)} />
      {(overridden || draft) && <span aria-hidden className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={dot(shown)} />}
    </div>
  );
}
