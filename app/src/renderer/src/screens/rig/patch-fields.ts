// The GP-200 family's patch fields as the Rig's patch settings show them: EXP and Quick Access targets, and the limits
// of the number fields. Where the pedal's own ranges aren't known, a field takes what its record in the patch holds.
import { STYLE_COUNT, TARGET } from "@/gp200/lib/protocol.mjs";
import type { DeviceKey, PresetState } from "@/state/device-types";

/** The three EXP sets in PresetState.gp200.exp order, three entries each. */
export const EXP_SETS = ["EXP 1A", "EXP 1B", "EXP 2"] as const;

/** What EXP 1 and EXP 2 are on each model (makers' specs; the LT's jacks aren't confirmed on a unit). */
export const EXP_HARDWARE: Partial<Record<DeviceKey, string>> = {
  gp200: "EXP 1 is the built-in pedal; its toe switch picks set A or B. EXP 2 is a pedal on the EXP/FS 2 jack.",
  gp200lt: "The GP-200LT has no built-in pedal: EXP 1 and EXP 2 are pedals on its EXP/FS 1 and EXP/FS 2 jacks. Not yet confirmed on a GP-200LT.",
  gp200jr: "EXP 1 is the built-in pedal. EXP 2 is a pedal on its jack.",
};

const F32_MAX = 3.4028234663852886e38;

/**
 * Limits of the number fields: what each field's record in the patch holds, since their range on the pedal isn't
 * decoded. Pan is a signed byte, the loop mode a byte, the loop levels 16 bits; EXP min and max are 32-bit floats whose
 * unit isn't known either.
 */
export const FIELD_RANGE = {
  pan: { min: -128, max: 127 },
  loopMode: { min: 0, max: 255 },
  sendLevel: { min: 0, max: 0xffff },
  returnLevel: { min: 0, max: 0xffff },
  expEnd: { min: -F32_MAX, max: F32_MAX },
} as const;

/** Characters the patch stores for its author and note. */
export const TEXT_LENGTH = { author: 16, note: 40 } as const;

export interface Option {
  value: string;
  label: string;
}

/** The pedal's 20 drum styles by number (the pedal names them; the names aren't read), and `current` when beyond. */
export function styleOptions(current: number): Option[] {
  const styles = Array.from({ length: STYLE_COUNT }, (_, i) => i);
  if (!styles.includes(current)) styles.push(current);
  return styles.map((i) => ({ value: String(i), label: `Style ${i + 1}` }));
}

/** Select value of an EXP or Quick Access target: "off" for none, else its byte. */
export const targetValue = (target: number | null): string => (target === null ? "off" : String(target));

/** Name of a target: a block with its model ("DLY · <model>"), the patch volume or tempo, or the raw byte. */
export function targetLabel(p: PresetState, target: number | null): string {
  if (target === null) return "Off";
  if (target === TARGET.PATCH_VOL) return "Patch volume";
  if (target === TARGET.PATCH_TEMPO) return "Patch tempo";
  const b = p.blocks[target];
  if (!b) return `Target ${target}`;
  return b.model ? `${b.code} · ${b.model.title}` : b.code;
}

/**
 * What a target select offers: Off, every block in storage order, for Quick Access also the patch volume and tempo,
 * and `current` when the preset holds something else (so the select can show it).
 */
export function targetOptions(p: PresetState, kind: "exp" | "quickAccess", current: number | null): Option[] {
  const targets: (number | null)[] = [null, ...p.blocks.map((b) => b.index)];
  if (kind === "quickAccess") targets.push(TARGET.PATCH_VOL, TARGET.PATCH_TEMPO);
  if (!targets.includes(current)) targets.push(current);
  return targets.map((t) => ({ value: targetValue(t), label: targetLabel(p, t) }));
}

/** The params of block `block` by catalog index, and `current` when the model has no such param (or no catalog). */
export function paramOptions(p: PresetState, block: number, current: number): Option[] {
  const params = p.blocks[block]?.model?.params ?? [];
  const options = params.map((x) => ({ value: String(x.index), label: x.name }));
  return params.some((x) => x.index === current) ? options : [...options, { value: String(current), label: `Parameter ${current + 1}` }];
}

/** The edit pointing an EXP entry or Quick Access knob at `target`: a block starts on its first param. */
export function retarget(p: PresetState, target: number | null): { block: number | null; param?: number } {
  const block = target === null ? undefined : p.blocks[target];
  return block ? { block: target, param: block.model?.params[0]?.index ?? 0 } : { block: target };
}
