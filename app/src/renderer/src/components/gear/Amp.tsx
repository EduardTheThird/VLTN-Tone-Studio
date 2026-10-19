import type { ReactNode } from "react";
import { ampStyle, fit, voiceFor, voicingOf, type AmpFinish } from "./art";
import { AmpDefs, AmpKnobArt, Cloth, CornerCaps, Handle, Jewel, Plate, Toggle, TolexBody } from "./amp-parts";
import { HEAD_TEMPLATES, HEAD_VIEW } from "./amp-heads";
import { GearFrame, type Control } from "./controls";
import { formatValue } from "./knob-math";
import { Defs, T } from "./parts";
import { paramTitle, type GearBaseProps } from "./types";

export interface AmpProps extends GearBaseProps {
  /** Catalog amp type: Clean | Drive | Hi Gain | Bass | Acoustic sets the dress (tolex, cloth, faceplate), voicing colour and label; others show none */
  type?: string;
  /** The real amp the model is based on: with the name, it picks the look (tolex, cloth, faceplate) */
  origin?: string;
}

const isDark = (f: AmpFinish) => f.plate === "black" || f.plate === "blue";

const isBipolar = (min: number, max: number) => min < 0 && max > 0;

/** Amp head: tolex body with strap handle and corner caps, grille cloth with the model's badge, brushed faceplate with scaled knobs and a jewel lamp. */
export function AmpHead({ name, type, origin, on = true, knobs = [], interactive, disabled, focus, onKnobChange, className, style }: AmpProps) {
  const look = ampStyle(name, origin, type);
  return (
    <GearFrame
      view={look.template === "classic" ? [240, 120] : HEAD_VIEW}
      label={`${name} amplifier head`}
      interactive={interactive}
      disabled={disabled}
      className={className}
      style={style}
      render={(id, active) => {
        const f = look;
        const voice = voiceFor(type);
        const ks = knobs.filter((k) => !k.toggle).slice(0, 7);
        if (f.template !== "classic") return HEAD_TEMPLATES[f.template]({ id, name, f, voice, on, ks, focusId: active ?? focus, onKnobChange });
        const top = f.layout === "top";
        const plateY = top ? 12 : 63;
        const clothY = top ? 64 : 17;
        const controls: Control[] = [];
        const x0 = 56;
        const x1 = 208;
        const step = ks.length > 1 ? (x1 - x0) / (ks.length - 1) : 0;
        const focusId = active ?? focus;
        const cy = plateY + 23;
        const dials: ReactNode[] = ks.map((k, i) => {
          const x = ks.length === 1 ? (x0 + x1) / 2 : x0 + i * step;
          controls.push({ kind: "slider", id: k.id, label: `${name} ${paramTitle(k.label)}`, value: k.value, spec: k, onChange: onKnobChange && ((v) => onKnobChange(k.id, v)), x: x - 11, y: cy - 11, w: 22, h: 22 });
          return (
            <g key={k.id}>
              <AmpKnobArt id={id} cx={x} cy={cy} r={6.2} value={k.value} min={k.min} max={k.max} lit={voice} ink={f.ink} dark={f.darkKnobs} insert={f.knobInsert} focus={k.id === focusId} bipolar={isBipolar(k.min, k.max)} />
              <T x={x} y={plateY + 41.6} fill={f.ink} size={3.9} weight={700} opacity={0.8} spacing={0.35}>
                {paramTitle(k.label).toUpperCase().slice(0, 9)}
              </T>
            </g>
          );
        });
        const badgeSize = fit(name, 84, 6.6);
        const badgeW = Math.min(112, Math.max(40, name.length * badgeSize * 0.56 + 14));
        const bx = f.badge === "left" ? 19 : f.badge === "right" ? 221 - badgeW : 120 - badgeW / 2;
        const by = clothY + 24;
        const art = (
          <>
            <Defs id={id} body={f.tolex} />
            <AmpDefs id={id} f={f} />
            {[22, 206].map((x) => (
              <rect key={x} x={x} y={113.4} width={12} height={5.6} rx={1.6} fill="#0b0b0c" />
            ))}
            <Handle id={id} x1={74} x2={166} y={1} kind={f.handle} />
            <TolexBody id={id} k="h" x={2} y={8} w={236} h={106} rx={8} f={f} />
            <Cloth id={id} x={11} y={clothY} w={218} h={42} rx={3} kind={f.clothKind} />
            <rect x={bx} y={by} width={badgeW} height={11.5} rx={2.4} fill="#000" fillOpacity={0.45} transform="translate(0 .7)" />
            <rect x={bx} y={by} width={badgeW} height={11.5} rx={2.4} fill={`url(#steel${id})`} stroke="#000" strokeOpacity={0.5} strokeWidth={0.4} />
            <T x={bx + badgeW / 2} y={by + 8.1} fill="#1b1b1d" size={badgeSize} weight={750} spacing={-0.1} italic>
              {name}
            </T>
            <Plate id={id} k="h" x={10} y={plateY} w={220} h={46} rx={3.4} f={f} />
            <Jewel id={id} cx={26} cy={cy} on={on} />
            <T x={26} y={plateY + 41.6} fill={f.ink} size={3.6} weight={700} opacity={0.7} spacing={0.4}>
              {on ? "ON" : "STBY"}
            </T>
            {dials}
            <CornerCaps id={id} x={2} y={8} w={236} h={106} s={0.62} />
          </>
        );
        return { art, controls };
      }}
    />
  );
}

export interface CabProps extends Pick<GearBaseProps, "name" | "className" | "style"> {
  /** A User IR slot (default: from the name) */
  ir?: boolean;
  origin?: string;
  /** The amp it stands under: a stack is dressed alike (tolex, cloth, piping) */
  match?: { name: string; origin?: string; type?: string };
}

/** Speaker cabinet. A 4x12 (also the default for a cab that names no speakers) is a tall quad with a handle and casters; 1x and 2x cabs are lower. Dressed like its amp. */
export function Cab({ name, ir, origin, match, className, style }: CabProps) {
  const m = /(\d)x(\d+)/i.exec(name);
  const isIR = ir ?? /User IR|IR\b/i.test(name);
  const n = m ? Number(m[1]) : isIR ? 0 : 4;
  const quad = n >= 4 || n === 0;
  const H = quad ? 214 : 170;
  return (
    <GearFrame
      view={[240, H]}
      label={`${name} speaker cabinet`}
      className={className}
      style={style}
      render={(id) => {
        const f = match ? ampStyle(match.name, match.origin, match.type) : ampStyle(name, origin);
        const frameH = H - 38;
        const mid = 12 + frameH / 2;
        const spots =
          n === 1
            ? [[120, mid, 50]]
            : n === 2
              ? [[70, mid, 44], [170, mid, 44]]
              : [[68, 12 + frameH * 0.25, 36], [172, 12 + frameH * 0.25, 36], [68, 12 + frameH * 0.75, 36], [172, 12 + frameH * 0.75, 36]];
        const plateW = Math.min(104, Math.max(50, name.length * 4.3 + 14));
        const art = (
          <>
            <Defs id={id} body={f.tolex} />
            <AmpDefs id={id} f={f} />
            <defs>
              <radialGradient id={`bulge${id}`} cx=".34" cy=".3" r=".75">
                <stop offset="0" stopColor="#fff" stopOpacity=".16" />
                <stop offset=".55" stopColor="#fff" stopOpacity="0" />
                <stop offset="1" stopColor="#000" stopOpacity=".22" />
              </radialGradient>
              <radialGradient id={`cone${id}`} cx=".5" cy=".5" r=".5">
                <stop offset=".1" stopColor="#6b6e75" />
                <stop offset=".16" stopColor="#202125" />
                <stop offset=".7" stopColor="#2b2c31" />
                <stop offset=".86" stopColor="#0d0d0f" />
                <stop offset="1" stopColor="#050506" />
              </radialGradient>
            </defs>
            {quad ? (
              <>
                <Handle id={id} x1={92} x2={148} y={-3} kind={f.handle === "none" ? "strap" : f.handle} />
                {[20, 220].map((x) => (
                  <g key={x}>
                    <circle cx={x} cy={H - 2} r={4.6} fill="#0b0b0c" />
                    <circle cx={x} cy={H - 2} r={2} fill={`url(#steel${id})`} />
                  </g>
                ))}
              </>
            ) : (
              [20, 208].map((x) => <rect key={x} x={x} y={H - 8} width={12} height={6.4} rx={1.8} fill="#0b0b0c" />)
            )}
            <TolexBody id={id} k="c" x={2} y={2} w={236} h={H - 9} rx={7} f={f} />
            <rect x={11} y={11} width={218} height={frameH + 2} rx={3} fill="#030304" />
            {spots.map(([x, y, r]) => (
              <g key={`${x}-${y}`}>
                <circle cx={x} cy={y} r={r + 1.4} fill="#000" />
                <circle cx={x} cy={y} r={r} fill={`url(#cone${id})`} />
                {[0.82, 0.66, 0.5, 0.36].map((k) => (
                  <circle key={k} cx={x} cy={y} r={(r * k).toFixed(1)} fill="none" stroke="#fff" strokeOpacity={0.05} strokeWidth={0.7} />
                ))}
                <circle cx={x} cy={y} r={(r * 0.2).toFixed(1)} fill="#0a0a0b" stroke="#fff" strokeOpacity={0.16} strokeWidth={0.5} />
                {[45, 135, 225, 315].map((a) => (
                  <circle key={a} cx={x + (r + 0.2) * 0.96 * Math.cos((a * Math.PI) / 180)} cy={y + (r + 0.2) * 0.96 * Math.sin((a * Math.PI) / 180)} r={0.9} fill="#8f949c" />
                ))}
              </g>
            ))}
            <Cloth id={id} x={12} y={12} w={216} h={frameH} rx={2.6} veil={0.6} kind={f.clothKind} />
            {spots.map(([x, y, r]) => (
              <circle key={`s${x}-${y}`} cx={x} cy={y} r={r} fill={`url(#bulge${id})`} />
            ))}
            {isIR && (
              <T x={120} y={mid + 8} fill="#fff" size={26} weight={800} opacity={0.5} italic>
                IR
              </T>
            )}
            <rect x={120 - plateW / 2} y={H - 22.6} width={plateW} height={11.5} rx={2.4} fill="#000" fillOpacity={0.45} transform="translate(0 .7)" />
            <rect x={120 - plateW / 2} y={H - 22.6} width={plateW} height={11.5} rx={2.4} fill={`url(#steel${id})`} stroke="#000" strokeOpacity={0.5} strokeWidth={0.4} />
            <T x={120} y={H - 14.6} fill="#1b1b1d" size={fit(name, plateW - 8, 6.4)} weight={750} italic>
              {name}
            </T>
            <CornerCaps id={id} x={2} y={2} w={236} h={H - 9} s={0.62} />
          </>
        );
        return { art, controls: [] };
      }}
    />
  );
}

/** Full-width amp control surface (bottom of Rig): faceplate with a jack, bat toggles, scaled knobs with their values above, the model name and power. */
export function AmpPanel({ name, type, origin, on = true, knobs = [], interactive, disabled, focus, onKnobChange, onToggleOn, className, style }: AmpProps) {
  return (
    <GearFrame
      view={[1200, 124]}
      label={`${name} amplifier controls`}
      interactive={interactive}
      disabled={disabled}
      className={className}
      style={style}
      render={(id, active) => {
        const f = ampStyle(name, origin, type);
        const voice = voiceFor(type);
        const ks = knobs.filter((k) => !k.toggle).slice(0, 8);
        const tg = knobs.filter((k) => k.toggle).slice(0, 2);
        const W = 1200;
        const H = 124;
        const controls: Control[] = [];
        const parts: ReactNode[] = [];
        const focusId = active ?? focus;
        let x = 130;
        for (const t of tg) {
          const tOn = t.value >= 0.5;
          const cx = x;
          controls.push({ kind: "switch", id: t.id, label: `${name} ${paramTitle(t.label)}`, on: tOn, onToggle: onKnobChange && ((v) => onKnobChange(t.id, v ? 1 : 0)), x: cx - 20, y: 36, w: 40, h: 48 });
          parts.push(
            <g key={t.id}>
              <Toggle id={id} cx={cx} cy={64} on={tOn} s={1.2} />
              <T x={cx} y={104} fill={f.ink} size={10} weight={700} opacity={0.8} spacing={1}>
                {t.label.toUpperCase()}
              </T>
            </g>,
          );
          x += 76;
        }
        const kx0 = x + 34;
        const kx1 = W - 410;
        const step = ks.length > 1 ? (kx1 - kx0) / (ks.length - 1) : 0;
        ks.forEach((k, i) => {
          const cx = ks.length === 1 ? (kx0 + kx1) / 2 : kx0 + i * step;
          const foc = k.id === focusId;
          controls.push({ kind: "slider", id: k.id, label: `${name} ${paramTitle(k.label)}`, value: k.value, spec: k, onChange: onKnobChange && ((v) => onKnobChange(k.id, v)), x: cx - 30, y: 28, w: 60, h: 60 });
          parts.push(
            <g key={k.id}>
              <AmpKnobArt id={id} cx={cx} cy={60} r={21} value={k.value} min={k.min} max={k.max} lit={isDark(f) ? voice : "#c4231c"} ink={f.ink} dark={f.darkKnobs} insert={f.knobInsert} focus={foc} bipolar={isBipolar(k.min, k.max)} />
              <T x={cx} y={104} fill={f.ink} size={10.5} weight={700} opacity={0.82} spacing={1.1}>
                {paramTitle(k.label).toUpperCase()}
              </T>
              <T x={cx} y={17} fill={f.ink} size={11} weight={700} opacity={foc ? 1 : 0.8}>
                {formatValue(k.value, k)}
              </T>
            </g>,
          );
        });
        controls.push({ kind: "fs", id: "power", label: `${name} power`, on, onToggle: onToggleOn, x: W - 100, y: 34, w: 64, h: 54 });
        const voicing = voicingOf(type);
        const typeLabel = voicing ? `${voicing.toUpperCase()} AMP` : "AMP";
        const art = (
          <>
            <Defs id={id} body={f.tolex} />
            <AmpDefs id={id} f={f} />
            <TolexBody id={id} k="p" x={0} y={0} w={W} h={H} rx={14} f={f} />
            <Plate id={id} k="p" x={9} y={8} w={W - 18} h={H - 16} rx={7} f={f} />
            {/* input jack */}
            <circle cx={62} cy={62} r={19} fill="#000" fillOpacity={0.5} />
            <circle cx={62} cy={62} r={17} fill={`url(#steel${id})`} stroke="#000" strokeOpacity={0.5} strokeWidth={0.6} />
            <circle cx={62} cy={62} r={11} fill="#0b0b0d" stroke="#000" strokeOpacity={0.6} />
            <circle cx={62} cy={62} r={6} fill={`url(#steel${id})`} />
            <circle cx={62} cy={62} r={2.6} fill="#050506" />
            <T x={62} y={104} fill={f.ink} size={9.5} weight={700} opacity={0.8} spacing={1.1}>
              INPUT
            </T>
            {parts}
            <path d={`M${W - 380} 30V94`} stroke={f.ink} strokeOpacity={0.3} strokeWidth={1} />
            <T x={W - 350} y={64} fill={f.ink} size={fit(name, 240, 30)} weight={800} anchor="start" spacing={-0.6} italic>
              {name}
            </T>
            <T x={W - 350} y={86} fill={isDark(f) ? voice : f.ink} size={9.5} weight={750} anchor="start" spacing={1.6} opacity={isDark(f) ? 1 : 0.75}>
              {typeLabel}
            </T>
            <Jewel id={id} cx={W - 116} cy={62} on={on} r={4.2} />
            <Toggle id={id} cx={W - 68} cy={62} on={on} s={1.2} />
            <T x={W - 68} y={104} fill={f.ink} size={9} weight={700} opacity={0.8} spacing={1.1}>
              {on ? "ON" : "STANDBY"}
            </T>
          </>
        );
        return { art, controls };
      }}
    />
  );
}
