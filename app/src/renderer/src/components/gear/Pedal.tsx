import type { ReactNode } from "react";
import type { BlockCode } from "@/state/device-types";
import { BLOCK_HEX, finishFor, fit, hash, lum, shade, type Finish } from "./art";
import { PedalHead } from "./pedal-head";
import { pedalStyle } from "./pedal-styles";
import { GearFrame, type Control } from "./controls";
import { formatValue } from "./knob-math";
import { Jewel } from "./amp-parts";
import { Defs, Enclosure, FootswitchArt, KnobArt, LightBar, Screw, SlideSwitch, T } from "./parts";
import { paramTitle, type GearBaseProps, type GearKnob } from "./types";

export type PedalLayout = "row" | "hero" | "tri" | "grid" | "dense";

export interface PedalProps extends GearBaseProps {
  block: BlockCode;
  finish?: Finish;
  /** Hue override */
  color?: string;
  /** The real pedal it models: with the name, it picks the colour, size and details */
  origin?: string;
  layout?: PedalLayout;
}

const isBipolar = (k: GearKnob) => k.min < 0 && k.max > 0;

/** The knobs and switches a pedal drawing has room for (up to 9 and 3, e.g. GP-50 Sweep Eko: S-Sync, D-Sync, Trail). */
export const pedalControls = (all: readonly GearKnob[]) => ({ knobs: all.filter((k) => !k.toggle).slice(0, 9), toggles: all.filter((k) => k.toggle).slice(0, 3) });

/** Stompbox: matte/noir/frost enclosure, machined knobs with LED value rings, light pipe, steel footswitch. */
export function Pedal(props: PedalProps) {
  const { block, name, on = true, knobs: all = [], interactive, disabled, showValues, focus, onKnobChange, onToggleOn, finish, color, origin, layout: want, scaled, className, style: baseStyle } = props;
  const look = pedalStyle(name, origin, block);
  // knobs need room: a mini enclosure with many of them grows
  const nk = pedalControls(all).knobs.length;
  const W = Math.max(look.w, nk >= 4 ? 96 : nk === 3 ? 86 : 0);
  const nt = pedalControls(all).toggles.length;
  // many knobs or a row of switches need a taller enclosure to stay clear of each other and of the LED
  const H = Math.max(look.h, nk >= 7 ? 204 : nk >= 5 ? 176 : 0) + (nt && nk >= 2 ? 12 : 0) + (look.sub ? 6 : 0);
  const ox = (W - 100) / 2;
  const bd = H - 150;
  const style = scaled ? { ...baseStyle, width: `calc(var(--gw) * ${((W / 100) * Math.min(1, 150 / H)).toFixed(3)})` } : baseStyle;
  return (
    <GearFrame
      view={[W, H]}
      label={`${name} ${block} pedal, ${on ? "on" : "bypassed"}`}
      interactive={interactive}
      disabled={disabled}
      className={className}
      style={style}
      render={(id, active) => {
        const controls: Control[] = [];
        const { knobs, toggles } = pedalControls(all);
        const h = hash(name);
        const f = look.body ? { kind: look.finish ?? "matte", body: look.body, accent: look.accent ?? "#1c1c1e" } : finishFor(name, BLOCK_HEX[block], h, finish, color);
        const light = lum(f.body) > 0.6;
        const ink = look.ink ?? (light ? "#1c1c1e" : "#ffffff");
        const panelDark = look.panel ? lum(look.panel.color) < 0.5 : null;
        // labels and rings sit on the panel when the pedal has one
        const lab = panelDark === null ? ink : panelDark ? "#f2f2f2" : "#1c1c1e";
        const ring = look.panel ? (f.kind === "noir" ? f.accent : lab) : f.kind === "noir" ? f.accent : light ? "#1c1c1e" : "#ffffff";
        const track = (panelDark === null ? light : !panelDark) ? "rgba(0,0,0,.16)" : "rgba(255,255,255,.18)";
        const capFill = look.cap ? `url(#ktone${id})` : undefined;
        const darkCaps = look.cap ? lum(look.cap) < 0.5 : look.darkKnobs !== undefined ? look.darkKnobs : f.kind === "frost" ? true : f.kind === "noir" ? false : (h >>> 6) % 2 === 0;
        const hasT = toggles.length > 0;
        const picked: PedalLayout =
          knobs.length > 4
            ? "dense"
            : ((want ?? (look.layout === "row" && knobs.length > 3 ? undefined : look.layout)) ?? (knobs.length <= 1 ? "hero" : knobs.length === 3 ? (["tri", "row"] as const)[(h >>> 4) % 2] : knobs.length === 4 ? "grid" : (["row", "hero"] as const)[(h >>> 4) % 2]));
        // A big knob over small ones leaves no room for a switch row: their labels would sit under the knobs.
        const layout: PedalLayout = picked === "hero" && hasT && knobs.length > 1 ? "row" : picked;
        const focusId = active ?? focus;
        const parts: ReactNode[] = [];

        const narrow = Math.min(1.5, (W - 26) / 74);
        // vertical extent of the controls as laid out (before centring in the free space)
        const ext = { top: 999, bot: -999 };
        const K = (k: GearKnob, x0: number, y: number, r0: number) => {
          const x = 50 + (x0 - 50) * narrow;
          const r = r0 * Math.min(1, 0.55 + narrow * 0.45);
          const foc = k.id === focusId;
          const shown = formatValue(k.value, k);
          controls.push({
            kind: "slider",
            id: k.id,
            label: `${name} ${paramTitle(k.label)}`,
            value: k.value,
            spec: k,
            onChange: onKnobChange && ((v) => onKnobChange(k.id, v)),
            x: x - r - 5,
            y: y - r - 5,
            w: 2 * r + 10,
            h: 2 * r + 10,
          });
          const ly = y + r + 10.2;
          ext.top = Math.min(ext.top, y - r - 6);
          ext.bot = Math.max(ext.bot, ly + 2 + (showValues ? 6.4 : 0));
          parts.push(
            <g key={`k${k.id}`}>
              <KnobArt id={id} cx={x} cy={y} r={r} value={k.value} min={k.min} max={k.max} dark={darkCaps} ring={ring} track={track} focus={foc} bipolar={isBipolar(k)} capFill={capFill} />
              <T x={x} y={ly} fill={lab} size={look.labelFont ? 5 : 4.6} opacity={0.85} spacing={look.labelFont ? 0.3 : 0.45} weight={look.labelFont ? 700 : 650} family={look.labelFont}>
                {k.label.toUpperCase()}
              </T>
              {showValues && (
                <T x={x} y={ly + 6.4} fill={ink} size={5.4} weight={650}>
                  {shown}
                </T>
              )}
              {foc && (
                <g>
                  <rect x={x - 9.5} y={y - r - 16} width={19} height={9} rx={4.5} fill="#fff" />
                  <T x={x} y={y - r - 9.4} fill="#111" size={fit(shown, 17, 5.6)} weight={700}>
                    {shown}
                  </T>
                </g>
              )}
            </g>,
          );
        };

        let ty = 86;
        if (layout === "hero" && knobs.length) {
          // with switches the hero has a single knob (see `layout`), raised so its label clears the switch row
          const rest = knobs.slice(1);
          K(knobs[0], 50, hasT ? 48 : 54, hasT ? 14 : 15.5);
          rest.forEach((k, i) => K(k, rest.length === 1 ? 50 : 24 + i * (52 / Math.max(1, rest.length - 1)), 92, 7.5));
          ty = 92;
        } else if (layout === "tri") {
          const pos = hasT ? [[27, 38], [73, 38], [50, 70]] : [[27, 40], [73, 40], [50, 74]];
          knobs.slice(0, 3).forEach((k, i) => K(k, pos[i][0], pos[i][1], hasT ? 7.8 : 8.6));
          ty = 102;
        } else if (layout === "grid") {
          const pos = hasT ? [[30, 37], [70, 37], [30, 69], [70, 69]] : [[30, 44], [70, 44], [30, 84], [70, 84]];
          knobs.slice(0, 4).forEach((k, i) => K(k, pos[i][0], pos[i][1], hasT ? 7.2 : 8.4));
          ty = 102;
        } else if (layout === "dense") {
          // more than four knobs: three columns of small knobs
          const rows = Math.ceil(knobs.length / 3);
          const grow = Math.max(0, bd - 10);
          const dy = (rows > 2 ? 24 : 30) + grow * (rows > 2 ? 0.34 : 0.3);
          knobs.forEach((k, i) => {
            const row = Math.floor(i / 3);
            const inRow = Math.min(3, knobs.length - row * 3);
            const x = inRow === 1 ? 50 : 22 + (56 * (i % 3)) / (inRow - 1);
            K(k, x, 34 + row * dy, (rows > 2 ? 4.8 : 6.2) + Math.min(1.6, grow / 40));
          });
          ty = 34 + rows * dy + (rows > 2 ? 2 : 0);
        } else {
          const n = Math.max(1, knobs.length);
          const r = n >= 3 ? 7.2 : 11;
          knobs.forEach((k, i) => K(k, n === 1 ? 50 : n >= 3 ? 19 + (62 * i) / (n - 1) : 22 + (56 * i) / (n - 1), 50, r));
          ty = 88;
        }
        const tall = hasT && ty > 96;
        const lbY = tall ? 121 : 116;
        const fsY = tall ? 136 : 132;
        const fsR = lbY > 116 ? 8.5 : 9.5;
        toggles.forEach((t, i) => {
          const cx = toggles.length === 1 ? 50 : toggles.length === 2 ? 36 + i * 28 : 24 + i * 26;
          const tOn = t.value >= 0.5;
          controls.push({
            kind: "switch",
            id: t.id,
            label: `${name} ${paramTitle(t.label)}`,
            on: tOn,
            onToggle: onKnobChange && ((v) => onKnobChange(t.id, v ? 1 : 0)),
            x: cx - 11,
            y: ty - 8,
            w: 22,
            h: 16,
          });
          ext.top = Math.min(ext.top, ty - 6);
          ext.bot = Math.max(ext.bot, ty + 13);
          parts.push(<SlideSwitch key={`t${t.id}`} cx={cx} cy={ty} on={tOn} ink={lab} label={t.label} accent={f.kind === "matte" ? (light ? "#1c1c1e" : "rgba(255,255,255,.9)") : f.accent} />);
        });
        controls.push({ kind: "fs", id: "fs", label: `${name} ${block}`, on, onToggle: onToggleOn, x: 50 - fsR - 3, y: fsY - fsR - 3, w: 2 * fsR + 6, h: 2 * fsR + 6 });

        // centre the controls between the name and the LED/footswitch
        const coverName0 = !!look.cover && look.label !== "stamp";
        const regTop = look.treadle ? 26 + look.treadle + 40 : coverName0 ? 18 : 31 + (look.sub ? 5 : 0);
        const regBot = coverName0 ? fsY + bd - 46 : lbY + bd - 10;
        const kd = Math.max(regTop - 8 - ext.top, (regTop + regBot) / 2 - (ext.top + ext.bot) / 2);
        for (const c of controls) {
          c.x += ox;
          c.y += c.kind === "fs" ? bd : kd;
        }
        const ex = (W - 100) / 2;
        // a hinged cover takes the lower third: the name sits on it, as on a Boss compact, the LED goes to the top
        const coverName = !!look.cover && look.label !== "stamp";
        const art = (
          <>
            <Defs id={id} body={f.body} />
            <Enclosure id={id} light={light} kind={f.kind} w={W} h={H} rx={look.rx} />
            <path d={`M${look.rx + 3} 3.6h${W - 2 * look.rx - 6}`} stroke="#fff" strokeOpacity={light ? 0.9 : 0.32} strokeWidth={0.8} strokeLinecap="round" />
            {f.kind === "noir" && (
              <>
                <clipPath id={`clip${id}`}>
                  <rect x="4" y="3" width={W - 8} height={H - 6} rx={look.rx} />
                </clipPath>
                <rect x="4" y="3" width={W - 8} height="5" fill={f.accent} clipPath={`url(#clip${id})`} />
              </>
            )}
            {f.kind === "frost" && <rect x="12" y="25" width={W - 24} height="1.2" rx=".6" fill={f.accent} />}
            {look.cap && (
              <defs>
                <radialGradient id={`ktone${id}`} cx=".42" cy=".35" r=".75">
                  <stop offset="0" stopColor={shade(look.cap, 0.4)} />
                  <stop offset=".7" stopColor={look.cap} />
                  <stop offset="1" stopColor={shade(look.cap, -0.3)} />
                </radialGradient>
              </defs>
            )}
            {look.bands?.length ? (
              <g clipPath={`url(#encl${id})`}>
                {look.bands.map(([y, bh, col], i) => (
                  <rect key={i} x="4" y={y > 100 ? y + bd : y} width={W - 8} height={bh} fill={col} />
                ))}
              </g>
            ) : null}
            <g transform={`translate(${ex} 0)`}>
              {look.treadle ? (
                <g>
                  <rect x="14" y="26" width="72" height={look.treadle + kd * 0 + 38} rx="7" fill="#000" fillOpacity={0.4} transform="translate(0 1.4)" />
                  <rect x="14" y="26" width="72" height={look.treadle + 38} rx="7" fill={look.treadleColor ?? (f.kind === "frost" ? "#1d1d20" : "#0b0b0d")} stroke="#fff" strokeOpacity={0.14} strokeWidth={0.6} />
                  {Array.from({ length: Math.floor((look.treadle + 28) / 4.4) }, (_, i) => (
                    <rect key={i} x="18" y={31 + i * 4.4} width="64" height="2" rx="1" fill="#fff" fillOpacity={0.2} />
                  ))}
                </g>
              ) : null}
              <g transform={`translate(0 ${coverName ? fsY + bd - 41 : 0})`}>
                <PedalHead look={look} name={name} block={block} ink={ink} light={light} treadle={!!look.treadle} subAbove={coverName} />
              </g>
              {coverName && look.jewel && <Jewel id={id} cx={50} cy={15} on={on} r={2.8} />}
              <Screw id={id} cx={12} cy={H - 9} turn={(h >>> 3) % 180} />
              <Screw id={id} cx={88} cy={H - 9} turn={(h >>> 11) % 180} />
              <g transform={`translate(0 ${kd})`}>
                {look.panel && (
                  <g>
                    <rect x={9 - ex} y={(look.panel.y ?? 27) + 0.8} width={W - 18} height={look.panel.h ?? ty + 17 - 27} rx={Math.min(6, look.rx)} fill="#000" fillOpacity={0.3} />
                    <rect x={9 - ex} y={look.panel.y ?? 27} width={W - 18} height={look.panel.h ?? ty + 17 - 27} rx={Math.min(6, look.rx)} fill={look.panel.color} stroke={look.panel.border ?? "#fff"} strokeOpacity={look.panel.border ? 0.85 : 0.14} strokeWidth={look.panel.border ? 0.7 : 0.5} />
                  </g>
                )}
                {parts}
              </g>
              <g transform={`translate(0 ${bd})`}>
                {look.cover && (
                  <g>
                    <rect x="14" y={fsY - 13} width="72" height="29" rx="5" fill="#000" fillOpacity={0.4} transform="translate(0 1.2)" />
                    <rect x="14" y={fsY - 13} width="72" height="29" rx="5" fill="#0e0e10" stroke="#fff" strokeOpacity={0.16} strokeWidth={0.5} />
                    {[0, 1, 2].map((i) => (
                      <rect key={i} x="19" y={fsY - 8 + i * 6.4} width="62" height="1.6" rx=".8" fill="#fff" fillOpacity={0.1} />
                    ))}
                  </g>
                )}
                {look.jewel ? coverName ? null : <Jewel id={id} cx={50} cy={lbY - 5} on={on} r={2.8} /> : <LightBar cx={50} cy={lbY} on={on} color={f.kind === "matte" ? (light ? "#1c1c1e" : "#ffffff") : f.accent} />}
                <FootswitchArt id={id} cx={50} cy={fsY} r={fsR} />
              </g>
            </g>
          </>
        );
        return { art, controls };
      }}
    />
  );
}
