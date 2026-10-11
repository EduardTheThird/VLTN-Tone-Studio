// What the Pedal settings faceplate shows for a model: its settings table (state/device-model globalSpecsFor), grouped
// like the pedal's menu, and the control each setting gets. Pure: no store access, no React.
import { globalSpecsFor, visibleGlobals } from "@/state/device-model";
import type { DeviceKey, GlobalSpec, Globals } from "@/state/device-types";

export type SettingsGroupKey = GlobalSpec["group"];

/** "dial" for numbers, "toggle" for Off/On, "select" for any other list of choices. */
export type ControlKind = "dial" | "toggle" | "select";

export interface SettingsGroup {
  group: SettingsGroupKey;
  title: string;
  items: GlobalSpec[];
}

const GROUP_TITLES: Readonly<Record<SettingsGroupKey, string>> = {
  audio: "Audio",
  recording: "Recording",
  controls: "Controls",
  midi: "MIDI",
  display: "Display",
  power: "Power",
};

const GROUP_ORDER = Object.keys(GROUP_TITLES) as SettingsGroupKey[];

/** The settings `device` shows, grouped in menu order; only groups with entries. */
export function settingsGroups(device: DeviceKey | null, globals: Globals | null, firmware: string | null): SettingsGroup[] {
  const specs = visibleGlobals(globalSpecsFor(device), globals, firmware);
  return GROUP_ORDER.map((group) => ({ group, title: GROUP_TITLES[group], items: specs.filter((s) => s.group === group) })).filter((g) => g.items.length > 0);
}

export function controlKind(spec: GlobalSpec): ControlKind {
  if (spec.kind === "number") return "dial";
  const labels = spec.labels ?? [];
  return labels.length === 2 && labels[0] === "Off" && labels[1] === "On" ? "toggle" : "select";
}

/** Caption under a dial: "−20 to 20 dB", "0 to 100". */
export function rangeCaption(spec: GlobalSpec): string {
  const min = `${spec.min < 0 ? "−" : ""}${Math.abs(spec.min)}`;
  return `${min} to ${spec.max}${spec.unit ? ` ${spec.unit}` : ""}`;
}

/** True when record [a, b] of the 0x10 reply is a setting in `device`'s table. */
export function isNamedRecord(device: DeviceKey | null, a: number, b: number): boolean {
  return globalSpecsFor(device).some((g) => g.addr[0] === a && g.addr[1] === b);
}
