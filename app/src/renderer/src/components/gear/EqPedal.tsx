import type { ReactNode } from "react";
import { BLOCK_HEX, fit, lum } from "./art";
import { Jewel } from "./amp-parts";
import { PedalHead } from "./pedal-head";
import { pedalStyle } from "./pedal-styles";
import { GearFrame, type Control } from "./controls";
import { formatValue } from "./knob-math";
import { Defs, Enclosure, FootswitchArt, KnobArt, LightBar, Nameplate, Screw, T } from "./parts";
import { paramTitle, type GearBaseProps, type GearKnob } from "./types";

/** The faders (up to 6 bands) and the volume knob an EQ drawing has room for. */
export const eqControls = (all: readonly GearKnob[]) => ({ bands: all.filter((b) => !/^vol/i.test(b.label)).slice(0, 6), vol: all.find((b) => /^vol/i.test(b.label)) });

export type EqPedalProps = GearBaseProps & {
  /** The real pedal it models: with the name, it picks the colour, size, typeface and sliders */
  origin?: string;
};

/** Graphic EQ pedal: a maker's look per model, vertical faders −50…50 per band, small volume knob when the model has one. */
export function EqPedal({ name, origin, on = true, knobs = [], interactive, disabled, showValues, focus, onKnobChange, onToggleOn, scaled, className, style: baseStyle }: EqPedalProps) {
  const look = pedalStyle(name, origin, "EQ");
  const W = look.w;
  const H = look.h + (look.sub ? 6 : 0);
  const ox = (W - 100) / 2;
  const bd = H - 150;
  const kd = bd * 0.35 + (look.sub ? 5 : 0);
  const style = scaled ? { ...baseStyle, width: `calc(var(--gw) * ${((W / 100) * Math.min(1, 150 / H)).toFixed(3)})` } : baseStyle;
  const accent = look.accent ?? BLOCK_HEX.EQ;
  const body = look.body ?? "#1a1a1d";
  const light = lum(body) > 0.6;
  const ink = look.ink ?? (light ? "#1c1c1e" : "#ffffff");
  const well = look.panel?.color ?? "rgba(0,0,0,.4)";
  const wellDark = look.panel ? lum(look.panel.color) < 0.5 : !light;
  const lab = wellDark ? "#f2f2f2" : "#1c1c1e";
  const capColor = look.cap ?? "#f4f5f7";
  return (
    <GearFrame
      view={[W, H]}
      label={`${name} graphic EQ pedal, ${on ? "on" : "bypassed"}`}
      interactive={interactive}
      disabled={disabled}
      className={className}
      style={style}
      render={(id, active) => {
        const controls: Control[] = [];
        const { bands, vol } = eqControls(knobs);
        const n = bands.length || 5;
        const x0 = 22;
        const x1 = vol ? 61 : 78;
        const gap = (x1 - x0) / (n - 1 || 1);
        const focusId = active ?? focus;
        const faders: ReactNode[] = bands.map((b, i) => {
          const x = x0 + i * gap;
          const y = 63 - (Math.max(-50, Math.min(50, b.value)) / 50) * 26;
          const foc = b.id === focusId;
          controls.push({ kind: "slider", fader: true, id: b.id, label: `${name} ${b.label}`, value: b.value, spec: b, onChange: onKnobChange && ((v) => onKnobChange(b.id, v)), x: x - 5, y: 33, w: 10, h: 60 });
          return (
            <g key={b.id}>
              <rect x={x - 0.8} y="35" width="1.6" height="56" rx=".8" fill={lab} fillOpacity={0.2} />
              <rect x={x - 0.8} y={Math.min(y, 63)} width="1.6" height={Math.abs(63 - y)} fill={accent} />
              {look.sliderCap === "block" ? (
                <rect x={x - 4.2} y={y - 3.4} width="8.4" height="6.8" rx="1.2" fill={capColor} stroke={foc ? "#fff" : "#000"} strokeOpacity={foc ? 1 : 0.4} strokeWidth={foc ? 1.2 : 0.4} />
              ) : look.sliderCap === "round" ? (
                <circle cx={x} cy={y} r="3.8" fill={capColor} stroke={foc ? "#fff" : "#000"} strokeOpacity={foc ? 1 : 0.4} strokeWidth={foc ? 1.2 : 0.4} />
              ) : (
                <rect x={x - 5} y={y - 2.4} width="10" height="4.8" rx="2.4" fill={capColor} stroke={foc ? "#fff" : "none"} strokeWidth={foc ? 1.2 : 0} />
              )}
              <rect x={x - 3} y={y - 0.35} width="6" height="0.7" fill="#000" fillOpacity={0.45} />
              {foc && (
                <g>
                  <rect x={x - 7} y={y - 12} width={14} height={7.5} rx={3.75} fill="#fff" />
                  <T x={x} y={y - 6.6} fill="#111" size={5} weight={700}>
                    {formatValue(b.value, b)}
                  </T>
                </g>
              )}
              <T x={x} y={106} fill={lab} size={fit(b.label, 11, 4.4)} opacity={0.75} family={look.labelFont}>
                {b.label.replace(/Hz$/, "")}
              </T>
              {showValues && (
                <T x={x} y={112} fill={lab} size={4.4} weight={650}>
                  {formatValue(b.value, b)}
                </T>
              )}
            </g>
          );
        });
        if (vol) controls.push({ kind: "slider", id: vol.id, label: `${name} ${paramTitle(vol.label)}`, value: vol.value, spec: vol, onChange: onKnobChange && ((v) => onKnobChange(vol.id, v)), x: 69, y: 54, w: 18, h: 18 });
        controls.push({ kind: "fs", id: "fs", label: `${name} EQ`, on, onToggle: onToggleOn, x: 37.5, y: 119.5, w: 25, h: 25 });
        for (const c of controls) {
          c.x += ox;
          c.y += c.kind === "fs" ? bd : kd;
        }
        const f = look.finish ?? "noir";
        const art = (
          <>
            <Defs id={id} body={body} />
            <Enclosure id={id} light={light} kind={f} w={W} h={H} rx={look.rx} />
            {f === "noir" && !look.bands && (
              <>
                <clipPath id={`clip${id}`}>
                  <rect x="4" y="3" width={W - 8} height={H - 6} rx={look.rx} />
                </clipPath>
                <rect x="4" y="3" width={W - 8} height="5" fill={accent} clipPath={`url(#clip${id})`} />
              </>
            )}
            {look.bands?.length ? (
              <g clipPath={`url(#encl${id})`}>
                {look.bands.map(([y, bh, col], i) => (
                  <rect key={i} x="4" y={y > 100 ? y + bd : y} width={W - 8} height={bh} fill={col} />
                ))}
              </g>
            ) : null}
            <g transform={`translate(${ox} 0)`}>
              <PedalHead look={look} name={name} block="EQ" ink={ink} light={light} />
              <Screw id={id} cx={12} cy={H - 9} turn={20} />
              <Screw id={id} cx={88} cy={H - 9} turn={110} />
              <g transform={`translate(0 ${kd})`}>
                <rect x="12" y="28" width="76" height="70" rx="8" fill={well} stroke={look.panel?.border ?? "#fff"} strokeOpacity={look.panel?.border ? 0.85 : 0.08} strokeWidth={0.6} />
                <line x1="16" x2={vol ? 70 : 84} y1="63" y2="63" stroke={lab} strokeOpacity={0.14} strokeDasharray="1.5 2" />
                {faders}
                {vol && (
                  <g>
                    <KnobArt id={id} cx={78} cy={63} r={4.4} value={vol.value} min={vol.min} max={vol.max} dark={look.darkKnobs ?? true} ring={accent} track="rgba(255,255,255,.14)" focus={vol.id === focusId} />
                    <T x={78} y={76} fill={lab} size={4} opacity={0.7} family={look.labelFont}>
                      VOL
                    </T>
                  </g>
                )}
              </g>
              <g transform={`translate(0 ${bd})`}>
                {look.jewel ? <Jewel id={id} cx={50} cy={showValues ? 114 : 111} on={on} r={2.8} /> : <LightBar cx={50} cy={showValues ? 119 : 116} on={on} color={accent} />}
                <FootswitchArt id={id} cx={50} cy={132} r={9.5} />
              </g>
            </g>
          </>
        );
        return { art, controls };
      }}
    />
  );
}

export interface CaptureProps extends GearBaseProps {
  /** TONE3000 tone image URL; without it the drawing shows a generic waveform */
  image?: string;
  /** Sub-label under the screen, e.g. "SnapTone" or "TONE3000" */
  caption?: string;
  /** Block that plays the capture: NS on the GP-5 family, AMP or DST on the GP-200 family */
  block?: string;
}

/** SnapTone capture unit: screen with the tone image or a waveform, light pipe, footswitch. */
export function Capture({ name, on = true, image, caption = "SnapTone", block = "NS", interactive, disabled, onToggleOn, className, style }: CaptureProps) {
  const color = BLOCK_HEX.NS;
  return (
    <GearFrame
      view={[100, 150]}
      label={`${name} capture, ${on ? "on" : "off"}`}
      interactive={interactive}
      disabled={disabled}
      className={className}
      style={style}
      render={(id) => {
        const wave = "M18 56h9l5-15 7 30 7-36 7 40 6-26 5 7h18";
        const art = (
          <>
            <Defs id={id} body="#151518" />
            <clipPath id={`ci${id}`}>
              <rect x="12" y="24" width="76" height="62" rx="8" />
            </clipPath>
            <Enclosure id={id} kind="noir" />
            <Nameplate x={12} y={17} name={name} ink="#fff" light={false} maxW={56} />
            <Screw id={id} cx={12} cy={141} turn={20} />
            <Screw id={id} cx={88} cy={141} turn={110} />
            <T x={88} y={16.6} fill="#fff" size={5.2} anchor="end" opacity={0.5}>
              {block}
            </T>
            <rect x="11" y="23" width="78" height="64" rx="9" fill="#050506" stroke="#fff" strokeOpacity={0.1} strokeWidth={0.6} />
            {image ? (
              <image href={image} x="12" y="24" width="76" height="62" preserveAspectRatio="xMidYMid slice" clipPath={`url(#ci${id})`} />
            ) : (
              <>
                <path d={wave} fill="none" stroke={color} strokeWidth={4.2} strokeLinejoin="round" strokeLinecap="round" opacity={on ? 0.22 : 0.08} />
                <path d={wave} fill="none" stroke={on ? color : "#4a4a50"} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
              </>
            )}
            <T x={50} y={100} fill={on ? color : "#8a8a90"} size={5.4} weight={700} spacing={0.9}>
              {caption.toUpperCase()}
            </T>
            <LightBar cx={50} cy={116} on={on} color={color} />
            <FootswitchArt id={id} cx={50} cy={132} r={9.5} />
          </>
        );
        return { art, controls: [{ kind: "fs", id: "fs", label: `${name} ${block}`, on, onToggle: onToggleOn, x: 37.5, y: 119.5, w: 25, h: 25 }] };
      }}
    />
  );
}
