// Pedal-model helpers shared by the device store, screens and file flows, on top of the registry (@shared/devices).
// Pure: no store access; the hooks (usePedalName, useProfile) live in ./device. Preset conversion is the GP-5 family's
// (gp5/lib/prst.mjs); presets never convert across families.
import { GP50_ONLY_FXIDS, convertPrst, parsePrst } from "@/gp5/lib/prst.mjs";
import { encode, expTargetBlock, globalsFor, packetize } from "@/gp5/lib/protocol.mjs";
import { encode as gp200Encode, encodeFrames } from "@/gp200/lib/protocol.mjs";
import { imageOf, withEightCtrl } from "@/gp200/lib/prst.mjs";
import { importPatch, packetize as gp150Packetize } from "@/gp150/lib/protocol.mjs";
import { PRST_MODELS, deviceForPortName, profileFor, sniffPrst, type DeviceFamily, type DeviceKey, type DeviceProfile } from "@shared/devices";
import { pedalOnUsb, type DeviceHostStatus, type VendorApp } from "@shared/host/device";
import type { ConnectionStatus, DeviceFeature, DeviceMode, GlobalSpec, Globals, Gp5BlockCode, Gp5FamilyKey, ParamInfo, PresetState, SettingSpec } from "./device-types";
import { GP150_GLOBAL_SPECS } from "./driver/gp150-globals";
import { gp200SpecsFor } from "./driver/gp200-globals";
import { SUPPORTED_DEVICE_KEYS } from "./driver/types";

/**
 * Features built on commands known only from static reverse engineering, not yet tested on hardware, per family: on a
 * real pedal they stay off until the user turns on "Experimental pedal commands" (app setting `gp50Extras`); the
 * simulator always has them.
 * GP-5 family: Valeton Suite 2.1.0's GP-50 commands. GP-200 family: the Global EQ write (0x1005, known from the
 * editor's code only); its export read and live tempo are known from hardware work. GP-150: none, every command is
 * known from GP-180 captures of Suite itself.
 */
export const EXPERIMENTAL_FEATURES: Readonly<Record<DeviceFamily, Partial<Record<DeviceFeature, true>>>> = {
  gp5: { exportPreset: true, exp: true, liveBpm: true, liveFootswitches: true, liveOrder: true, deletePreset: true, copyPreset: true, movePreset: true },
  gp200: { globalEq: true },
  gp150: {},
};

/** Split the features of a `family` driver into the usable ones and the ones the experimental setting keeps off. */
export function gateFeatures(all: readonly DeviceFeature[], mode: DeviceMode, extras: boolean, family: DeviceFamily): { features: DeviceFeature[]; locked: DeviceFeature[] } {
  const open = (f: DeviceFeature) => mode === "mock" || extras || !EXPERIMENTAL_FEATURES[family][f];
  return { features: all.filter(open), locked: all.filter((f) => !open(f)) };
}

/** Settings table of `device` in menu order (GP-5 family: protocol.mjs globalsFor; GP-200 family: gp200-globals.ts, per model; GP-150: gp150-globals.ts). */
export function globalSpecsFor(device: DeviceKey | null): readonly SettingSpec[] {
  if (!device) return [];
  if (isGp5Family(device)) return Object.values(globalsFor(device) as Record<string, GlobalSpec>);
  return profileFor(device).family === "gp150" ? GP150_GLOBAL_SPECS : gp200SpecsFor(device);
}

/** "1.1.0" >= "1.0.5": numeric comparison of dotted versions. */
export function versionAtLeast(version: string, min: string): boolean {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

/**
 * The settings a pedal shows: everything without `since`, and the later ones when the pedal reports them or its
 * firmware is at least `since`.
 */
export function visibleGlobals(specs: readonly SettingSpec[], globals: Globals | null, firmware: string | null): SettingSpec[] {
  return specs.filter((g) => !g.since || globals?.[g.name] !== undefined || (firmware !== null && versionAtLeast(firmware, g.since)));
}

/** Params the EXP pedal can sweep for target `module` (protocol EXP_TARGETS; 0 = the EXP volume, none) on `preset`. */
export function expTargetParams(preset: PresetState, module: number): readonly ParamInfo[] {
  const block: number | null = module === 0 ? null : expTargetBlock(module);
  return block === null ? [] : (preset.blocks[block]?.model?.params ?? []);
}

/**
 * The model the UI lays itself out for (slot count and labels, blocks) before any pedal was connected; the app began
 * as a GP-5 editor. Data is never assumed to be this model: files are sniffed, links and backups carry their model.
 */
export const DEFAULT_DEVICE: DeviceKey = "gp5";

/** Profile of the connected (or last connected) pedal, else DEFAULT_DEVICE's. */
export function profileOrDefault(device: DeviceKey | null): DeviceProfile {
  return profileFor(device ?? DEFAULT_DEVICE);
}

/** "GP-5" / "GP-200LT"; "pedal" when the model is not known yet (reads well in "Connect the pedal"). */
export function pedalName(device: DeviceKey | null): string {
  return device ? profileFor(device).name : "pedal";
}

/** "GP-5 / GP-50": the models this build supports, for copy about all of them or before any pedal was connected. */
export const SUPPORTED_PEDALS = SUPPORTED_DEVICE_KEYS.map((k) => profileFor(k).name).join(" / ");

/** The connected (or last connected) pedal's name, else every supported model's. */
export function pedalNameOrBoth(device: DeviceKey | null): string {
  return device ? pedalName(device) : SUPPORTED_PEDALS;
}

/** Valeton's apps for `device`: the editor that may hold its port, and the tool that updates its firmware. */
export function vendorApps(device: DeviceKey | null): { editor: string; updater: string } {
  return device && profileFor(device).family === "gp200"
    ? { editor: "Valeton's GP-200 editor", updater: "Valeton's updater" }
    : { editor: "Valeton Suite", updater: "Valeton Suite" };
}

export function vendorAppName(app: VendorApp): string {
  return app === "suite" ? "Valeton Suite" : "Valeton's GP-200 editor";
}

/**
 * The pedal connection copy is about (header, chip, status bar, diagnostics): the connected one; else the one on the
 * port being (or last) tried, by its name; else the one the host sees on USB; else the last connected (`device`). A
 * remembered GP-50 never stands in for a GP-200 that is attached. Data copy (names, settings) stays with `device`.
 */
export function attachedDevice(s: { status: ConnectionStatus; hostStatus: DeviceHostStatus | null; device?: DeviceKey | null; portName?: string | null }): DeviceKey | null {
  const usb = pedalOnUsb(s.hostStatus);
  if (s.status === "connected") return s.device ?? usb;
  return (s.portName ? deviceForPortName(s.portName) : null) ?? usb ?? s.device ?? null;
}

/** "07" (GP-5) or "12-C" (GP-200): slot label on the connected (or last connected) pedal, DEFAULT_DEVICE's before. */
export function slotLabel(device: DeviceKey | null, slot: number): string {
  return profileOrDefault(device).slotLabel(slot);
}

/** The name the pedal gives a slot without a user preset. Unknown model: any supported model's default name counts. */
export function isEmptySlotName(name: string, device: DeviceKey | null): boolean {
  const n = name.trim();
  return (device ? [device] : SUPPORTED_DEVICE_KEYS).some((k) => profileFor(k).emptyName === n);
}

export function isGp5Family(device: DeviceKey): device is Gp5FamilyKey {
  return profileFor(device).family === "gp5";
}

/** Block codes of a GP-5 family model in storage order (block index k = codes[k]). */
export function blockCodes(device: Gp5FamilyKey): readonly Gp5BlockCode[] {
  // The GP-5 family profiles list exactly the Gp5BlockCode union.
  return profileFor(device).blocks as readonly Gp5BlockCode[];
}

/** An engaged NS (SnapTone) plays in place of the amp and cab: the GP-5 family. The GP-150's NS module plays in series with them. */
export const snapToneReplacesAmpCab = (device: DeviceKey): boolean => isGp5Family(device);

/** Name of switch `index` of PresetState.footswitches on `device`: "FS1" (GP-5 family), "CTRL 1" (GP-200 family), "FS A" (GP-150). */
export function switchLabel(device: DeviceKey, index: number): string {
  if (isGp5Family(device)) return `FS${index + 1}`;
  return profileFor(device).family === "gp150" ? `FS ${"ABC"[index] ?? index + 1}` : `CTRL ${index + 1}`;
}

/** Model a .prst belongs to (see sniffPrst); throws when the bytes are no known preset. */
export function presetDevice(prst: Uint8Array): DeviceKey {
  const device = sniffPrst(prst);
  if (!device) throw new Error(`Not a ${PRST_MODELS} preset`);
  return device;
}

/** SysEx frames a full write of `prst` takes (26 on the GP-5, 29 on the GP-50, 7 larger ones on the GP-200 family, 10 on the GP-150). */
export function writeFrameCount(prst: Uint8Array): number {
  const { family } = profileFor(presetDevice(prst));
  if (family === "gp150") return gp150Packetize(importPatch(prst), 0).length;
  if (family === "gp200") return encodeFrames(gp200Encode.fullWrite(0, withEightCtrl(imageOf(prst)))).length;
  return packetize(encode.writePreset(0, prst)).length;
}

/** The pedal acknowledges every frame of a write (the GP-5 family does; the GP-200 family sends no ACKs, the GP-150 one per message). */
export const acksFrames = (device: DeviceKey): boolean => isGp5Family(device);

/** Converting `from` → `to` keeps every block: the GP-50 catalog holds every GP-5 model; GP-200 family files share one format. */
export function convertsLosslessly(from: DeviceKey, to: DeviceKey): boolean {
  return from === to || (from === "gp5" && to === "gp50") || profileFor(from).prst === profileFor(to).prst;
}

/** Plain refusal for a preset of another family ("This preset is for a GP-200; Tone Studio can't convert it for a GP-5."). */
export function crossFamilyNote(from: DeviceKey, to: DeviceKey): string {
  return `This preset is for a ${pedalName(from)}; Tone Studio can't convert it for a ${pedalName(to)}.`;
}

/** Why `value` can't be a slot name on `pedal` (printable ASCII only, not blank), or null when it can. */
export function slotNameError(value: string, pedal: string): string | null {
  const bad = [...value].find((c) => !/^[\x20-\x7e]$/.test(c));
  if (bad) return `The ${pedal} can't show “${bad}”. Use letters A to Z, digits, spaces and keyboard symbols.`;
  return value.trimEnd() === "" ? "A slot needs a name." : null;
}

/** Blocks of GP-5 family `prst` whose model does not exist on `target`, e.g. ["PRE (PRE C-Wah)"]. Empty when nothing is lost. */
export function modelsMissingOn(prst: Uint8Array, target: Gp5FamilyKey): string[] {
  const p = parsePrst(prst);
  if (convertsLosslessly(p.device, target)) return [];
  const codes = blockCodes(p.device);
  return p.blocks.flatMap((b: { fxid: number }, k: number) => {
    const only = (GP50_ONLY_FXIDS as Record<number, string>)[b.fxid >>> 0];
    return only ? [`${codes[k]} (${only})`] : [];
  });
}

export interface PreparedPreset {
  /** Bytes to write: the input when it already matches `target`, else a converted copy */
  prst: Uint8Array;
  from: DeviceKey;
  converted: boolean;
  /** Blocks cleared because their model does not exist on `target` (see modelsMissingOn) */
  dropped: string[];
}

/**
 * Make `prst` writable to a `target` pedal. GP-5 → GP-50 is lossless; GP-50 → GP-5 clears GP-50-only models,
 * which callers MUST show the user (the `dropped` list) before writing. Models of one GP-200 family file share one
 * layout. Throws for a preset of another family (crossFamilyNote) and for bytes that are no preset.
 */
export function prepareForDevice(prst: Uint8Array, target: DeviceKey): PreparedPreset {
  const from = presetDevice(prst);
  if (from === target) return { prst, from, converted: false, dropped: [] };
  if (profileFor(from).family !== profileFor(target).family) throw new Error(crossFamilyNote(from, target));
  if (!isGp5Family(from) || !isGp5Family(target)) return { prst, from, converted: false, dropped: [] };
  const dropped = modelsMissingOn(prst, target);
  return { prst: convertPrst(prst, target, { force: dropped.length > 0 }), from, converted: true, dropped };
}
