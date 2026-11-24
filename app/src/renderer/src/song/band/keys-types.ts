export const KEYS_SOUNDS = ["auto", "piano", "grand", "pianet", "wurlitzer", "organ"] as const;
export const KEYS_LEFT = ["style", "rest", "root", "root-octave", "root-fifth"] as const;
export const KEYS_REGISTERS = ["low", "mid", "high"] as const;
export const KEYS_PARTS = ["auto", "pad", "comp", "stabs", "arp", "rest"] as const;
export type KeysSound = (typeof KEYS_SOUNDS)[number];
export type KeysInstrument = Exclude<KeysSound, "auto">;
export type KeysLeft = (typeof KEYS_LEFT)[number];
export type KeysRegister = (typeof KEYS_REGISTERS)[number];
export type KeysPart = (typeof KEYS_PARTS)[number];

export interface KeysSettings {
  sound: KeysSound;
  left: KeysLeft;
  voices: 3 | 4;
  extensions: boolean;
  register: KeysRegister;
}

export const DEFAULT_KEYS: KeysSettings = { sound: "auto", left: "style", voices: 3, extensions: true, register: "mid" };

export function parseKeysSettings(value: unknown): KeysSettings {
  const source = value && typeof value === "object" ? value as Partial<KeysSettings> : {};
  return {
    sound: KEYS_SOUNDS.find((sound) => sound === source.sound) ?? DEFAULT_KEYS.sound,
    left: KEYS_LEFT.find((left) => left === source.left) ?? DEFAULT_KEYS.left,
    voices: source.voices === 4 ? 4 : 3,
    extensions: typeof source.extensions === "boolean" ? source.extensions : DEFAULT_KEYS.extensions,
    register: KEYS_REGISTERS.find((register) => register === source.register) ?? DEFAULT_KEYS.register,
  };
}
