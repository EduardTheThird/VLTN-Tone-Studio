import { parsePedalProfile, type PedalProfile } from "./pedal-profile";

export const PEDAL_SETTINGS_FILE = "pedals.json";
export const DEFAULT_OWNED_PEDALS = ["valeton-gp180", "strymon-timeline", "boss-rc10r", "boss-ir200", "boss-sy200"] as const;
export const PEDAL_SETTINGS_MAX_BYTES = 8 * 1024 * 1024;

export interface PresetEntry {
  slot: number;
  name: string;
  note?: string;
}

export interface PedalSettingsFile {
  version: 1;
  profiles: PedalProfile[];
  channels: Record<string, number>;
  assignments: Record<string, number>;
  presets: Record<string, PresetEntry[]>;
  owned: string[];
  tempoFollow?: Record<string, boolean>;
}

export const emptyPedalSettings = (): PedalSettingsFile => ({
  version: 1,
  profiles: [],
  channels: {},
  assignments: {},
  presets: {},
  owned: [...DEFAULT_OWNED_PEDALS],
});

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const profileId = (id: string) => /^[a-z0-9-]{1,80}$/.test(id) && !["constructor", "prototype"].includes(id);
const fail = (): never => {
  throw new Error("Invalid pedal settings.");
};
const channel = (n: unknown) => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 16;
const assignedCC = (n: unknown) => Number.isInteger(n) && ((Number(n) >= 1 && Number(n) <= 31) || (Number(n) >= 64 && Number(n) <= 95));

function numbers(value: unknown, validId: (id: string) => boolean, validNumber: (n: unknown) => boolean): Record<string, number> {
  if (!record(value)) return fail();
  const result: Array<[string, number]> = [];
  for (const [id, setting] of Object.entries(value)) {
    if (!validId(id) || !validNumber(setting)) return fail();
    result.push([id, Number(setting)]);
  }
  return Object.fromEntries(result);
}

/** Validates data received through library IPC or restored from a checked backup. */
export function parsePedalSettings(text: string): PedalSettingsFile {
  if (new TextEncoder().encode(text).byteLength > PEDAL_SETTINGS_MAX_BYTES) return fail();
  const data: unknown = JSON.parse(text);
  if (!record(data) || data.version !== 1 || !Array.isArray(data.profiles) || !record(data.presets)) return fail();
  const profiles = data.profiles.map((value) => parsePedalProfile(JSON.stringify(value)));
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) return fail();
  const channels = numbers(data.channels, profileId, channel);
  const assignments = numbers(
    data.assignments,
    (id) => {
      const colon = id.indexOf(":");
      return colon > 0 && profileId(id.slice(0, colon)) && id.length > colon + 1 && id.length <= colon + 101;
    },
    assignedCC,
  );
  const presets = Object.entries(data.presets).map(([id, entries]): [string, PresetEntry[]] => {
    if (!profileId(id) || !Array.isArray(entries) || entries.length > 1000) return fail();
    const slots = new Set<number>();
    return [
      id,
      entries.map((value: unknown) => {
        if (
          !record(value) ||
          typeof value.slot !== "number" ||
          !Number.isInteger(value.slot) ||
          value.slot < 0 ||
          value.slot > 16_383 ||
          slots.has(value.slot) ||
          typeof value.name !== "string" ||
          !value.name.trim() ||
          value.name.length > 32 ||
          (value.note !== undefined && (typeof value.note !== "string" || value.note.length > 1000))
        )
          return fail();
        slots.add(value.slot);
        return { slot: value.slot, name: value.name.trim(), ...(value.note ? { note: String(value.note) } : {}) };
      }),
    ];
  });
  const owned = data.owned ?? DEFAULT_OWNED_PEDALS;
  if (!Array.isArray(owned) || owned.some((id) => typeof id !== "string" || !profileId(id))) return fail();
  let tempoFollow: Record<string, boolean> | undefined;
  if (data.tempoFollow !== undefined) {
    if (!record(data.tempoFollow)) return fail();
    const entries = Object.entries(data.tempoFollow);
    if (entries.some(([id, value]) => !profileId(id) || typeof value !== "boolean")) return fail();
    tempoFollow = Object.fromEntries(entries) as Record<string, boolean>;
  }
  return { version: 1, profiles, channels, assignments, presets: Object.fromEntries(presets), owned: [...new Set<string>(owned)],
    ...(tempoFollow ? { tempoFollow } : {}) };
}

export interface PedalSettingsApi {
  readPedalSettings(): Promise<PedalSettingsFile | null>;
  savePedalSettings(data: PedalSettingsFile, onlyIfMissing?: boolean): Promise<PedalSettingsFile>;
}
