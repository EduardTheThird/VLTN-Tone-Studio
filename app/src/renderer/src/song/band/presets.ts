import type { BandSettings } from "./arrangement";
import { DEFAULT_KEYS } from "./keys-types";

type PresetSettings = Pick<BandSettings, "style" | "kit" | "swing" | "humanise" | "bassSound" | "bassSampleVersion" |
  "keys" | "synthPreset" | "parts" | "percussionAuto">;

const common = {
  bassSampleVersion: 2, bassSound: "fingers", percussionAuto: false,
  keys: DEFAULT_KEYS, synthPreset: "warm",
  parts: { drums: true, bass: true, keys: false, synth: false },
} as const;

export const BAND_PRESETS = {
  funk: { name: "Tight funk band", settings: { ...common, style: "funk", kit: "standard", swing: 0, humanise: { feel: "tight", amount: 0.55 } } },
  rock: { name: "Big rock band", settings: { ...common, style: "rock", kit: "rock", swing: 0, humanise: { feel: "drummer", amount: 0.6 }, bassSound: "pick" } },
  ballad: { name: "Soft ballad trio", settings: { ...common, style: "ballad", kit: "standard", swing: 0, humanise: { feel: "laid-back", amount: 0.55 },
    keys: { ...DEFAULT_KEYS, sound: "piano" }, parts: { ...common.parts, keys: true } } },
  reggae: { name: "Reggae band", settings: { ...common, style: "reggae", kit: "standard", swing: 0.08, humanise: { feel: "laid-back", amount: 0.65 },
    keys: { ...DEFAULT_KEYS, sound: "organ", left: "rest" }, parts: { ...common.parts, keys: true } } },
  country: { name: "Country band", settings: { ...common, style: "country", kit: "standard", swing: 0.14, humanise: { feel: "natural", amount: 0.45 },
    keys: { ...DEFAULT_KEYS, sound: "piano" }, bassSound: "pick", parts: { ...common.parts, keys: true } } },
  worship: { name: "Worship band", settings: { ...common, style: "pop", kit: "standard", swing: 0, humanise: { feel: "style", amount: 0.55 },
    percussionAuto: true, keys: { ...DEFAULT_KEYS, sound: "piano" }, parts: { ...common.parts, keys: true, synth: true } } },
} as const satisfies Record<string, { name: string; settings: PresetSettings }>;

export type BandPresetId = keyof typeof BAND_PRESETS;

export function applyBandPreset(settings: BandSettings, preset: BandPresetId): BandSettings {
  return { ...settings, ...BAND_PRESETS[preset].settings };
}
