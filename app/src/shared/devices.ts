// Device registry: one profile per pedal model the app knows. Pure data plus lookups, shared by main, preload and
// renderer (no protocol code: each family's codec and session live in its own toolkit, gp5/, gp200/ and gp150/).
// Facts: USB descriptors of the pedals, drewmerc302/valeton-gp50, static RE of Valeton Suite 2.1.0 and the GP-200 editor
// 1.8.0, and the GP-180 captures of majabojarska/Valeton-GP180-Rev-Eng (the GP-150's protocol and preset file).

export type DeviceKey = "gp5" | "gp50" | "gp200" | "gp200lt" | "gp200jr" | "gp150";
/** Protocol family: the GP-5 and GP-50 share one protocol, the GP-200 family (incl. R/X, LT, JR) another, the GP-150 a third. */
export type DeviceFamily = "gp5" | "gp200" | "gp150";

/** Every known model, in display order. GP-200R and GP-200X report as the GP-200. */
export const DEVICE_KEYS: readonly DeviceKey[] = ["gp5", "gp50", "gp200", "gp200lt", "gp200jr", "gp150"];

/** Valeton/Hotone USB vendor id. */
export const VALETON_VID = 0x84ef;

export interface PrstMagic {
  offset: number;
  bytes: readonly number[];
}

export interface PrstFormat {
  /** Valid file sizes in bytes; the first is what the app writes */
  sizes: readonly number[];
  /** Bytes every file of this model carries */
  magic: readonly PrstMagic[];
  /** Byte offset and length of the preset name (NUL padded) */
  name: { offset: number; length: number };
}

export interface SlotTables {
  /** Slots on the pedal, numbered 0..slots-1 */
  slots: number;
  /** First and last slot a user can write */
  userRange: readonly [number, number];
  /** fxid of slot 0 in the block that plays it; slot n = fxidBase + n */
  fxidBase: number;
}

export interface DeviceProfile {
  key: DeviceKey;
  /** "GP-5", "GP-200LT" */
  name: string;
  family: DeviceFamily;
  /** USB product ids in normal mode */
  usbPids: readonly number[];
  /** USB interface number of the MIDI interface, for the driver check; null when not measured */
  usbMidiInterface: number | null;
  /** Matches the model's MIDI port name and no other model's */
  portPattern: RegExp;
  /** Preset slots, numbered 0..slotCount-1 */
  slotCount: number;
  /** What the pedal shows for a slot: "07" (GP-5), "12-C" (GP-200) or "042" (GP-150) */
  slotLabel(slot: number): string;
  /** Inverse of slotLabel; null when `label` is not a slot of this model */
  parseSlotLabel(label: string): number | null;
  /** Effect block codes in storage order (block index k = blocks[k]) */
  blocks: readonly string[];
  /** Footswitches on the unit */
  footswitches: number;
  /** Block a SnapTone in `slot` plays in: NS on the GP-5 family and the GP-150; AMP (slots 0-4) or DST (5-9) on the GP-200 family */
  captureBlock(slot: number): string;
  /** Per-preset switch assignments (GP-5 FS1/FS2, GP-200 CTRL 1–8, GP-150 footswitches A/B) */
  ctrls: number;
  snapTone: SlotTables;
  /** User IR slots; `samples` per IR as the pedal stores it */
  userIr: SlotTables & { samples: number };
  /** Patch tempo range in BPM */
  tempo: { min: number; max: number };
  /** Longest preset name the pedal shows */
  nameLength: number;
  /** What the pedal names a slot without a user preset; null when every slot always holds a patch */
  emptyName: string | null;
  prst: PrstFormat;
  /** Pedal settings can be read and changed */
  globals: boolean;
  /** The app has a simulator for this model (`?mock=<key>`, Device screen "Simulate a …") */
  simulator: boolean;
  /**
   * Tone Studio may change a real unit's memory (presets, names, settings, SnapTone and IR uploads). False until a unit
   * of the model has been tested; reads and live edits work either way, and the simulator always takes writes.
   */
  writable: boolean;
  /** Rough seconds for a full backup (every slot), for UI copy only */
  backupSeconds: number;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** GP-5 family: slots "00".."99". */
const decimalSlots = (count: number) => ({
  slotCount: count,
  slotLabel: (slot: number) => pad2(slot),
  parseSlotLabel: (label: string) => (/^\d{2}$/.test(label) && Number(label) < count ? Number(label) : null),
});

const BANK_LETTERS = "ABCD";
/** GP-200 family: 4 patches per bank, "01-A".."64-D" (slot = (bank - 1) * 4 + letter). */
const bankSlots = (count: number) => ({
  slotCount: count,
  slotLabel: (slot: number) => `${pad2(Math.floor(slot / 4) + 1)}-${BANK_LETTERS[slot % 4]}`,
  parseSlotLabel: (label: string) => {
    const m = /^(\d{2})-([A-D])$/.exec(label);
    if (!m) return null;
    const slot = (Number(m[1]) - 1) * 4 + BANK_LETTERS.indexOf(m[2]);
    return slot >= 0 && slot < count ? slot : null;
  },
});

const pad3 = (n: number) => String(n).padStart(3, "0");
/** GP-150: slots "001".."200" (the pedal counts from 1). */
const countedSlots = (count: number) => ({
  slotCount: count,
  slotLabel: (slot: number) => pad3(slot + 1),
  parseSlotLabel: (label: string) => (/^\d{3}$/.test(label) && Number(label) >= 1 && Number(label) <= count ? Number(label) - 1 : null),
});

const GP5_BLOCKS = ["NR", "PRE", "DST", "AMP", "CAB", "EQ", "MOD", "DLY", "RVB", "NS"] as const;
const GP200_BLOCKS = ["PRE", "WAH", "DST", "AMP", "NR", "CAB", "EQ", "MOD", "DLY", "RVB", "VOL"] as const;
/** GP-150 module order (the preset's blocks and the live commands): NS is the SnapTone / NAM module. */
const GP150_BLOCKS = ["PRE", "WAH", "DST", "NS", "AMP", "NR", "CAB", "EQ", "MOD", "DLY", "RVB", "VOL"] as const;

const SNAPTONE_FXID = 0x0f000000;
const USER_IR_FXID = 0x0a100000;

/** Shared by the GP-5 and GP-50 (gp5/lib: prst.mjs, snaptone.mjs, userir.mjs). */
const gp5Family = {
  family: "gp5",
  usbMidiInterface: 3,
  ...decimalSlots(100),
  blocks: GP5_BLOCKS,
  captureBlock: () => "NS",
  ctrls: 2,
  snapTone: { slots: 80, userRange: [50, 79], fxidBase: SNAPTONE_FXID },
  userIr: { slots: 20, userRange: [0, 19], fxidBase: USER_IR_FXID, samples: 512 },
  tempo: { min: 40, max: 260 },
  nameLength: 10,
  globals: true,
  simulator: true,
  writable: true,
  backupSeconds: 75,
} as const;

/** GP-5 family header: the model name, NUL terminated ("GP-5\0", "GP-50\0"), at 0. */
const gp5Prst = (model: string, size: number): PrstFormat => ({
  sizes: [size],
  magic: [{ offset: 0, bytes: [...ascii(model), 0] }],
  name: { offset: 0x19, length: 16 },
});

/** The 1224-byte `.prst` (1176 bytes before editor 1.4.0): "TSRP" + 4 zero bytes, "2-PG" at 0x10; same on LT and JR. */
const GP200_PRST: PrstFormat = {
  sizes: [1224, 1176],
  magic: [
    { offset: 0, bytes: [...ascii("TSRP"), 0, 0, 0, 0] },
    { offset: 0x10, bytes: ascii("2-PG") },
  ],
  // patch info record 0x0002 opens the image at 0x30: 4-byte TLV header, then the name at +16
  name: { offset: 0x30 + 4 + 16, length: 16 },
};

/** Shared by the GP-200 (R, X), GP-200LT and GP-200JR. `usbMidiInterface` is per model (measured on the GP-200 only). */
const gp200Family = {
  family: "gp200",
  blocks: GP200_BLOCKS,
  captureBlock: (slot: number) => (slot < 5 ? "AMP" : "DST"),
  ctrls: 8,
  snapTone: { slots: 10, userRange: [0, 9], fxidBase: SNAPTONE_FXID },
  userIr: { slots: 20, userRange: [0, 19], fxidBase: USER_IR_FXID, samples: 1024 },
  tempo: { min: 40, max: 250 },
  nameLength: 16,
  emptyName: null,
  prst: GP200_PRST,
  globals: true,
  simulator: true,
  // Estimate, not measured: per-slot read ≈ 1 s multi-chunk pause + frames/reply (gp200/lib/session.mjs pacing) × 256.
  backupSeconds: 300,
} as const;

/** The 1128-byte `.prst` of the GP-150 (and GP-180): record 0x3011 at 0, record 0x3010 at 8; the name in record 0x3020. */
const GP150_PRST: PrstFormat = {
  sizes: [1128],
  magic: [
    { offset: 0, bytes: [0x11, 0x30, 0x64, 0x04] },
    { offset: 8, bytes: [0x10, 0x30] },
  ],
  name: { offset: 0x2c, length: 16 },
};

export const PROFILES: Readonly<Record<DeviceKey, DeviceProfile>> = Object.freeze({
  gp5: {
    ...gp5Family,
    key: "gp5",
    name: "GP-5",
    usbPids: [0x0184],
    portPattern: /GP-5(?!\d)/i,
    footswitches: 2,
    emptyName: "GP-5",
    prst: gp5Prst("GP-5", 507),
  },
  gp50: {
    ...gp5Family,
    key: "gp50",
    name: "GP-50",
    usbPids: [0x018a],
    portPattern: /GP-50(?!\d)/i,
    footswitches: 4,
    emptyName: "GP-50",
    prst: gp5Prst("GP-50", 552),
  },
  // Port names are matched case-sensitively, like Valeton's GP-200 editor does. The LT and JR stay read-only until a
  // unit has been tested: how they identify and what they take is known only from the editor's code.
  // MIDI interface MI_03 on the GP-200 (Kaprrrr/gp200-tone-desk gp200-driver.ps1); not measured on the LT and JR.
  gp200: { ...gp200Family, ...bankSlots(256), key: "gp200", name: "GP-200", usbPids: [0x002a], usbMidiInterface: 3, portPattern: /GP-200(?!LT|JR)/, footswitches: 8, writable: true },
  gp200lt: { ...gp200Family, ...bankSlots(256), key: "gp200lt", name: "GP-200LT", usbPids: [0x002c], usbMidiInterface: null, portPattern: /GP-200LT/, footswitches: 4, writable: false },
  gp200jr: { ...gp200Family, ...bankSlots(255), key: "gp200jr", name: "GP-200JR", usbPids: [0x0180], usbMidiInterface: null, portPattern: /GP-200JR/, footswitches: 3, writable: false },
  // Known from GP-180 captures (same protocol, same preset file, one footswitch more); no GP-150 has been tested, so
  // writes stay off. Its USB product id is not known (the GP-180's is 0x0188): the port name identifies it.
  // SnapTone slot n is the pedal's list entry n + 1 (entry 0 is "None"); 0-49 factory, 50-99 user.
  gp150: {
    key: "gp150",
    name: "GP-150",
    family: "gp150",
    usbPids: [],
    usbMidiInterface: null,
    portPattern: /GP-150(?!\d)/,
    ...countedSlots(200),
    blocks: GP150_BLOCKS,
    footswitches: 2,
    captureBlock: () => "NS",
    ctrls: 2,
    snapTone: { slots: 100, userRange: [50, 99], fxidBase: SNAPTONE_FXID },
    // Suite sends the first 683 samples at 44.1 kHz (zero-filled to the 2048 the upload holds).
    userIr: { slots: 20, userRange: [0, 19], fxidBase: USER_IR_FXID, samples: 683 },
    tempo: { min: 40, max: 260 },
    nameLength: 15,
    emptyName: null,
    prst: GP150_PRST,
    globals: true,
    simulator: true,
    writable: false,
    // Estimate: one 1136-byte reply per slot.
    backupSeconds: 40,
  },
});

export function isDeviceKey(v: unknown): v is DeviceKey {
  return typeof v === "string" && (DEVICE_KEYS as readonly string[]).includes(v);
}

/**
 * How the app shows a SnapTone slot: the 0-based slot number the pedal protocol uses ("SnapTone 52").
 * The pedal's own on-screen numbering is not confirmed, so this matches the Tones screen.
 */
export function snapToneLabel(_device: DeviceKey, slot: number): string {
  return `SnapTone ${slot}`;
}

export function profileFor(key: DeviceKey): DeviceProfile {
  return PROFILES[key];
}

/** Models of one family, in display order. */
export function familyKeys(family: DeviceFamily): DeviceKey[] {
  return DEVICE_KEYS.filter((k) => PROFILES[k].family === family);
}

/** Model with this USB product id in normal mode, or null (another Valeton product, e.g. an updater). */
export function deviceForUsbPid(pid: number): DeviceKey | null {
  return DEVICE_KEYS.find((k) => PROFILES[k].usbPids.includes(pid)) ?? null;
}

/** Model whose MIDI port this is ("GP-5 MIDI 1", "GP-200 MIDI 1"), or null. */
export function deviceForPortName(name: string): DeviceKey | null {
  return DEVICE_KEYS.find((k) => PROFILES[k].portPattern.test(name)) ?? null;
}

/**
 * Model a `.prst` was made for, or null when the bytes are no known preset: the magic and the size must both fit.
 * A GP-200 family file names no model and reads as "gp200" (LT and JR files have the same layout).
 */
export function sniffPrst(bytes: Uint8Array): DeviceKey | null {
  return (
    DEVICE_KEYS.find((k) => {
      const { sizes, magic } = PROFILES[k].prst;
      return sizes.includes(bytes.length) && magic.every((m) => m.bytes.every((v, i) => bytes[m.offset + i] === v));
    }) ?? null
  );
}

/** "GP-5", "GP-5 or GP-50", "GP-5, GP-50 or GP-200" (`last` joins the final pair). */
export function listNames(keys: readonly DeviceKey[], last = "or"): string {
  const names = keys.map((k) => PROFILES[k].name);
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} ${last} ${names.at(-1)}`;
}

/** Models with their own `.prst` layout ("GP-5, GP-50 or GP-200"); LT and JR files are GP-200 files. */
export const PRST_MODELS = listNames(DEVICE_KEYS.filter((k, i) => DEVICE_KEYS.findIndex((j) => PROFILES[j].prst === PROFILES[k].prst) === i));

/** Preset name stored in a `.prst` of `device` (NUL padded, trimmed). */
export function prstName(bytes: Uint8Array, device: DeviceKey): string {
  const { offset, length } = PROFILES[device].prst.name;
  let s = "";
  for (let i = offset; i < offset + length && i < bytes.length && bytes[i]; i++) s += String.fromCharCode(bytes[i]);
  return s.trim();
}

/** Largest `.prst` of any model; bigger files are not presets and are not read. */
export const MAX_PRST_BYTES = Math.max(...DEVICE_KEYS.flatMap((k) => PROFILES[k].prst.sizes));
