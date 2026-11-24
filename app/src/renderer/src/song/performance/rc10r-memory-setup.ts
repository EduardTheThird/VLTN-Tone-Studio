import type { Rc10rRhythmField, Rc10rRhythmMemory } from "@shared/rc10r-memory";

export const RC10R_KITS = [
  "Studio", "Live", "Light", "Heavy", "Rock", "Metal", "Jazz", "Brushes", "Cajon", "Drum&Bs", "R&B", "Dance", "Techno", "Dance Beats", "Hiphop", "808+909",
] as const;
export const RC10R_STOP_MODES = {
  immediate: "Immediate", measure: "Measure end", loop: "Loop end", "measure-ending": "Measure end + ending", "loop-ending": "Loop end + ending", fade: "Fade out",
} as const;
export const RC10R_PLAY_MODES = {
  "first-second": "PTN1 → PTN2", "second-first": "PTN2 → PTN1", first: "PTN1", second: "PTN2",
} as const;

export interface Rc10rMemorySetup {
  kit: (typeof RC10R_KITS)[number];
  level: number;
  reverb: number;
  intro: boolean;
  stopMode: keyof typeof RC10R_STOP_MODES;
  playMode: keyof typeof RC10R_PLAY_MODES;
}

const STYLE_KITS: Partial<Record<string, Rc10rMemorySetup["kit"]>> = {
  rock: "Rock", metal: "Heavy", ballad: "Light", funk: "R&B", shuffle: "Studio", country: "Live",
};

export function newRc10rMemorySetup(style: unknown, introBars: number): Rc10rMemorySetup {
  const kit = typeof style === "string" && Object.hasOwn(STYLE_KITS, style) ? STYLE_KITS[style] : undefined;
  return { kit: kit ?? "Studio", level: 100, reverb: 50, intro: introBars > 0, stopMode: "measure-ending", playMode: "first-second" };
}

export function parseRc10rMemorySetup(value: unknown, defaults: Rc10rMemorySetup): Rc10rMemorySetup {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const fields = value as Partial<Rc10rMemorySetup>;
  const level = (input: unknown, fallback: number): number =>
    typeof input === "number" && Number.isInteger(input) && input >= 0 && input <= 100 ? input : fallback;
  return {
    kit: RC10R_KITS.find((kit) => kit === fields.kit) ?? defaults.kit,
    level: level(fields.level, defaults.level),
    reverb: level(fields.reverb, defaults.reverb),
    intro: typeof fields.intro === "boolean" ? fields.intro : defaults.intro,
    stopMode: Object.keys(RC10R_STOP_MODES).find((mode) => mode === fields.stopMode) as Rc10rMemorySetup["stopMode"] ?? defaults.stopMode,
    playMode: Object.keys(RC10R_PLAY_MODES).find((mode) => mode === fields.playMode) as Rc10rMemorySetup["playMode"] ?? defaults.playMode,
  };
}

export interface Rc10rMemoryComparison {
  field: Rc10rRhythmField;
  label: string;
  song: string | number;
  raw?: number;
  comparison: "Match" | "Different" | "Capture pending" | "Unavailable";
}

/** Compare literal continuous values. Menu codes need a controlled field capture before assigning them names. */
export function compareRc10rMemory(setup: Rc10rMemorySetup, snapshot: Rc10rRhythmMemory): Rc10rMemoryComparison[] {
  const fields = [
    ["Kit", "Kit", setup.kit],
    ["Level", "Rhythm level", setup.level],
    ["ReverbLevel", "Reverb", setup.reverb],
    ["Intro", "Intro", setup.intro ? "On" : "Off"],
    ["StopMode", "Stop mode", RC10R_STOP_MODES[setup.stopMode]],
    ["PlayMode", "Play mode", RC10R_PLAY_MODES[setup.playMode]],
  ] as const;
  return fields.map(([field, label, song]) => {
    const raw = snapshot[field];
    return {
      field, label, song, raw,
      comparison: raw === undefined ? "Unavailable" : typeof song !== "number" ? "Capture pending" : raw === song ? "Match" : "Different",
    };
  });
}
