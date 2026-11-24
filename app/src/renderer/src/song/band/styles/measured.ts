import country from "./data/country.groove.json";
import funk from "./data/funk.groove.json";
import pop from "./data/pop.groove.json";
import reggae from "./data/reggae.groove.json";
import rock from "./data/rock.groove.json";
import shuffle from "./data/shuffle.groove.json";
import { ENERGIES, type DrumGroove, type DrumPattern, type Energy, type Style, type StyleId } from "./types";

export type MeasuredGroup = "kick" | "snare" | "hats" | "toms";
type FeelCell = readonly [offsetMsAt120: number, medianDeviationMsAt120: number, relativeVelocity: number];

interface MeasuredData {
  grooves: Record<Energy, DrumGroove[]>;
  fills: Style["fills"];
  feel: Record<string, Record<string, FeelCell>>;
}

const measured: Partial<Record<StyleId, MeasuredData>> = { country, funk, pop, reggae, rock, shuffle } as unknown as Partial<Record<StyleId, MeasuredData>>;
const styles = new WeakMap<Style, Style>();

/** Keep legacy style arrays intact and add measured variations for the current drum engine. */
export function withMeasuredPatterns(style: Style): Style {
  const data = measured[style.id];
  if (!data) return style;
  const cached = styles.get(style);
  if (cached) return cached;

  const addFills = (size: keyof Style["fills"]): DrumPattern[] => [...style.fills[size], ...data.fills[size]];
  const grooves = { ...style.grooves };
  for (const energy of ENERGIES) grooves[energy] = [...grooves[energy], ...data.grooves[energy]];
  const enriched = { ...style, grooves, fills: { short: addFills("short"), half: addFills("half"), bar: addFills("bar") } };
  styles.set(style, enriched);
  return enriched;
}

export function measuredFeel(id: StyleId, beatsPerBar: number, stepsPerBeat: number, step: number, group: MeasuredGroup): FeelCell | undefined {
  return measured[id]?.feel[`${beatsPerBar}:${stepsPerBeat}`]?.[`${step}:${group}`];
}
