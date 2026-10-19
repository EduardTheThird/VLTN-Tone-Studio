// Pedals that look like the real ones they model: colour, proportions and details by the model's name and origin.
import type { BlockCode } from "@/state/device-types";
import type { Finish } from "./art";
import { PEDAL_FONT as F } from "./pedal-fonts";

export interface PedalStyle {
  /** Drawing size in viewBox units: width relative to a 100-unit Boss compact (73 mm), height from the real proportions */
  w: number;
  h: number;
  body?: string;
  accent?: string;
  finish?: Finish;
  /** Corner radius of the enclosure */
  rx: number;
  /** Boss-style hinged cover over the footswitch */
  cover?: boolean;
  /** Treadle (wah) over the top of the enclosure, in viewBox units of height */
  treadle?: number;
  /** Name printed on a label strip instead of the stamped lettering */
  label?: "strip" | "script" | "stamp";
  /** Ink of the label, when the body colour would hide the default */
  ink?: string;
  /** Typeface of the name; `fontWeight` 400 for single-weight faces */
  font?: string;
  fontWeight?: number;
  /** Typeface of the knob labels (default: the app's) */
  labelFont?: string;
  /** Round jewel LED instead of the light bar */
  jewel?: boolean;
  /** Black knobs (true) or aluminium (false), whatever the finish says */
  darkKnobs?: boolean;
}

const base = (h: number, w = 100): PedalStyle => ({ w, h, rx: 15, label: "stamp" });

const boss = (body: string, ink = "#1c1c1e", accent = "#1c1c1e"): PedalStyle => ({ w: 100, h: 176, rx: 9, body, accent, finish: "matte", cover: true, label: "strip", ink, font: F.boss, labelFont: F.boss, jewel: true, darkKnobs: true });
const mxr = (body: string, ink = "#ffffff", w = 82, h = 160, font: string = F.mxr): PedalStyle => ({ w, h, rx: 8, body, accent: ink, finish: "matte", label: "script", ink, font, fontWeight: 400, jewel: true, darkKnobs: true });

const RULES: [RegExp, PedalStyle][] = [
  // wahs first: "Cry Wah", V-Wah, C-Wah …
  [/cry|c-wah|dunlop/i, { w: 100, h: 252, rx: 12, body: "#18181b", accent: "#c9ccd2", finish: "noir", treadle: 58, label: "script", ink: "#f2f2f2", font: F.wah, fontWeight: 400, labelFont: F.boss }],
  [/v-wah|vox/i, { w: 100, h: 252, rx: 12, body: "#c7cad1", accent: "#2a2a2e", finish: "frost", treadle: 58, label: "script", ink: "#1c1c1e", font: F.script, fontWeight: 400, labelFont: F.boss }],
  [/wah/i, { w: 100, h: 252, rx: 12, body: "#2a2d36", accent: "#c9ccd2", finish: "noir", treadle: 58, label: "script", ink: "#f2f2f2", font: F.wah, fontWeight: 400, labelFont: F.boss }],
  // Boss compacts
  [/OD-1|yellow (drive|od)/i, boss("#e2b616")],
  [/SD-1|super (drive|od)/i, boss("#f0c321")],
  [/DS-1|smooth dist|SM Dist/i, boss("#ee7a1a", "#1c1c1e")],
  [/CE-2|choruium/i, boss("#79c0e6")],
  [/VB-2|pulser/i, boss("#8fa8cf")],
  [/DM-2|sweetie|sweet echo/i, boss("#6cbad2")],
  [/ODB-3|bass crusher|bass od/i, boss("#44464c", "#ffffff", "#e8e8ea")],
  // Ibanez Tube Screamer
  [/TS808|green (drive|od)|OD 9|scream od|TaiChi/i, { w: 96, h: 168, rx: 10, body: "#43a864", accent: "#1c1c1e", finish: "matte", cover: true, label: "script", ink: "#ffffff", font: F.screamer, fontWeight: 400, labelFont: F.boss, jewel: true, darkKnobs: true }],
  // MXR
  [/phase 90|phaser 90|O-Phase|G-Phase/i, mxr("#ea741b", "#1c1c1e", 82, 160, F.phase)],
  [/M133|micro (amp|boost)/i, mxr("#1b1b1e", "#ffffff", 66, 150)],
  [/M104|plustortion|distortion\+/i, mxr("#f0cf2a", "#1c1c1e")],
  [/dyna|comprosso|ross/i, { w: 88, h: 160, rx: 8, body: "#8b9098", accent: "#d3342b", finish: "matte", label: "script", ink: "#1c1c1e", font: F.script, fontWeight: 400, jewel: true, darkKnobs: true }],
  [/keeley|comparoma|\bcomp4?\b/i, { w: 88, h: 158, rx: 8, body: "#27549b", accent: "#e6c35a", finish: "matte", label: "script", ink: "#f4e9c0", font: F.keeley, fontWeight: 700, jewel: true, darkKnobs: false }],
  // fuzz and other boxes
  [/fuzz face|face fuzz|sora fuzz/i, { w: 140, h: 150, rx: 62, body: "#d8dbe0", accent: "#1c1c1e", finish: "frost", label: "script", ink: "#1c1c1e", font: F.fuzz, fontWeight: 800, darkKnobs: true }],
  [/tone bender|bend fuzz|bender/i, { w: 124, h: 150, rx: 6, body: "#31281f", accent: "#d9b45a", finish: "noir", label: "script", ink: "#e9d79a", font: F.bender, fontWeight: 800, darkKnobs: false }],
  [/\brat\b|black tail|flagman/i, { w: 124, h: 152, rx: 6, body: "#141416", accent: "#f2f2f2", finish: "noir", label: "script", ink: "#f4f4f4", font: F.rat, fontWeight: 700, labelFont: F.rat, jewel: true, darkKnobs: true }],
  [/decimator|AI gate|gate/i, { w: 96, h: 160, rx: 6, body: "#101012", accent: "#d33a2d", finish: "noir", label: "strip", ink: "#f2f2f2", font: F.stencil, fontWeight: 400, jewel: true, darkKnobs: true }],
  [/xotic|BB|beefy|enhancer|EP\b/i, { w: 70, h: 150, rx: 7, body: "#d1a64a", accent: "#2a1d0a", finish: "matte", label: "script", ink: "#2a1d0a", font: F.boutique, fontWeight: 700, labelFont: F.boutique, darkKnobs: true }],
  [/micro ?vibe|minivibe|M-Vibe/i, { w: 72, h: 150, rx: 7, body: "#16161a", accent: "#e8e8ea", finish: "noir", label: "script", ink: "#f2f2f2", font: F.boutique, fontWeight: 700, labelFont: F.boutique, jewel: true }],
  [/demeter|helicopter|tremulator/i, { w: 104, h: 150, rx: 5, body: "#17171a", accent: "#d9b45a", finish: "noir", label: "strip", ink: "#e9d79a", font: F.bender, fontWeight: 800 }],
];

/** Boutique boxes for what the rules don't know: bigger for time effects, as digital delays and reverbs are. */
const BY_BLOCK: Partial<Record<BlockCode, PedalStyle>> = {
  DLY: { w: 116, h: 150, rx: 10, label: "stamp", font: F.boutique, fontWeight: 700, labelFont: F.boutique },
  RVB: { w: 116, h: 150, rx: 10, label: "stamp", font: F.boutique, fontWeight: 700, labelFont: F.boutique },
  MOD: { w: 100, h: 160, rx: 12, label: "stamp", font: F.boss, labelFont: F.boss },
  PRE: { ...base(150, 92), font: F.rat, labelFont: F.rat },
};

export function pedalStyle(name: string, origin: string | undefined, block: BlockCode): PedalStyle {
  const text = `${name} ${origin ?? ""}`;
  const rule = RULES.find(([re]) => re.test(text));
  return rule ? rule[1] : (BY_BLOCK[block] ?? base(150));
}
