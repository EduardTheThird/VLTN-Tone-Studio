import { create } from "zustand";
import { host } from "@/host";
import { emptyPedalSettings, parsePedalSettings, type PedalSettingsApi, type PedalSettingsFile, type PresetEntry } from "@shared/pedal-settings";
import type { TriggerCc } from "./midi-chase";
import { DEFAULT_PEDAL_CHANNELS, PEDAL_PROFILES, parsePedalProfile, type PedalProfile } from "./pedal-profiles";
export { DEFAULT_PEDAL_CHANNELS } from "./pedal-profiles";

export const PEDAL_LEGACY_KEY = "vltn.midi-pedals.v1";
/** A pedal as Performance sees it: the channel it is set to, and the trigger controllers its commands use. */
export interface ConfiguredPedal {
  name: string;
  channel: number;
  /** Trigger commands whose CC is not assigned yet, so the app cannot tell which controller they use. */
  unassigned: number;
  /** Trigger controllers that are assigned, on this pedal's channel. Chases never replay them (see midi-chase.ts). */
  triggers: TriggerCc[];
}

/** `cc $channel <number or $cc> …`, the form every profile uses for a controller. */
const CC_COMMAND = /^cc \$channel (\$cc|\d+) /;

/**
 * Every built-in and imported pedal with its channel and trigger controllers. A trigger command that names `$cc` uses the CC the user
 * assigned in the command builder; one without an assignment counts as unassigned. Fixed CC numbers are used as they are.
 */
export function configuredPedals(library: Pick<LibraryData, "profiles" | "channels" | "assignments">): ConfiguredPedal[] {
  return [...PEDAL_PROFILES, ...library.profiles].map((profile) => {
    const channel = library.channels[profile.id] ?? DEFAULT_PEDAL_CHANNELS[profile.id] ?? 1;
    const triggers: TriggerCc[] = [];
    let unassigned = 0;
    for (const action of profile.actions) {
      if (!action.momentary) continue;
      const matches = action.commands.map((command) => CC_COMMAND.exec(command)?.[1]).filter((cc): cc is string => cc !== undefined);
      const assigned = library.assignments[profile.id + ":" + action.id];
      const usesAssignment = matches.includes("$cc");
      if (usesAssignment && assigned === undefined) unassigned++;
      const ccs = new Set([...matches.filter((cc) => cc !== "$cc").map(Number), ...(usesAssignment && assigned !== undefined ? [assigned] : [])]);
      for (const cc of ccs) triggers.push([channel, cc]);
    }
    return { name: profile.name, channel, unassigned, triggers };
  });
}

type LibraryData = Omit<PedalSettingsFile, "version">;
type Edit = (data: LibraryData) => Partial<LibraryData>;
type LegacyStorage = Pick<Storage, "getItem" | "setItem"> | undefined;

function readLegacy(storage: LegacyStorage): PedalSettingsFile | null {
  try {
    const text = storage?.getItem(PEDAL_LEGACY_KEY);
    return text ? parsePedalSettings(JSON.stringify({ ...emptyPedalSettings(), ...JSON.parse(text), version: 1 })) : null;
  } catch {
    return null;
  }
}

function libraryData({ profiles, channels, assignments, presets, owned }: LibraryData): LibraryData {
  return { profiles: profiles.filter((profile) => !PEDAL_PROFILES.some((builtIn) => builtIn.id === profile.id)), channels, assignments, presets, owned };
}

export function createPedalLibrary(storage: LegacyStorage, backing: () => PedalSettingsApi | undefined) {
  return create<
    LibraryData & {
      saveError: string;
      load: (force?: boolean) => Promise<void>;
      flush: () => Promise<void>;
      importProfile: (text: string) => PedalProfile;
      setChannel: (id: string, channel: number) => void;
      setAssignment: (id: string, action: string, cc: number) => void;
      savePresets: (id: string, entries: PresetEntry[]) => void;
      setOwned: (id: string, enabled: boolean) => void;
    }
  >((set, get) => {
    const legacy = readLegacy(storage);
    let ready = false;
    let line = Promise.resolve();
    let pending: Edit[] = [];

    const serial = (task: () => Promise<void>) => {
      const job = line.then(task);
      line = job.catch((error) => set({ saveError: error instanceof Error ? error.message : String(error) }));
      return job;
    };

    async function load(force = false) {
      if (ready && !force) return;
      const api = backing();
      if (!api) return;
      const current = await api.readPedalSettings();
      const saved = current ?? (legacy ? await api.savePedalSettings({ version: 1, ...libraryData(legacy) }, true) : null);
      const data = libraryData(saved ?? emptyPedalSettings());
      set({ ...pending.reduce((result, edit) => ({ ...result, ...edit(result) }), data), saveError: "" });
      ready = true;
    }

    function flush() {
      return serial(async () => {
        const api = backing();
        if (!api) return;
        await load();
        if (!pending.length) return;
        const count = pending.length;
        await api.savePedalSettings({ version: 1, ...libraryData(get()) });
        pending.splice(0, count);
        set({ saveError: "" });
      });
    }

    function save(edit: Edit) {
      const patch = edit(get());
      // The web app has no filesystem-backed song library. Its existing local settings are still available there.
      if (!backing()) storage?.setItem(PEDAL_LEGACY_KEY, JSON.stringify({ version: 1, ...libraryData(get()), ...patch }));
      set(patch);
      if (backing()) {
        pending.push(edit);
        void flush().catch(() => {});
      }
    }

    return {
      ...libraryData(legacy ?? emptyPedalSettings()),
      saveError: "",
      load: (force) => serial(() => load(force)),
      flush,
      importProfile(text) {
        const profile = parsePedalProfile(text);
        if (PEDAL_PROFILES.some((p) => p.id === profile.id))
          throw new Error("Built-in profiles cannot be overwritten. Give the custom profile a different id.");
        save(({ profiles }) => ({ profiles: [...profiles.filter((p) => p.id !== profile.id), profile] }));
        return profile;
      },
      setChannel(id, channel) {
        if (!Number.isInteger(channel) || channel < 1 || channel > 16) throw new Error("MIDI channels are 1–16.");
        save(({ channels }) => ({ channels: { ...channels, [id]: channel } }));
      },
      setAssignment(id, action, cc) {
        if (!Number.isInteger(cc) || !((cc >= 1 && cc <= 31) || (cc >= 64 && cc <= 95))) throw new Error("Assigned CC numbers are 1–31 or 64–95.");
        save(({ assignments }) => ({ assignments: { ...assignments, [id + ":" + action]: cc } }));
      },
      setOwned(id, enabled) {
        save(({ owned }) => ({ owned: enabled ? [...new Set([...owned, id])] : owned.filter((other) => other !== id) }));
      },
      savePresets(id, entries) {
        if (entries.some(({ slot, name, note }) => !Number.isInteger(slot) || slot < 0 || slot > 16_383 || name.length > 32 || (note?.length ?? 0) > 1000))
          throw new Error("Preset names are up to 32 characters and notes are up to 1,000 characters.");
        save(({ presets }) => {
          const merged = new Map((presets[id] ?? []).map((entry) => [entry.slot, entry]));
          for (const { slot, name, note } of entries) {
            if (name.trim()) merged.set(slot, { slot, name: name.trim(), ...(note?.trim() ? { note: note.trim() } : {}) });
            else merged.delete(slot);
          }
          return { presets: { ...presets, [id]: [...merged.values()].sort((a, b) => a.slot - b.slot) } };
        });
      },
    };
  });
}

export const usePedalLibrary = createPedalLibrary(typeof localStorage === "undefined" ? undefined : localStorage, () => {
  const api = host.song?.library;
  return typeof api?.readPedalSettings === "function" ? api : undefined;
});
