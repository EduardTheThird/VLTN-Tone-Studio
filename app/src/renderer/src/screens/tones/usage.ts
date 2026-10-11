import { profileFor, type DeviceProfile } from "@shared/devices";
import type { PresetState } from "@/state/device-types";
import { toPresetState } from "@/state/preset-codec";

export interface PresetRef {
  slot: number;
  name: string;
}

export interface UsageIndex {
  /** SnapTone slot (GP-5: 0–79) → presets whose engaged capture block plays it */
  snaptone: Map<number, PresetRef[]>;
  /** User IR slot (GP-5: 0–19) → presets whose engaged CAB block plays it */
  ir: Map<number, PresetRef[]>;
}

/** Which pedal slot a block's fxid points at on `profile`'s model, if any. */
export function slotOfFxid(fxid: number, profile: Pick<DeviceProfile, "snapTone" | "userIr">): { kind: "snaptone" | "ir"; slot: number } | null {
  const id = fxid >>> 0;
  const { snapTone, userIr } = profile;
  if (id >= snapTone.fxidBase && id < snapTone.fxidBase + snapTone.slots) return { kind: "snaptone", slot: id - snapTone.fxidBase };
  if (id >= userIr.fxidBase && id < userIr.fxidBase + userIr.slots) return { kind: "ir", slot: id - userIr.fxidBase };
  return null;
}

/**
 * Index which presets use which SnapTone / User IR slot. A SnapTone counts only in its capture block (NS on the GP-5
 * family, AMP or DST on the GP-200 family) while that block is engaged: a bypassed block still stores some SnapTone
 * number the preset never plays. A User IR counts whenever CAB selects it, because an engaged SnapTone bypasses CAB on
 * the GP-5 family and the IR comes back when NS is off.
 * Each preset is read with its own model's block layout and slot tables (a backup may mix GP-5 and GP-50 files).
 */
export function buildUsage(presets: { slot: number | null; name: string; prst: Uint8Array }[]): UsageIndex {
  const index: UsageIndex = { snaptone: new Map(), ir: new Map() };
  for (const p of presets) {
    if (p.slot === null || p.slot < 0) continue;
    let parsed: PresetState;
    try {
      parsed = toPresetState(p.slot, p.prst);
    } catch {
      continue;
    }
    const profile = profileFor(parsed.device);
    for (const b of parsed.blocks) {
      const hit = slotOfFxid(b.fxid, profile);
      if (!hit || (hit.kind === "snaptone" ? b.code !== profile.captureBlock(hit.slot) || !b.enabled : b.code !== "CAB")) continue;
      const map = hit.kind === "snaptone" ? index.snaptone : index.ir;
      map.set(hit.slot, [...(map.get(hit.slot) ?? []), { slot: p.slot, name: p.name }]);
    }
  }
  for (const map of [index.snaptone, index.ir]) for (const list of map.values()) list.sort((a, b) => a.slot - b.slot);
  return index;
}
