// SVG parts of the amplifier drawings: tolex covering, grille cloth, brushed faceplate, strap handle, corner caps,
// jewel lamp, toggle and the scaled amp knob. Like parts.tsx, coordinates are viewBox units of the drawing using them.
import type { ReactNode } from "react";
// Overlays are pre-rendered RGBA (bright speckle white, dark speckle black) so no mix-blend-mode is needed at runtime.
import quiltUrl from "@/assets/textures/ov-quilt.webp";
import treadUrl from "@/assets/textures/ov-tread.webp";
import tolexHiUrl from "@/assets/textures/ov-tolex-hi.webp";
import tolexLoUrl from "@/assets/textures/ov-tolex-lo.webp";
import weaveUrl from "@/assets/textures/ov-weave.webp";
import brushUrl from "@/assets/textures/ov-brush.webp";
import { clamp01, lum, type AmpFinish } from "./art";

/** A photographic (CC0, ambientCG) texture as a tiling pattern, `size` viewBox units to a side. */
const Tex = ({ id, url, size }: { id: string; url: string; size: number }) => (
  <pattern id={id} patternUnits="userSpaceOnUse" width={size} height={size}>
    <image href={url} width={size} height={size} preserveAspectRatio="none" />
  </pattern>
);

const PLATE_STOPS = {
  silver: ["#eceef1", "#c4c8cf", "#9da2aa"],
  gold: ["#e7c978", "#c9a24b", "#8f6d27"],
  black: ["#2b2b2f", "#1a1a1d", "#0e0e10"],
  cream: ["#f1e8cb", "#dbd0ac", "#b9ac83"],
  blue: ["#4378bd", "#2d5590", "#1b3560"],
  chrome: ["#fbfcfd", "#d3d8de", "#98a0aa"],
  white: ["#ffffff", "#f0efec", "#d6d4cf"],
} as const;

const isDarkPlate = (f: AmpFinish) => f.plate === "black" || f.plate === "blue";

/** Per-drawing filters, gradients and the grille cloth weave. Needs the shared `Defs` (steel, cap) too. */
export function AmpDefs({ id, f }: { id: string; f: AmpFinish }) {
  const [a, b, c] = PLATE_STOPS[f.plate];
  return (
    <defs>
      <Tex id={`tolexhi${id}`} url={tolexHiUrl} size={110} />
      <Tex id={`tolexlo${id}`} url={tolexLoUrl} size={110} />
      <Tex id={`weave${id}`} url={weaveUrl} size={26} />
      <Tex id={`quilt${id}`} url={quiltUrl} size={64} />
      <Tex id={`tread${id}`} url={treadUrl} size={120} />
      <Tex id={`brush${id}`} url={brushUrl} size={40} />
      <linearGradient id={`plate${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={a} />
        <stop offset=".5" stopColor={b} />
        <stop offset="1" stopColor={c} />
      </linearGradient>
      <linearGradient id={`tshade${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity=".12" />
        <stop offset=".4" stopColor="#fff" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity=".34" />
      </linearGradient>
      <linearGradient id={`cshade${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#000" stopOpacity=".5" />
        <stop offset=".28" stopColor="#000" stopOpacity="0" />
        <stop offset=".75" stopColor="#fff" stopOpacity=".05" />
        <stop offset="1" stopColor="#000" stopOpacity=".28" />
      </linearGradient>
      <radialGradient id={`jewel${id}`} cx=".4" cy=".35" r=".7">
        <stop offset="0" stopColor="#ffb0a8" />
        <stop offset=".45" stopColor="#e0241c" />
        <stop offset="1" stopColor="#5b0a08" />
      </radialGradient>
      <pattern id={`cloth${id}`} width={f.clothKind === "sparkle" ? 8 : f.clothKind === "diamond" ? 6 : f.clothKind === "basket" ? 3 : 4} height={f.clothKind === "sparkle" ? 8 : f.clothKind === "diamond" ? 6 : f.clothKind === "basket" ? 3 : 4} patternUnits="userSpaceOnUse">
        {f.clothKind === "basket" && (
          <>
            <rect width="3" height="3" fill={f.cloth} />
            <path d="M0 .7H3M0 2.2H3" stroke="#000" strokeOpacity=".38" strokeWidth=".7" />
            <path d="M.7 0V3M2.2 0V3" stroke="#fff" strokeOpacity=".08" strokeWidth=".6" />
            <circle cx="1.5" cy="1.5" r=".35" fill="#fff" fillOpacity=".1" />
          </>
        )}
        {f.clothKind === "diamond" && (
          <>
            <rect width="6" height="6" fill={f.cloth} />
            <path d="M0 0L6 6M6 0L0 6" stroke="#000" strokeOpacity=".5" strokeWidth=".8" />
            <path d="M3 -3L9 3M3 9L-3 3M-3 3L3 9M9 3L3 -3" stroke="#fff" strokeOpacity=".1" strokeWidth=".5" />
            <path d="M3 0V6M0 3H6" stroke="#fff" strokeOpacity=".06" strokeWidth=".4" />
          </>
        )}
        {f.clothKind === "sparkle" && (
          <>
            <rect width="8" height="8" fill={f.cloth} />
            <path d="M1 0V8M3 0V8M5 0V8M7 0V8" stroke="#000" strokeOpacity=".16" strokeWidth=".6" />
            <path d="M2 0V8M4 0V8M6 0V8" stroke="#fff" strokeOpacity=".08" strokeWidth=".5" />
            <circle cx="1.5" cy="2" r=".42" fill="#fff" fillOpacity=".7" />
            <circle cx="5.5" cy="5.2" r=".36" fill="#fff" fillOpacity=".55" />
            <circle cx="3.4" cy="6.6" r=".3" fill="#cfe4ff" fillOpacity=".6" />
            <circle cx="6.6" cy="1" r=".3" fill="#fff" fillOpacity=".5" />
          </>
        )}
        {f.clothKind === "mesh" && (
          <>
            <rect width="4" height="4" fill={f.cloth} />
            <circle cx="2" cy="2" r="1.2" fill="#040405" />
            <circle cx="2" cy="1.5" r="1.2" fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth=".35" />
          </>
        )}
        {f.clothKind === "grid" && (
          <>
            <rect width="4" height="4" fill={f.cloth} />
            <path d="M0 .3H4M.3 0V4" stroke="#000" strokeOpacity=".65" strokeWidth=".7" />
            <path d="M0 1.1H4M1.1 0V4" stroke="#fff" strokeOpacity=".1" strokeWidth=".4" />
          </>
        )}
      </pattern>
      <pattern id={`tweed${id}`} width="6" height="30" patternUnits="userSpaceOnUse">
        <rect x="0" width="1.5" height="30" fill="#4a3520" fillOpacity=".55" />
        <rect x="3.2" width=".7" height="30" fill="#4a3520" fillOpacity=".3" />
        <circle cx="2.2" cy="7" r=".5" fill="#2a1b0e" fillOpacity=".5" />
        <circle cx="4.6" cy="19" r=".45" fill="#2a1b0e" fillOpacity=".45" />
        <circle cx="1.2" cy="25" r=".4" fill="#fff" fillOpacity=".25" />
      </pattern>
    </defs>
  );
}

/** Covering of a body: base colour, embossed grain, a soft light from above and a piping line along the edge. */
export function TolexBody({ id, k, x, y, w, h, rx, f, pipeInset = 0.7 }: { id: string; k: string; x: number; y: number; w: number; h: number; rx: number; f: AmpFinish; pipeInset?: number }) {
  const light = lum(f.tolex) > 0.6;
  return (
    <g>
      <clipPath id={`tc${id}${k}`}>
        <rect x={x} y={y} width={w} height={h} rx={rx} />
      </clipPath>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={f.tolex} />
      <g clipPath={`url(#tc${id}${k})`}>
        {light ? (
          <rect x={x} y={y} width={w} height={h} fill={`url(#tolexlo${id})`} />
        ) : (
          <rect x={x} y={y} width={w} height={h} fill={`url(#tolexhi${id})`} />
        )}
        {f.tolexKind === "tweed" && <rect x={x} y={y} width={w} height={h} fill={`url(#tweed${id})`} />}
        <rect x={x} y={y} width={w} height={h} fill={`url(#tshade${id})`} />
      </g>
      {f.piping && <rect x={x + pipeInset} y={y + pipeInset} width={w - 2 * pipeInset} height={h - 2 * pipeInset} rx={Math.max(1, rx - pipeInset)} fill="none" stroke={f.piping} strokeWidth={pipeInset > 2 ? 1 : 1.3} />}
      <rect x={x + 1.1} y={y + 1.1} width={w - 2.2} height={h - 2.2} rx={rx - 1} fill="none" stroke="#fff" strokeOpacity={light ? 0.5 : 0.13} strokeWidth={0.7} />
      <rect x={x + 0.4} y={y + 0.4} width={w - 0.8} height={h - 0.8} rx={rx - 0.4} fill="none" stroke="#000" strokeOpacity={0.55} strokeWidth={0.8} />
    </g>
  );
}

/** Grille cloth in a recessed frame; `veil` lets what is behind it (the speakers) show through. */
export function Cloth({ id, x, y, w, h, rx = 3, veil = 1, kind }: { id: string; x: number; y: number; w: number; h: number; rx?: number; veil?: number; kind?: string }) {
  return (
    <g>
      <rect x={x - 1.4} y={y - 1.4} width={w + 2.8} height={h + 2.8} rx={rx + 1} fill="#000" fillOpacity={0.55} />
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#cloth${id})`} fillOpacity={veil} />
      {kind === "basket" && <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#weave${id})`} opacity={veil} />}
      {kind === "diamond" && <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#quilt${id})`} opacity={veil} />}
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#cshade${id})`} />
      <rect x={x} y={y} width={w} height={h} rx={rx} fill="none" stroke="#fff" strokeOpacity={0.1} strokeWidth={0.5} />
    </g>
  );
}

/** Brushed or anodized faceplate with screws in its corners. */
export function Plate({ id, k, x, y, w, h, rx = 3, f }: { id: string; k: string; x: number; y: number; w: number; h: number; rx?: number; f: AmpFinish }) {
  const dark = isDarkPlate(f);
  return (
    <g>
      <clipPath id={`pc${id}${k}`}>
        <rect x={x} y={y} width={w} height={h} rx={rx} />
      </clipPath>
      <rect x={x} y={y + 0.7} width={w} height={h} rx={rx} fill="#000" fillOpacity={0.45} />
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#plate${id})`} />
      <rect x={x} y={y} width={w} height={h} fill={`url(#brush${id})`} opacity={dark ? 0.5 : 0.8} clipPath={`url(#pc${id}${k})`} />
      <rect x={x + 0.4} y={y + 0.4} width={w - 0.8} height={h - 0.8} rx={rx} fill="none" stroke="#fff" strokeOpacity={dark ? 0.12 : 0.65} strokeWidth={0.6} />
      <rect x={x} y={y} width={w} height={h} rx={rx} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={0.5} />
      {[
        [x + 3.6, y + 3.6],
        [x + w - 3.6, y + 3.6],
        [x + 3.6, y + h - 3.6],
        [x + w - 3.6, y + h - 3.6],
      ].map(([sx, sy], i) => (
        <g key={i}>
          <circle cx={sx} cy={sy} r={1.5} fill={`url(#steel${id})`} stroke="#000" strokeOpacity={0.45} strokeWidth={0.3} />
          <path d={`M${sx - 1} ${sy}H${sx + 1}`} stroke="#000" strokeOpacity={0.55} strokeWidth={0.4} transform={`rotate(${i * 37 + 12} ${sx} ${sy})`} />
        </g>
      ))}
    </g>
  );
}

/** Four metal corner caps around a body. */
export function CornerCaps({ id, x, y, w, h, s = 1, fill }: { id: string; x: number; y: number; w: number; h: number; s?: number; fill?: string }) {
  const cap = (cx: number, cy: number, sx: number, sy: number) => (
    <g key={`${cx}-${cy}`} transform={`translate(${cx} ${cy}) scale(${sx * s} ${sy * s})`}>
      <path d="M0 9V3.4Q0 0 3.4 0H9V2.6H4Q2.6 2.6 2.6 4V9Z" fill={fill ?? `url(#steel${id})`} fillOpacity={fill ? 1 : 0.78} stroke="#000" strokeOpacity={0.55} strokeWidth={0.5} />
      <circle cx={1.3} cy={1.3} r={0.55} fill="#000" fillOpacity={0.55} />
    </g>
  );
  return (
    <g>
      {cap(x, y, 1, 1)}
      {cap(x + w, y, -1, 1)}
      {cap(x, y + h, 1, -1)}
      {cap(x + w, y + h, -1, -1)}
    </g>
  );
}

/** Carrying handle on two chrome posts: leather strap, or a chrome bar. */
export function Handle({ id, x1, x2, y, kind = "strap", capFill }: { id: string; x1: number; x2: number; y: number; kind?: "strap" | "chrome" | "none"; capFill?: string }) {
  if (kind === "none") return null;
  const mid = (x1 + x2) / 2;
  const d = kind === "chrome" ? `M${x1} ${y + 5}Q${mid} ${y + 0.5} ${x2} ${y + 5}` : `M${x1} ${y + 6}Q${mid} ${y - 4} ${x2} ${y + 6}`;
  return (
    <g>
      {kind === "strap" ? (
        <>
          <path d={d} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={5.4} strokeLinecap="round" transform="translate(0 .9)" />
          <path d={d} fill="none" stroke="#0e0e0f" strokeWidth={4.6} strokeLinecap="round" />
          <path d={d} fill="none" stroke="#fff" strokeOpacity={0.14} strokeWidth={1} transform="translate(0 -1.3)" />
          <path d={d} fill="none" stroke="#fff" strokeOpacity={0.3} strokeWidth={0.4} strokeDasharray="1.3 1" />
        </>
      ) : (
        <>
          <path d={d} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={3.6} strokeLinecap="round" transform="translate(0 1)" />
          <path d={d} fill="none" stroke={`url(#steel${id})`} strokeWidth={3} strokeLinecap="round" />
          <path d={d} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={0.6} strokeLinecap="round" transform="translate(0 -0.8)" />
        </>
      )}
      {[x1, x2].map((x) => (
        <rect key={x} x={x - 3.2} y={y + 4.5} width={6.4} height={5.2} rx={1.4} fill={capFill ?? `url(#steel${id})`} stroke="#000" strokeOpacity={0.5} strokeWidth={0.4} />
      ))}
    </g>
  );
}

/** Glass jewel pilot lamp; glows when `on`. */
export function Jewel({ id, cx, cy, on, r = 3.3 }: { id: string; cx: number; cy: number; on: boolean; r?: number }) {
  return (
    <g>
      {on && <circle cx={cx} cy={cy} r={r * 2.6} fill="#ff2a20" opacity={0.3} />}
      <circle cx={cx} cy={cy} r={r + 1.5} fill={`url(#steel${id})`} stroke="#000" strokeOpacity={0.5} strokeWidth={0.4} />
      <circle cx={cx} cy={cy} r={r} fill={on ? `url(#jewel${id})` : "#3a0f0d"} />
      <ellipse cx={cx - r * 0.3} cy={cy - r * 0.4} rx={r * 0.38} ry={r * 0.24} fill="#fff" fillOpacity={on ? 0.75 : 0.3} />
    </g>
  );
}

/** Chrome bat-handle toggle: lever up when `on`. */
export function Toggle({ id, cx, cy, on, s = 1 }: { id: string; cx: number; cy: number; on: boolean; s?: number }) {
  const dy = (on ? -1 : 1) * 11 * s;
  return (
    <g>
      <circle cx={cx} cy={cy} r={8.2 * s} fill="#000" fillOpacity={0.45} />
      <circle cx={cx} cy={cy} r={7 * s} fill={`url(#steel${id})`} stroke="#000" strokeOpacity={0.5} strokeWidth={0.5} />
      <circle cx={cx} cy={cy} r={4.4 * s} fill="#0b0b0d" />
      <path d={`M${cx} ${cy}L${cx} ${cy + dy}`} stroke="#000" strokeOpacity={0.4} strokeWidth={4.6 * s} strokeLinecap="round" transform="translate(.8 .8)" />
      <path d={`M${cx} ${cy}L${cx} ${cy + dy}`} stroke={`url(#steel${id})`} strokeWidth={4 * s} strokeLinecap="round" />
      <circle cx={cx} cy={cy + dy} r={2.6 * s} fill={`url(#steel${id})`} stroke="#000" strokeOpacity={0.4} strokeWidth={0.4} />
    </g>
  );
}

export interface AmpKnobProps {
  id: string;
  cx: number;
  cy: number;
  r: number;
  value: number;
  min: number;
  max: number;
  /** Colour of the printed scale marks up to the value */
  lit: string;
  /** Printing colour of the rest of the scale */
  ink: string;
  dark: boolean;
  /** Colour of the insert in a dark knob's cap */
  insert?: string | null;
  focus?: boolean;
  bipolar?: boolean;
}

/** Amp knob: skirt with a knurled edge, domed cap, pointer line, and a 0–10 scale printed around it that lights up to the value. */
export function AmpKnobArt({ id, cx, cy, r, value, min, max, lit, ink, dark, insert = null, focus = false, bipolar = false }: AmpKnobProps) {
  const t = clamp01(value, min, max);
  const a0 = -225;
  const sweep = 270;
  const P = (deg: number, rr: number) => [cx + rr * Math.cos((deg * Math.PI) / 180), cy + rr * Math.sin((deg * Math.PI) / 180)];
  const end = a0 + sweep * t;
  const ticks: ReactNode[] = [];
  for (let i = 0; i <= 10; i++) {
    const f = i / 10;
    const ang = a0 + sweep * f;
    const major = i % 5 === 0;
    const [x1, y1] = P(ang, r + 2.4);
    const [x2, y2] = P(ang, r + (major ? 5.6 : 4.4));
    const on = bipolar ? (t >= 0.5 ? f >= 0.5 && f <= t + 0.001 : f <= 0.5 && f >= t - 0.001) : f <= t + 0.001;
    ticks.push(<path key={i} d={`M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`} stroke={on ? lit : ink} strokeOpacity={on ? 1 : 0.4} strokeWidth={major ? 0.9 : 0.6} strokeLinecap="round" />);
  }
  const [px0, py0] = P(end, r * 0.2);
  const [px1, py1] = P(end, r * 0.93);
  return (
    <g>
      {ticks}
      <circle cx={cx} cy={cy + r * 0.16} r={r + 1} fill="#000" fillOpacity={0.5} />
      <circle cx={cx} cy={cy} r={r} fill={`url(#${dark ? "capd" : "cap"}${id})`} />
      <circle cx={cx} cy={cy} r={r - 0.9} fill="none" stroke="#000" strokeOpacity={dark ? 0.55 : 0.25} strokeWidth={Math.min(1.2, r * 0.12)} strokeDasharray="0.5 0.65" />
      <circle cx={cx} cy={cy} r={r * 0.7} fill={`url(#${dark ? "capd" : "cap"}${id})`} stroke="#fff" strokeOpacity={dark ? 0.14 : 0.7} strokeWidth={0.5} />
      <circle cx={cx} cy={cy} r={r * 0.7} fill="none" stroke="#000" strokeOpacity={dark ? 0.6 : 0.22} strokeWidth={0.4} transform={`translate(0 ${0.35})`} />
      {dark && insert && <circle cx={cx} cy={cy} r={r * 0.36} fill={insert} fillOpacity={0.9} stroke="#000" strokeOpacity={0.5} strokeWidth={0.4} />}
      <path d={`M${px0.toFixed(2)} ${py0.toFixed(2)}L${px1.toFixed(2)} ${py1.toFixed(2)}`} stroke={dark ? "#f4f4f5" : "#17171a"} strokeWidth={Math.max(1, r * 0.14)} strokeLinecap="round" />
      {focus && <circle cx={cx} cy={cy} r={r + 7.2} fill="none" stroke="#fff" strokeWidth={1} strokeOpacity={0.9} />}
    </g>
  );
}

/** Quarter-inch input jack: chrome ring, dark socket. */
export function Jack({ id, cx, cy, r = 4.4 }: { id: string; cx: number; cy: number; r?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 1.3} fill="#000" fillOpacity={0.5} />
      <circle cx={cx} cy={cy} r={r} fill={`url(#steel${id})`} stroke="#000" strokeOpacity={0.5} strokeWidth={0.4} />
      <circle cx={cx} cy={cy} r={r * 0.58} fill="#0a0a0b" />
      <circle cx={cx} cy={cy} r={r * 0.26} fill={`url(#steel${id})`} />
    </g>
  );
}

/** Diamond tread plate over the chrome faceplate gradient. */
export function DiamondPlate({ id, x, y, w, h, rx = 3 }: { id: string; x: number; y: number; w: number; h: number; rx?: number }) {
  return (
    <g>
      <defs>
        <pattern id={`dia${id}`} width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M2.5 0L4.1 2.5L2.5 5L0.9 2.5Z" fill="#fff" fillOpacity=".5" stroke="#000" strokeOpacity=".4" strokeWidth=".3" />
          <path d="M5 7.5L7.5 5.9L10 7.5L7.5 9.1Z" fill="#fff" fillOpacity=".5" stroke="#000" strokeOpacity=".4" strokeWidth=".3" />
          <path d="M2.5 .3L4 2.5" stroke="#fff" strokeOpacity=".9" strokeWidth=".4" />
          <path d="M5.3 7.5L7.5 6.2" stroke="#fff" strokeOpacity=".9" strokeWidth=".4" />
        </pattern>
      </defs>
      <rect x={x} y={y + 0.8} width={w} height={h} rx={rx} fill="#000" fillOpacity={0.5} />
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#plate${id})`} />
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#dia${id})`} />
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#tread${id})`} />
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#tshade${id})`} opacity={0.6} />
      <rect x={x + 0.4} y={y + 0.4} width={w - 0.8} height={h - 0.8} rx={rx} fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth={0.6} />
    </g>
  );
}

/** Vent grille: `n` vertical slots in a dark chrome-framed opening. */
export function Vent({ id, x, y, w, h, n }: { id: string; x: number; y: number; w: number; h: number; n: number }) {
  const gap = w / n;
  return (
    <g>
      <rect x={x - 1.5} y={y - 1.5} width={w + 3} height={h + 3} rx={2.5} fill={`url(#steel${id})`} />
      <rect x={x} y={y} width={w} height={h} rx={1.6} fill="#0a0a0b" />
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={x + i * gap + gap * 0.28} y={y + 1.6} width={gap * 0.44} height={h - 3.2} rx={gap * 0.22} fill="#d8dce2" fillOpacity={0.88} />
      ))}
    </g>
  );
}

/** Embossed scrollwork flanking a centre badge: one motif, mirrored about x = 160. */
export function Ornament({ y }: { y: number }) {
  const motif = (
    <g fill="none" strokeLinecap="round">
      <path d="M92 24C74 22 58 30 56 44C54 56 66 62 74 56C80 52 77 44 70 45" />
      <path d="M92 80C74 82 58 74 56 60C55 52 63 48 68 51" />
      <path d="M86 40C78 34 66 38 66 46" />
      <path d="M60 52C48 52 36 46 30 36" />
      <path d="M60 52C48 58 38 64 30 74" />
    </g>
  );
  return (
    <g transform={`translate(0 ${y - 52})`}>
      {[1, -1].map((sx) => (
        <g key={sx} transform={sx === 1 ? undefined : "translate(320 0) scale(-1 1)"}>
          <g stroke="#000" strokeOpacity={0.35} strokeWidth={1.3} transform="translate(.8 1)">
            {motif}
          </g>
          <g stroke="#fff" strokeOpacity={0.75} strokeWidth={0.9}>
            {motif}
          </g>
        </g>
      ))}
    </g>
  );
}
