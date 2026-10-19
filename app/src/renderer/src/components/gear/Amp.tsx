import type { ReactNode } from "react";
import { ampFinish, fit, voiceFor, voicingOf } from "./art";
import { AmpDefs, AmpKnobArt, Cloth, CornerCaps, Handle, Jewel, Plate, Toggle, TolexBody } from "./amp-parts";
import { GearFrame, type Control } from "./controls";
import { formatValue } from "./knob-math";
import { Defs, T } from "./parts";
import { paramTitle, type GearBaseProps } from "./types";

export interface AmpProps extends GearBaseProps {
  /** Catalog amp type: Clean | Drive | Hi Gain | Bass | Acoustic sets the dress (tolex, cloth, faceplate), voicing colour and label; others show none */
  type?: string;
}

const isBipolar = (min: number, max: number) => min < 0 && max > 0;

/** Amp head: tolex body with strap handle and corner caps, grille cloth with the model's badge, brushed faceplate with scaled knobs and a jewel lamp. */
export function AmpHead({ name, type, on = true, knobs = [], interactive, disabled, focus, onKnobChange, className, style }: AmpProps) {
  return (
    <GearFrame
      view={[240, 120]}
      label={`${name} amplifier head`}
      interactive={interactive}
      disabled={disabled}
      className={className}
      style={style}
      render={(id, active) => {
        const f = ampFinish(type);
        const voice = voiceFor(type);
        const ks = knobs.filter((k) => !k.toggle).slice(0, 7);
        const controls: Control[] = [];
        const x0 = 56;
        const x1 = 208;
        const step = ks.length > 1 ? (x1 - x0) / (ks.length - 1) : 0;
        const focusId = active ?? focus;
        const cy = 86;
        const dials: ReactNode[] = ks.map((k, i) => {
          const x = ks.length === 1 ? (x0 + x1) / 2 : x0 + i * step;
          controls.push({ kind: "slider", id: k.id, label: `${name} ${paramTitle(k.label)}`, value: k.value, spec: k, onChange: onKnobChange && ((v) => onKnobChange(k.id, v)), x: x - 11, y: cy - 11, w: 22, h: 22 });
          return (
            <g key={k.id}>
              <AmpKnobArt id={id} cx={x} cy={cy} r={6.2} value={k.value} min={k.min} max={k.max} lit={voice} ink={f.ink} dark={f.darkKnobs} focus={k.id === focusId} bipolar={isBipolar(k.min, k.max)} />
              <T x={x} y={104.6} fill={f.ink} size={3.9} weight={700} opacity={0.8} spacing={0.35}>
                {paramTitle(k.label).toUpperCase().slice(0, 9)}
              </T>
            </g>
          );
        });
        const badgeSize = fit(name, 84, 6.6);
        const badgeW = Math.min(112, Math.max(40, name.length * badgeSize * 0.56 + 14));
        const art = (
          <>
            <Defs id={id} body={f.tolex} />
            <AmpDefs id={id} f={f} />
            {[22, 206].map((x) => (
              <rect key={x} x={x} y={113.4} width={12} height={5.6} rx={1.6} fill="#0b0b0c" />
            ))}
            <Handle id={id} x1={74} x2={166} y={1} />
            <TolexBody id={id} k="h" x={2} y={8} w={236} h={106} rx={8} f={f} />
            <Cloth id={id} x={11} y={17} w={218} h={42} rx={3} />
            <rect x={19} y={41} width={badgeW} height={11.5} rx={2.4} fill="#000" fillOpacity={0.45} transform="translate(0 .7)" />
            <rect x={19} y={41} width={badgeW} height={11.5} rx={2.4} fill={`url(#steel${id})`} stroke="#000" strokeOpacity={0.5} strokeWidth={0.4} />
            <T x={19 + badgeW / 2} y={49.1} fill="#1b1b1d" size={badgeSize} weight={750} spacing={-0.1} italic>
              {name}
            </T>
            <Plate id={id} k="h" x={10} y={63} w={220} h={46} rx={3.4} f={f} />
            <Jewel id={id} cx={26} cy={cy} on={on} />
            <T x={26} y={104.6} fill={f.ink} size={3.6} weight={700} opacity={0.7} spacing={0.4}>
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

/** Speaker cabinet: tolex body with corner caps and a nameplate, grille cloth over the speakers (1x8, 2x12, 4x12 from the name), "IR" for User IR slots. */
export function Cab({ name, ir, className, style }: Pick<GearBaseProps, "name" | "className" | "style"> & { /** A User IR slot (default: from the name) */ ir?: boolean }) {
  return (
    <GearFrame
      view={[240, 170]}
      label={`${name} speaker cabinet`}
      className={className}
      style={style}
      render={(id) => {
        const m = /(\d)x(\d+)/i.exec(name);
        const isIR = ir ?? /User IR|IR\b/i.test(name);
        const n = m ? Number(m[1]) : isIR ? 0 : 2;
        const f = { ...ampFinish("Hi Gain"), cloth: "#2a2c32" };
        const spots =
          n === 1
            ? [[120, 75, 50]]
            : n === 2
              ? [[70, 75, 44], [170, 75, 44]]
              : n >= 4
                ? [[68, 42, 29], [172, 42, 29], [68, 108, 29], [172, 108, 29]]
                : [];
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
            {[20, 208].map((x) => (
              <rect key={x} x={x} y={162} width={12} height={6.4} rx={1.8} fill="#0b0b0c" />
            ))}
            <TolexBody id={id} k="c" x={2} y={2} w={236} h={161} rx={7} f={f} />
            <rect x={11} y={11} width={218} height={132} rx={3} fill="#030304" />
            {spots.map(([x, y, r]) => (
              <g key={`${x}-${y}`}>
                <circle cx={x} cy={y} r={r + 1.4} fill="#000" />
                <circle cx={x} cy={y} r={r} fill={`url(#cone${id})`} />
                {[0.82, 0.66, 0.5, 0.36].map((k) => (
                  <circle key={k} cx={x} cy={y} r={(r * k).toFixed(1)} fill="none" stroke="#fff" strokeOpacity={0.05} strokeWidth={0.7} />
                ))}
                <circle cx={x} cy={y} r={(r * 0.2).toFixed(1)} fill="#0a0a0b" stroke="#fff" strokeOpacity={0.16} strokeWidth={0.5} />
                <path d={`M${x - r * 0.95} ${y - r * 0.22}A${r} ${r} 0 0 1 ${x - r * 0.25} ${y - r * 0.95}`} fill="none" stroke="#fff" strokeOpacity={0.16} strokeWidth={1.2} strokeLinecap="round" />
              </g>
            ))}
            <Cloth id={id} x={12} y={12} w={216} h={130} rx={2.6} veil={0.6} />
            {spots.map(([x, y, r]) => (
              <circle key={`s${x}-${y}`} cx={x} cy={y} r={r} fill={`url(#bulge${id})`} />
            ))}
            {isIR && (
              <T x={120} y={86} fill="#fff" size={26} weight={800} opacity={0.5} italic>
                IR
              </T>
            )}
            <rect x={120 - plateW / 2} y={147.4} width={plateW} height={11.5} rx={2.4} fill="#000" fillOpacity={0.45} transform="translate(0 .7)" />
            <rect x={120 - plateW / 2} y={147.4} width={plateW} height={11.5} rx={2.4} fill={`url(#steel${id})`} stroke="#000" strokeOpacity={0.5} strokeWidth={0.4} />
            <T x={120} y={155.4} fill="#1b1b1d" size={fit(name, plateW - 8, 6.4)} weight={750} italic>
              {name}
            </T>
            <CornerCaps id={id} x={2} y={2} w={236} h={161} s={0.62} />
          </>
        );
        return { art, controls: [] };
      }}
    />
  );
}

/** Full-width amp control surface (bottom of Rig): faceplate with a jack, bat toggles, scaled knobs with their values above, the model name and power. */
export function AmpPanel({ name, type, on = true, knobs = [], interactive, disabled, focus, onKnobChange, onToggleOn, className, style }: AmpProps) {
  return (
    <GearFrame
      view={[1200, 124]}
      label={`${name} amplifier controls`}
      interactive={interactive}
      disabled={disabled}
      className={className}
      style={style}
      render={(id, active) => {
        const f = ampFinish(type);
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
              <AmpKnobArt id={id} cx={cx} cy={60} r={21} value={k.value} min={k.min} max={k.max} lit={f.plate === "black" ? voice : "#c4231c"} ink={f.ink} dark={f.darkKnobs} focus={foc} bipolar={isBipolar(k.min, k.max)} />
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
            <T x={W - 350} y={86} fill={f.plate === "black" ? voice : f.ink} size={9.5} weight={750} anchor="start" spacing={1.6} opacity={f.plate === "black" ? 1 : 0.75}>
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
