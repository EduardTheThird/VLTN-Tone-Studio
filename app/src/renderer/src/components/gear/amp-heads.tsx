// Front layouts of the amp heads that follow real ones: a Marshall (gold plate under a framed grille, script logo),
// an Orange (orange tolex round a white faceplate with chrome handles), a Mesa (diamond tread plate over a vent, chrome
// domes on a black strip) and a chrome-fronted high-gain head (embossed scrollwork round a logo plate).
// All are drawn in a 320 x 150 viewBox and return the art plus the hit areas of their knobs.
import type { ReactNode } from "react";
import { fit, type AmpFinish, type HeadTemplate } from "./art";
import { AmpDefs, AmpKnobArt, Cloth, CornerCaps, DiamondPlate, Handle, Jack, Jewel, Ornament, Plate, Toggle, TolexBody, Vent } from "./amp-parts";
import type { Control, GearRender } from "./controls";
import { Defs, T } from "./parts";
import { paramTitle, type GearKnob } from "./types";

export const HEAD_VIEW: [number, number] = [320, 150];

export interface HeadCtx {
  id: string;
  name: string;
  f: AmpFinish;
  /** Voicing colour: lights the knob scale on dark panels */
  voice: string;
  on: boolean;
  ks: GearKnob[];
  focusId: string | null | undefined;
  onKnobChange?: (id: string, value: number) => void;
}

interface Row {
  x0: number;
  x1: number;
  cy: number;
  r: number;
  labelY: number;
  labelColor: string;
  labelSize?: number;
  /** Chrome domes (false) or black bakelite (true) */
  dark: boolean;
  insert?: string | null;
  lit: string;
  ink: string;
}

const isBipolar = (min: number, max: number) => min < 0 && max > 0;

function knobRow(c: HeadCtx, o: Row): { nodes: ReactNode[]; controls: Control[] } {
  const n = c.ks.length;
  const step = n > 1 ? (o.x1 - o.x0) / (n - 1) : 0;
  const controls: Control[] = [];
  const nodes = c.ks.map((k, i) => {
    const x = n === 1 ? (o.x0 + o.x1) / 2 : o.x0 + i * step;
    controls.push({ kind: "slider", id: k.id, label: `${c.name} ${paramTitle(k.label)}`, value: k.value, spec: k, onChange: c.onKnobChange && ((v) => c.onKnobChange?.(k.id, v)), x: x - o.r - 6, y: o.cy - o.r - 6, w: 2 * o.r + 12, h: 2 * o.r + 12 });
    return (
      <g key={k.id}>
        <AmpKnobArt id={c.id} cx={x} cy={o.cy} r={o.r} value={k.value} min={k.min} max={k.max} lit={o.lit} ink={o.ink} dark={o.dark} insert={o.insert} focus={k.id === c.focusId} bipolar={isBipolar(k.min, k.max)} />
        <T x={x} y={o.labelY} fill={o.labelColor} size={o.labelSize ?? 3.7} weight={700} opacity={0.9} spacing={0.4}>
          {paramTitle(k.label).toUpperCase().slice(0, 9)}
        </T>
      </g>
    );
  });
  return { nodes, controls };
}

/** Power and standby toggles, a jewel lamp and a printed caption, at the left end of a strip. */
function Switches({ c, y, xs, lamp, ink, size = 0.5 }: { c: HeadCtx; y: number; xs: number[]; lamp: number; ink: string; size?: number }) {
  return (
    <g>
      {xs.map((x, i) => (
        <g key={x}>
          <Toggle id={c.id} cx={x} cy={y} on={c.on} s={size} />
          <T x={x} y={y + 13} fill={ink} size={3.2} weight={700} opacity={0.8} spacing={0.3}>
            {i === 0 ? "POWER" : "STBY"}
          </T>
        </g>
      ))}
      <Jewel id={c.id} cx={lamp} cy={y} on={c.on} r={2.6} />
    </g>
  );
}

const Feet = ({ y = 139 }: { y?: number }) => (
  <>
    {[30, 274].map((x) => (
      <rect key={x} x={x} y={y} width={16} height={6.5} rx={1.8} fill="#0b0b0c" />
    ))}
  </>
);

/** Logo lettering: the model name in a slanted script-like face, with a pressed or raised edge. */
function Logo({ x, y, name, fill, size, maxW, shadow = "#000" }: { x: number; y: number; name: string; fill: string; size: number; maxW: number; shadow?: string }) {
  const s = Math.min(size, (maxW - 0.2 * name.length) / (0.56 * name.length));
  return (
    <g>
      <T x={x} y={y + 0.9} fill={shadow} size={s} weight={800} italic opacity={0.55} spacing={-0.2}>
        {name}
      </T>
      <T x={x} y={y} fill={fill} size={s} weight={800} italic spacing={-0.2}>
        {name}
      </T>
    </g>
  );
}

function marshall(c: HeadCtx): GearRender {
  const { id, f } = c;
  const gold = "#e0c177";
  const row = knobRow(c, { x0: 104, x1: 244, cy: 119, r: 5, labelY: 107.4, labelColor: f.ink, dark: f.darkKnobs, insert: f.knobInsert, lit: "#8a1a14", ink: f.ink, labelSize: 3.3 });
  const art = (
    <>
      <Defs id={id} body={f.tolex} />
      <AmpDefs id={id} f={f} />
      <Feet />
      <Handle id={id} x1={96} x2={224} y={1} kind="strap" capFill={gold} />
      <TolexBody id={id} k="m" x={4} y={12} w={312} h={128} rx={7} f={{ ...f, piping: f.piping ?? "#e6d9a8" }} pipeInset={5} />
      <Cloth id={id} x={18} y={22} w={284} h={70} rx={3} kind={f.clothKind} />
      <rect x={17} y={21} width={286} height={72} rx={3.4} fill="none" stroke="#e6d9a8" strokeWidth={1.3} />
      <Logo x={160} y={66} name={c.name} fill="#f6f3ea" size={26} maxW={236} />
      <Plate id={id} k="m" x={18} y={98} w={284} h={38} rx={3} f={f} />
      <Switches c={c} y={116} xs={[36, 54]} lamp={72} ink={f.ink} />
      {row.nodes}
      {[266, 290].map((x, i) => (
        <g key={x}>
          <Jack id={id} cx={x} cy={118} r={4.4} />
          <T x={x} y={108} fill={f.ink} size={3.4} weight={700} opacity={0.8}>
            {i + 1}
          </T>
        </g>
      ))}
      <CornerCaps id={id} x={4} y={12} w={312} h={128} s={0.6} fill="#1b1b1d" />
    </>
  );
  return { art, controls: row.controls };
}

function orange(c: HeadCtx): GearRender {
  const { id, f } = c;
  const row = knobRow(c, { x0: 104, x1: 240, cy: 110, r: 5.6, labelY: 82.6, labelColor: "#ffffff", dark: true, insert: null, lit: "#e8590c", ink: f.ink, labelSize: 3.3 });
  const art = (
    <>
      <Defs id={id} body={f.tolex} />
      <AmpDefs id={id} f={f} />
      <Feet />
      <TolexBody id={id} k="o" x={4} y={12} w={312} h={128} rx={7} f={f} />
      <Plate id={id} k="o" x={15} y={21} w={290} h={110} rx={2.5} f={f} />
      <rect x={25} y={28} width={270} height={36} rx={1.5} fill="none" stroke={f.ink} strokeOpacity={0.45} strokeWidth={0.6} />
      <Logo x={160} y={55} name={c.name} fill={f.ink} size={28} maxW={244} shadow="#fff" />
      <rect x={21} y={72} width={278} height={16} fill={f.tolex} />
      <rect x={21} y={72} width={278} height={16} fill="#000" opacity={0.12} />
      {row.nodes}
      <Switches c={c} y={108} xs={[36, 54]} lamp={72} ink={f.ink} />
      <Jack id={id} cx={290} cy={110} r={4.4} />
      <T x={290} y={122} fill={f.ink} size={3.3} weight={700} opacity={0.8}>
        INPUT
      </T>
      {[24, 292].map((x) => (
        <g key={x}>
          <rect x={x} y={40} width={5} height={60} rx={2.5} fill="#000" opacity={0.4} transform="translate(.8 1)" />
          <rect x={x} y={40} width={5} height={60} rx={2.5} fill={`url(#steel${id})`} stroke="#000" strokeOpacity={0.4} strokeWidth={0.4} />
        </g>
      ))}
      <CornerCaps id={id} x={4} y={12} w={312} h={128} s={0.75} fill="#0f0f10" />
    </>
  );
  return { art, controls: row.controls };
}

function mesa(c: HeadCtx): GearRender {
  const { id, f } = c;
  const strip = { ...f, plate: "black" as const };
  const row = knobRow(c, { x0: 108, x1: 244, cy: 112, r: 5.6, labelY: 127.4, labelColor: "#eef0f4", dark: false, lit: c.voice, ink: "#eef0f4", labelSize: 3.4 });
  const plateW = Math.min(64, Math.max(40, c.name.length * 3.9 + 12));
  const art = (
    <>
      <Defs id={id} body={f.tolex} />
      <AmpDefs id={id} f={f} />
      <Feet />
      <TolexBody id={id} k="s" x={4} y={12} w={312} h={128} rx={5} f={f} />
      <DiamondPlate id={id} x={10} y={18} w={300} h={68} rx={3} />
      <Vent id={id} x={62} y={34} w={64} h={36} n={16} />
      <Vent id={id} x={194} y={34} w={64} h={36} n={16} />
      <rect x={160 - plateW / 2} y={39} width={plateW} height={24} rx={3} fill="#000" fillOpacity={0.5} transform="translate(0 .8)" />
      <rect x={160 - plateW / 2} y={39} width={plateW} height={24} rx={3} fill="#0d0d0f" stroke={`url(#steel${id})`} strokeWidth={1.4} />
      <T x={160} y={54} fill="#e6e9ee" size={fit(c.name.toUpperCase(), plateW - 8, 6.4, true)} weight={800} spacing={0.4}>
        {c.name.toUpperCase()}
      </T>
      <Plate id={id} k="s" x={10} y={90} w={300} h={46} rx={3} f={strip} />
      <Switches c={c} y={110} xs={[30, 48]} lamp={66} ink="#eef0f4" />
      {row.nodes}
      <Jack id={id} cx={294} cy={112} r={4.4} />
      <CornerCaps id={id} x={4} y={12} w={312} h={128} s={0.7} fill="#16161a" />
    </>
  );
  return { art, controls: row.controls };
}

function chrome(c: HeadCtx): GearRender {
  const { id, f } = c;
  const strip = { ...f, plate: "black" as const };
  const face = { ...f, plate: "chrome" as const };
  const row = knobRow(c, { x0: 100, x1: 244, cy: 112, r: 5.8, labelY: 127.4, labelColor: "#eef0f4", dark: false, lit: c.voice, ink: "#eef0f4", labelSize: 3.5 });
  const art = (
    <>
      <Defs id={id} body={f.tolex} />
      <AmpDefs id={id} f={face} />
      <Feet />
      <Handle id={id} x1={110} x2={210} y={1} kind="chrome" />
      <TolexBody id={id} k="x" x={4} y={12} w={312} h={128} rx={7} f={f} />
      <Plate id={id} k="x" x={12} y={18} w={296} h={70} rx={3} f={face} />
      <Ornament y={53} />
      <rect x={96} y={37} width={128} height={32} rx={5} fill="#000" fillOpacity={0.5} transform="translate(0 .9)" />
      <rect x={96} y={37} width={128} height={32} rx={5} fill="#0c0c0e" stroke={`url(#steel${id})`} strokeWidth={1.6} />
      <Logo x={160} y={59} name={c.name} fill="#dde1e7" size={18} maxW={110} />
      <Plate id={id} k="y" x={12} y={92} w={296} h={44} rx={3} f={strip} />
      <Switches c={c} y={110} xs={[30, 48]} lamp={66} ink="#eef0f4" />
      {row.nodes}
      <Jack id={id} cx={292} cy={112} r={4.4} />
      <CornerCaps id={id} x={4} y={12} w={312} h={128} s={0.7} fill="#16161a" />
    </>
  );
  return { art, controls: row.controls };
}


function peavey(c: HeadCtx): GearRender {
  const { id, f } = c;
  const row = knobRow(c, { x0: 90, x1: 262, cy: 118, r: 6, labelY: 104.6, labelColor: "#f4f4f4", dark: true, insert: "#f4f4f4", lit: "#e0261c", ink: "#f4f4f4", labelSize: 3.2 });
  const logoW = Math.min(96, Math.max(46, c.name.length * 5.6 + 14));
  const art = (
    <>
      <Defs id={id} body={f.tolex} />
      <AmpDefs id={id} f={f} />
      <Feet />
      <TolexBody id={id} k="v" x={4} y={12} w={312} h={128} rx={5} f={f} />
      <Cloth id={id} x={13} y={20} w={294} h={58} rx={2} kind="mesh" />
      <rect x={13} y={20} width={294} height={58} rx={2} fill="none" stroke="#fff" strokeOpacity={0.18} strokeWidth={0.8} />
      <rect x={160 - logoW / 2} y={36} width={logoW} height={26} rx={2.5} fill="#000" fillOpacity={0.55} transform="translate(0 1)" />
      <rect x={160 - logoW / 2} y={36} width={logoW} height={26} rx={2.5} fill="#d11f17" stroke="#fff" strokeWidth={1.2} />
      <Logo x={160} y={55} name={c.name.toUpperCase()} fill="#ffffff" size={15} maxW={logoW - 8} shadow="#5b0a07" />
      <Plate id={id} k="v" x={10} y={82} w={300} h={52} rx={2.5} f={f} />
      <path d="M18 90H302" stroke="#fff" strokeOpacity={0.85} strokeWidth={0.7} />
      <path d="M18 128H302" stroke="#fff" strokeOpacity={0.85} strokeWidth={0.7} />
      <T x={30} y={98} fill="#fff" size={7} weight={800} anchor="start" spacing={0.6} italic>
        PEAVEY
      </T>
      <Switches c={c} y={116} xs={[34, 52]} lamp={70} ink="#f4f4f4" />
      {row.nodes}
      <Jack id={id} cx={294} cy={116} r={4.2} />
      <CornerCaps id={id} x={4} y={12} w={312} h={128} s={0.6} fill="#1b1b1d" />
    </>
  );
  return { art, controls: row.controls };
}

function diezel(c: HeadCtx): GearRender {
  const { id, f } = c;
  const steel = { ...f, plate: "black" as const };
  const blue = "#4aa3ff";
  const row = knobRow(c, { x0: 96, x1: 250, cy: 106, r: 6, labelY: 124, labelColor: blue, dark: true, insert: "#cfd5de", lit: blue, ink: "#9fc9ff", labelSize: 3.3 });
  const art = (
    <>
      <Defs id={id} body={f.tolex} />
      <AmpDefs id={id} f={steel} />
      <Feet />
      <Handle id={id} x1={108} x2={212} y={1} kind="chrome" />
      <TolexBody id={id} k="d" x={4} y={12} w={312} h={128} rx={4} f={f} />
      <Plate id={id} k="d" x={10} y={18} w={300} h={116} rx={2.5} f={steel} />
      <defs>
        <pattern id={`dz${id}`} width="7" height="7" patternUnits="userSpaceOnUse">
          <rect width="7" height="7" fill="#0a0b0d" />
          <circle cx="3.5" cy="3.5" r="2.2" fill="#14171c" stroke="#fff" strokeOpacity=".08" strokeWidth=".4" />
        </pattern>
      </defs>
      <rect x={20} y={26} width={280} height={42} rx={2} fill={`url(#dz${id})`} />
      <rect x={20} y={26} width={280} height={42} rx={2} fill="none" stroke={`url(#steel${id})`} strokeWidth={1.1} />
      <rect x={118} y={36} width={84} height={22} rx={3} fill="#050607" stroke={blue} strokeOpacity={0.9} strokeWidth={0.9} />
      <Logo x={160} y={52} name={c.name} fill={blue} size={13} maxW={74} shadow="#0b2a55" />
      <path d="M20 78H300" stroke={blue} strokeOpacity={0.55} strokeWidth={0.6} />
      <Switches c={c} y={104} xs={[34, 52]} lamp={70} ink="#9fc9ff" />
      {row.nodes}
      <Jack id={id} cx={292} cy={106} r={4.2} />
      <CornerCaps id={id} x={4} y={12} w={312} h={128} s={0.7} fill="#16161a" />
    </>
  );
  return { art, controls: row.controls };
}

export const HEAD_TEMPLATES: Record<Exclude<HeadTemplate, "classic">, (c: HeadCtx) => GearRender> = { marshall, orange, mesa, chrome, peavey, diezel };
