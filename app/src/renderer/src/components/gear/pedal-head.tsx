import type { BlockCode } from "@/state/device-types";
import { BlockTag, Nameplate, T } from "./parts";
import type { PedalStyle } from "./pedal-styles";

/** The name on a pedal as its maker prints it: black label strip, script, or the stamped default; plus the printed `sub` line. */
export function PedalHead({ look, name, block, ink, light, treadle, subAbove }: { look: PedalStyle; name: string; block: BlockCode; ink: string; light: boolean; treadle?: boolean; subAbove?: boolean }) {
  const lblW = 76;
  return (
    <>
      {look.label === "strip" ? (
        <g>
          <rect x="12" y="11" width={lblW} height="13" rx="2" fill="#0d0d0f" stroke="#fff" strokeOpacity={0.18} strokeWidth={0.4} />
          <T x={50} y={20.6} fill="#f4f4f4" size={Math.min(8.4, (lblW - 8) / (name.length * 0.62))} weight={look.fontWeight ?? 700} spacing={0.5} family={look.font}>
            {name.toUpperCase()}
          </T>
        </g>
      ) : look.label === "script" ? (
        <T x={50} y={treadle ? 20 : 21} fill={ink} size={Math.min(look.font ? 11.5 : 10.5, (Math.min(80, look.w - 16)) / (name.length * 0.6))} weight={look.fontWeight ?? 800} italic={!look.font} spacing={0.1} family={look.font}>
          {name}
        </T>
      ) : (
        <Nameplate x={12} y={19} name={name} ink={ink} light={light} family={look.font} />
      )}
      {look.label === "stamp" && <BlockTag x={88} y={19} code={block} ink={ink} />}
      {look.sub && !treadle && (
        <T x={50} y={subAbove ? 8.6 : look.label === "strip" ? 31 : 28.4} fill={ink} size={3.8} weight={700} opacity={0.75} spacing={0.9} family={look.labelFont}>
          {look.sub}
        </T>
      )}
    </>
  );
}
