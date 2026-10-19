// Pedals that look like the real ones they model: colour, proportions and details by the model's name and origin.
// `NAMED` skins every model of the GP-5/GP-50 and GP-200 catalogs by its name; `RULES` catch the ones named after their origin.
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
  /** Colour of the treadle plate (default: near black) */
  treadleColor?: string;
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
  /** Colour of the knob caps, when neither black nor aluminium */
  cap?: string;
  /** Coloured or metal panel behind the controls (100-unit coordinates, between the name and the footswitch) */
  panel?: { color: string; y?: number; h?: number; border?: string };
  /** Full-width colour bands: [y, height, colour] */
  bands?: [number, number, string][];
  /** Small printed line under the name ("ANALOG DELAY") */
  sub?: string;
  /** Knob arrangement, when the real pedal has one (3 in a row for a Boss compact …) */
  layout?: "row" | "hero" | "tri" | "grid" | "dense";
  /** EQ sliders: rounded bar (default), square block or round button */
  sliderCap?: "bar" | "block" | "round";
}

const FW: Record<string, number> = { [F.boss]: 700, [F.rat]: 700, [F.boutique]: 700, [F.keeley]: 700, [F.fuzz]: 800, [F.bender]: 800, [F.digital]: 700 };

/** A pedal skin with the usual defaults: matte, script name, jewel LED, black knobs. */
const mk = (body: string, accent: string, ink: string, font: string, o: Partial<PedalStyle> = {}): PedalStyle => ({
  w: 100, h: 160, rx: 9, body, accent, ink, font, fontWeight: FW[font] ?? 400, finish: "matte", label: "script", labelFont: F.boss, jewel: true, darkKnobs: true, ...o,
});

/** Boss compact: colour body, name on a black label strip, hinged footswitch cover, three knobs in a row. */
const boss = (body: string, ink = "#1c1c1e", o: Partial<PedalStyle> = {}): PedalStyle =>
  mk(body, "#1c1c1e", ink, F.boss, { w: 100, h: 176, rx: 9, cover: true, label: "strip", layout: "row", ...o });

/** MXR: narrow die-cast box, script name, jewel LED. */
const mxr = (body: string, ink = "#ffffff", font: string = F.mxr, o: Partial<PedalStyle> = {}): PedalStyle =>
  mk(body, ink, ink, font, { w: 82, h: 160, rx: 8, ...o });

/** Tall wah with a treadle. */
const wah = (body: string, accent: string, ink: string, font: string, o: Partial<PedalStyle> = {}): PedalStyle =>
  mk(body, accent, ink, font, { w: 100, h: 252, rx: 12, treadle: 58, jewel: false, finish: "noir", ...o });

const TS = "#43a864";

const NAMED: Record<string, PedalStyle> = {
  // ── wahs ──
  "cry wah": wah("#18181b", "#c9ccd2", "#f2f2f2", F.wah, { treadleColor: "#2a2a2e" }),
  "v-wah": wah("#c7cad1", "#2a2a2e", "#1c1c1e", F.script, { finish: "frost", treadleColor: "#1d1d20" }),
  "s-wah": wah("#0d0d0f", "#c4a24a", "#d9b45a", F.western, { treadleColor: "#3a1515" }),
  "b-wah": wah("#b7bcc4", "#c8322a", "#1c1c1e", F.retro, { finish: "frost", treadleColor: "#2a2a2e" }),
  "c-wah": wah("#1a1b20", "#e6e8ec", "#f2f2f2", F.wah, { treadleColor: "#c9ccd2", w: 100 }),
  "p-wah": wah("#d7d2c4", "#2a2a2e", "#1c1c1e", F.bender, { finish: "frost", treadleColor: "#3a3a3e" }),
  "t-wah": mk("#e2b83a", "#1c1c1e", "#1c1c1e", F.retro, { w: 110, h: 160, rx: 5, sub: "ENVELOPE FILTER", label: "script", layout: "row", panel: { color: "#1c1c1e" }, cap: "#f3efe0" }),
  "a-wah": boss("#e8782a", "#1c1c1e", { sub: "AUTO WAH" }),
  "step filter": mk("#59308f", "#e9d8ff", "#ffffff", F.digital, { w: 106, h: 160, rx: 8, sub: "STEP FILTER", panel: { color: "#2b1649", border: "#b38cff" } }),
  // ── compressors / boosters / pre ──
  "comp": mk("#8b9098", "#d3342b", "#1c1c1e", F.script, { w: 88, h: 160, rx: 8, finish: "matte", bands: [[137, 4, "#d3342b"]] }),
  "comprosso": mk("#8b9098", "#d3342b", "#1c1c1e", F.script, { w: 88, h: 160, rx: 8, bands: [[137, 4, "#d3342b"]] }),
  "comp4": mk("#27549b", "#e6c35a", "#f4e9c0", F.keeley, { w: 92, h: 160, rx: 8, darkKnobs: false, layout: "grid" }),
  "comparoma 4": mk("#27549b", "#e6c35a", "#f4e9c0", F.keeley, { w: 92, h: 160, rx: 8, darkKnobs: false, layout: "grid" }),
  "s-comp": boss("#2f8fd0", "#f4f9ff", { sub: "COMPRESSION SUSTAINER", layout: "grid" }),
  "ac boost": mk("#b32a2a", "#f1e3b0", "#f1e3b0", F.western, { w: 84, h: 160, rx: 7, sub: "BOOST" }),
  "b-boost": mk("#ece7d6", "#1c1c1e", "#1c1c1e", F.bender, { w: 78, h: 150, rx: 6, sub: "TREBLE BOOST", bands: [[137, 4, "#1c1c1e"]] }),
  "p-boost": mk("#101012", "#ffffff", "#ffffff", F.boutique, { w: 74, h: 150, rx: 5, finish: "noir", sub: "BUFFER BOOST" }),
  "14 boost": mk("#f3f0e8", "#2257a3", "#2257a3", F.retro, { w: 90, h: 158, rx: 8, bands: [[3, 6, "#2257a3"]] }),
  "micro boost": mxr("#1b1b1e", "#ffffff", F.mxr, { w: 66, h: 150, sub: "MICRO AMP" }),
  "fat bb": mk("#c79a34", "#2a1d0a", "#2a1d0a", F.boutique, { w: 76, h: 150, rx: 7, sub: "PREAMP", layout: "tri" }),
  "beefy boost": mk("#c79a34", "#2a1d0a", "#2a1d0a", F.boutique, { w: 76, h: 150, rx: 7, sub: "PREAMP", layout: "tri" }),
  "enhancer": mk("#15151a", "#ffffff", "#ffffff", F.script, { w: 70, h: 150, rx: 7, finish: "noir", sub: "EP BOOSTER", darkKnobs: true }),
  "boost": mxr("#b3202a", "#ffffff", F.mxr, { w: 74, h: 150, sub: "BOOST" }),
  "ac refiner": mk("#4a9a8c", "#f2fbf8", "#f2fbf8", F.boutique, { w: 96, h: 160, sub: "ACOUSTIC PREAMP" }),
  "ac sim": boss("#aeb8c4", "#1c1c1e", { sub: "ACOUSTIC SIMULATOR", layout: "tri" }),
  "toucher": mk("#2a8f8a", "#e9fffd", "#ffffff", F.digital, { w: 88, h: 160, sub: "TOUCH WAH" }),
  "crier": mk("#a23a8a", "#fff0fb", "#ffffff", F.digital, { w: 88, h: 160, sub: "VOCAL FILTER" }),
  "clean octa": boss("#52798e", "#f4fbff", { sub: "OCTAVE" }),
  "octa": boss("#3b6f8f", "#f4fbff", { sub: "OCTAVE" }),
  "harmony": boss("#2f9a6a", "#f3fff9", { sub: "HARMONIST" }),
  "detune": mk("#6a5ad0", "#f1eeff", "#ffffff", F.digital, { w: 92, h: 160, sub: "MICRO PITCH" }),
  "pitch": mk("#12121a", "#f2c230", "#f2c230", F.bebas, { w: 100, h: 160, rx: 6, finish: "noir", sub: "PITCH SHIFTER", panel: { color: "#060609", border: "#f2c230" } }),
  "p-bend": mk("#232a35", "#e0e6ee", "#e0e6ee", F.anton, { w: 100, h: 160, rx: 6, finish: "noir", sub: "PITCH BEND" }),
  "hammy": wah("#c02a22", "#ffffff", "#ffffff", F.anton, { treadle: 52, treadleColor: "#1a1a1a" }),
  "ring mod": mk("#1f1d1b", "#c9a15a", "#e6c98a", F.retro, { w: 118, h: 160, rx: 4, finish: "noir", sub: "RING MODULATOR", panel: { color: "#0b0a09", border: "#8a6a2a" } }),
  "saturate": mk("#cf5a22", "#fff1e6", "#ffffff", F.anton, { w: 92, h: 160, rx: 6, sub: "TAPE SATURATION" }),
  "harmonizer 1": mk("#1c2330", "#8fd3ff", "#8fd3ff", F.digital, { w: 120, h: 156, rx: 8, finish: "noir", sub: "HARMONIZER", panel: { color: "#0c121c", border: "#8fd3ff" } }),
  "harmonizer 2": mk("#312a24", "#f0b070", "#f6c690", F.digital, { w: 120, h: 156, rx: 8, finish: "noir", sub: "HARMONIZER", panel: { color: "#14100c", border: "#f0b070" } }),
  "auto swell": boss("#d7d2c4", "#1c1c1e", { sub: "SLOW GEAR" }),
  "hold": mk("#d0d3d8", "#1c1c1e", "#1c1c1e", F.boutique, { w: 90, h: 156, sub: "SUSTAIN HOLD" }),
  "freeze": mk("#a3d6ee", "#13405a", "#13405a", F.boutique, { w: 90, h: 156, sub: "FREEZE" }),
  // ── drives ──
  "green drive": mk(TS, "#1c1c1e", "#ffffff", F.screamer, { w: 96, h: 168, rx: 10, cover: true, layout: "row", sub: "OVERDRIVE PRO" }),
  "green od": mk(TS, "#1c1c1e", "#ffffff", F.screamer, { w: 96, h: 168, rx: 10, cover: true, layout: "row", sub: "OVERDRIVE PRO" }),
  "od 9": mk("#6fc27d", "#1c1c1e", "#ffffff", F.screamer, { w: 96, h: 168, rx: 10, cover: true, layout: "row", sub: "OVERDRIVE" }),
  "scream od": mk("#1e7a4c", "#1c1c1e", "#f4f4f4", F.retro, { w: 92, h: 168, rx: 7, cover: true, layout: "row", sub: "OVERDRIVE" }),
  "yellow drive": boss("#e2b616", "#1c1c1e", { sub: "OVERDRIVE" }),
  "yellow od": boss("#e2b616", "#1c1c1e", { sub: "OVERDRIVE" }),
  "super drive": boss("#f0c321", "#1c1c1e", { sub: "SUPER OVERDRIVE" }),
  "super od": boss("#f0c321", "#1c1c1e", { sub: "SUPER OVERDRIVE" }),
  "blues od": boss("#4f86c6", "#ffffff", { sub: "BLUES DRIVER" }),
  "smooth dist": boss("#ee7a1a", "#1c1c1e", { sub: "DISTORTION" }),
  "sm dist": boss("#ee7a1a", "#1c1c1e", { sub: "DISTORTION" }),
  "bass crusher": boss("#44464c", "#ffffff", { sub: "BASS OVERDRIVE" }),
  "bass od": boss("#3a3d44", "#ffffff", { sub: "BASS OVERDRIVE" }),
  "plustortion": mxr("#f0cf2a", "#1c1c1e", F.mxr, { sub: "DISTORTION +" }),
  "bend fuzz": mk("#2d2218", "#d9b45a", "#e9d79a", F.bender, { w: 124, h: 150, rx: 6, finish: "noir", darkKnobs: false, sub: "TONE BENDER" }),
  "face fuzz": mk("#b73a2c", "#f4f4f4", "#f6f6f6", F.fuzz, { w: 140, h: 150, rx: 62, finish: "matte", label: "script", darkKnobs: false, sub: "FUZZ FACE" }),
  "sora fuzz": mk("#2f6bb3", "#f4f4f4", "#f6f6f6", F.fuzz, { w: 140, h: 150, rx: 62, finish: "matte", label: "script", darkKnobs: false, sub: "FUZZ" }),
  "black tail": mk("#141416", "#f2f2f2", "#f4f4f4", F.rat, { w: 124, h: 152, rx: 6, finish: "noir", layout: "row", sub: "DISTORTION" }),
  "crunchist": mk("#101010", "#d33a2d", "#f4f4f4", F.rat, { w: 100, h: 160, rx: 6, finish: "noir", sub: "CRUNCH BOX", bands: [[3, 6, "#d33a2d"]] }),
  "swarm": mk("#7a2e8f", "#ffe9ff", "#ffffff", F.retro, { w: 92, h: 160, sub: "FUZZ" }),
  "force": mk("#cf3b2a", "#ffffff", "#ffffff", F.anton, { w: 96, h: 160, rx: 6, sub: "FULL DRIVE" }),
  "tube": mk("#101216", "#6fd0ff", "#ffffff", F.digital, { w: 98, h: 160, rx: 6, finish: "noir", sub: "TUBE DRIVER", panel: { color: "#050608", border: "#6fd0ff" } }),
  "blues master": mk("#d3b45a", "#1c1c1e", "#1c1c1e", F.script, { w: 100, h: 160, rx: 6, layout: "row", sub: "BLUES BREAKER" }),
  "master od": mk("#0d0d0d", "#d9b45a", "#e9d79a", F.script, { w: 108, h: 160, rx: 6, finish: "noir", layout: "row", sub: "OVERDRIVE", darkKnobs: true, bands: [[3, 5, "#d9b45a"]] }),
  "master dist": mk("#101010", "#f2c230", "#f2c230", F.script, { w: 108, h: 160, rx: 6, finish: "noir", layout: "grid", sub: "SHRED MASTER" }),
  "taichi od": mk("#e6a0b8", "#3a1c28", "#3a1c28", F.script, { w: 96, h: 160, sub: "TRANSPARENT OD" }),
  "precise od": mk("#0f0f11", "#d9dde2", "#ffffff", F.boutique, { w: 100, h: 160, rx: 6, finish: "noir", sub: "PRECISION DRIVE", panel: { color: "#050506", border: "#d9dde2" } }),
  "timmy od": mk("#7ec8d8", "#14343c", "#14343c", F.boutique, { w: 90, h: 160, rx: 8, sub: "TRANSPARENT OD", layout: "tri" }),
  "lazaro": mk("#e8dcb0", "#3a2a10", "#3a2a10", F.western, { w: 96, h: 160, rx: 8, sub: "OVERDRIVE" }),
  "penesas": mk("#2c3e6d", "#f2c230", "#f2c230", F.retro, { w: 92, h: 160, sub: "OVERDRIVE" }),
  "red haze": mk("#b0222a", "#ffe9d8", "#ffe9d8", F.script, { w: 92, h: 160, sub: "HAZE" }),
  "darktale": mk("#1c1626", "#b38cff", "#d8c4ff", F.bender, { w: 98, h: 160, finish: "noir", sub: "DARK DRIVE" }),
  "chief": mk("#c9b890", "#2a1d0a", "#2a1d0a", F.western, { w: 100, h: 160, rx: 6, sub: "DISTORTION" }),
  "la charger": mk("#3a7d3a", "#f4f4f4", "#f4f4f4", F.anton, { w: 96, h: 160, rx: 6, sub: "DISTORTION" }),
  "revolt": mk("#0c0c0e", "#e23a2a", "#f2f2f2", F.bebas, { w: 100, h: 160, rx: 6, finish: "noir", sub: "OVERDRIVE", bands: [[3, 5, "#e23a2a"]] }),
  "flex od": mk("#f0efe8", "#1c1c1e", "#1c1c1e", F.boutique, { w: 88, h: 160, sub: "FLEX OVERDRIVE" }),
  "black bass": mk("#0e0e10", "#e8e8ea", "#f4f4f4", F.bebas, { w: 110, h: 160, rx: 6, finish: "noir", sub: "BASS DRIVER", panel: { color: "#050506" }, layout: "dense" }),
  "empire od": mk("#6e1f2a", "#f1e3b0", "#f1e3b0", F.keeley, { w: 96, h: 160, sub: "OVERDRIVE" }),
  "bass hammer": mk("#121214", "#7a3cff", "#c7a8ff", F.digital, { w: 118, h: 160, rx: 4, finish: "noir", sub: "BASS OVERDRIVE", panel: { color: "#07070a", border: "#7a3cff" } }),
  "flagman dist": mk("#0f0f10", "#f2f2f2", "#ffffff", F.bebas, { w: 112, h: 156, rx: 6, finish: "noir", sub: "DISTORTION", bands: [[3, 5, "#f2f2f2"]] }),
  // ── noise gates ──
  "ai gate": mk("#101012", "#d33a2d", "#f2f2f2", F.stencil, { w: 96, h: 160, rx: 6, finish: "noir", label: "strip", sub: "NOISE ELIMINATOR" }),
  "gate 1": boss("#9ba3ad", "#1c1c1e", { sub: "NOISE SUPPRESSOR", layout: "tri" }),
  "gate 2": mxr("#14141a", "#e23a2a", F.bebas, { w: 90, h: 160, sub: "SMART GATE", bands: [[3, 5, "#e23a2a"]] }),
  "gate 3": mk("#2c3a2c", "#c9e8a6", "#d9f2bc", F.digital, { w: 96, h: 160, rx: 6, finish: "noir", sub: "NOISE GATE" }),
  // ── EQs ──
  "guitar eq 1": mxr("#151515", "#f2f2f2", F.mxr, { w: 100, h: 160, rx: 6, finish: "noir", sub: "10 BAND EQ", bands: [[3, 5, "#d33a2d"]], panel: { color: "#080808" }, sliderCap: "block" }),
  "guitar eq 2": boss("#9fb8cf", "#1c1c1e", { sub: "GRAPHIC EQUALIZER", layout: undefined, cover: false, h: 160, panel: { color: "#1b2026" }, sliderCap: "bar" }),
  "bass eq 1": mxr("#b9bdc4", "#1c1c1e", F.mxr, { w: 100, h: 160, rx: 6, finish: "frost", sub: "BASS EQ", panel: { color: "#202225" }, sliderCap: "block" }),
  "bass eq 2": boss("#26407a", "#ffffff", { sub: "BASS EQUALIZER", layout: undefined, cover: false, h: 160, panel: { color: "#10182c" }, sliderCap: "round" }),
  "v-eq": mk("#0e0e10", "#d9b45a", "#d9b45a", F.bender, { w: 104, h: 160, rx: 4, finish: "noir", sub: "5-BAND EQ", panel: { color: "#050506", border: "#d9b45a" }, sliderCap: "round", cap: "#d9dde2" }),
  "mess eq": mk("#0e0e10", "#d9b45a", "#d9b45a", F.bender, { w: 104, h: 160, rx: 4, finish: "noir", sub: "5-BAND EQ", panel: { color: "#050506", border: "#d9b45a" }, sliderCap: "round", cap: "#d9dde2" }),
  "hyper eq": mk("#c9ccd1", "#c8322a", "#1c1c1e", F.boutique, { w: 96, h: 160, rx: 8, finish: "frost", sub: "PARAMETRIC EQ", panel: { color: "#1d1e20" }, sliderCap: "bar", cap: "#c8322a" }),
  // ── modulation ──
  "aozora chorus": mk("#2e4fa3", "#ffffff", "#ffffff", F.retro, { w: 100, h: 164, rx: 8, sub: "STEREO CHORUS", layout: "tri" }),
  "choruium b": boss("#79c0e6", "#1c1c1e", { sub: "BASS CHORUS" }),
  "a-chorus": mk("#2e4fa3", "#ffffff", "#ffffff", F.retro, { w: 100, h: 164, rx: 8, sub: "ANALOG CHORUS" }),
  "g-chorus": mk("#2a7d6c", "#e8fff8", "#f2fffb", F.boutique, { w: 96, h: 164, rx: 8, sub: "CHORUS" }),
  "c-chorus": boss("#89cfe8", "#1c1c1e", { sub: "CHORUS ENSEMBLE" }),
  "b-chorus": boss("#d9e4ee", "#1c1c1e", { sub: "SUPER CHORUS", layout: "grid" }),
  "m-chorus": mxr("#c3c7ce", "#1c1c1e", F.mxr, { w: 86, h: 164, finish: "frost", sub: "ANALOG CHORUS", layout: "grid" }),
  "jetter": mk("#9aa0a8", "#1c1c1e", "#1c1c1e", F.bender, { w: 112, h: 156, rx: 5, finish: "frost", sub: "ELECTRIC FLANGER", cap: "#1c1c1e" }),
  "jetter n": mk("#2b2d33", "#e6c35a", "#e6c35a", F.bender, { w: 112, h: 156, rx: 5, finish: "noir", sub: "ELECTRIC FLANGER" }),
  "jet": mxr("#cf3b2a", "#ffffff", F.mxr, { w: 86, h: 164, sub: "FLANGER", layout: "grid" }),
  "b-jet": boss("#d98a2a", "#1c1c1e", { sub: "FLANGER", layout: "grid" }),
  "n-jet": mk("#2b2d33", "#e6c35a", "#e6c35a", F.bender, { w: 112, h: 156, rx: 5, finish: "noir", sub: "ELECTRIC FLANGER" }),
  "trem jet": mk("#ece2c8", "#8a2a2a", "#8a2a2a", F.western, { w: 100, h: 160, rx: 6, sub: "JET TREMOLO" }),
  "pulser": boss("#8fa8cf", "#1c1c1e", { sub: "VIBRATO", layout: "tri" }),
  "vibrato": boss("#8fa8cf", "#1c1c1e", { sub: "VIBRATO", layout: "tri" }),
  "vibrato t": mk("#2b3f2b", "#e8dcb0", "#e8dcb0", F.western, { w: 100, h: 160, rx: 6, finish: "noir", sub: "TWIN VIBRATO" }),
  "shiver": mk("#d97a1a", "#1c1c1e", "#1c1c1e", F.anton, { w: 92, h: 160, rx: 6, sub: "TREMOLO" }),
  "phaser 90": mxr("#ea741b", "#1c1c1e", F.phase, { w: 82, h: 152, layout: "hero" }),
  "o-phase": mxr("#ea741b", "#1c1c1e", F.phase, { w: 82, h: 152, layout: "hero" }),
  "g-phase": mxr("#f2c230", "#1c1c1e", F.mxr, { w: 82, h: 152, sub: "PHASE 45", layout: "hero" }),
  "s-phase": mxr("#1f4a9a", "#ffffff", F.mxr, { w: 82, h: 160, sub: "PHASE 100", layout: "grid" }),
  "pan phase": mk("#d9d2bd", "#2a2a2a", "#2a2a2a", F.boutique, { w: 100, h: 160, sub: "PAN PHASE" }),
  "minivibe": mk("#16161a", "#e8e8ea", "#f2f2f2", F.boutique, { w: 72, h: 150, rx: 7, finish: "noir", sub: "MICRO VIBE" }),
  "m-vibe": mk("#16161a", "#e8e8ea", "#f2f2f2", F.boutique, { w: 72, h: 150, rx: 7, finish: "noir", sub: "MICRO VIBE" }),
  "vibe": mk("#2a1c3a", "#e8d8ff", "#f0e4ff", F.retro, { w: 112, h: 156, rx: 6, finish: "noir", sub: "CHORUS / VIBRATO", panel: { color: "#120a1c" } }),
  "helicopter": mk("#17171a", "#d9b45a", "#e9d79a", F.bender, { w: 104, h: 150, rx: 5, finish: "noir", label: "script", sub: "TREMULATOR" }),
  "sine trem": boss("#2d5a63", "#f4fffe", { sub: "TREMOLO" }),
  "triangle trem": mk("#222a3f", "#d9e2ff", "#d9e2ff", F.digital, { w: 100, h: 160, finish: "noir", sub: "TRIANGLE TREMOLO" }),
  "bias trem": mk("#c4a85e", "#2a1c0a", "#2a1c0a", F.western, { w: 100, h: 160, rx: 6, sub: "BIAS TREMOLO", bands: [[137, 4, "#2a1c0a"]] }),
  "o-trem": mk("#e8e4d6", "#1c1c1e", "#1c1c1e", F.boutique, { w: 96, h: 160, sub: "OPTO TREMOLO" }),
  "v-roto": mk("#363a45", "#cfd3da", "#e8ebf0", F.fuzz, { w: 104, h: 164, rx: 8, finish: "noir", sub: "ROTO VIBE", cap: "#cfd3da" }),
  "g-roto": mk("#6a3a22", "#f0d8b0", "#f6e6c8", F.western, { w: 106, h: 164, rx: 6, sub: "ROTARY" }),
  "bit smash": mk("#d9d4c6", "#c8322a", "#1c1c1e", F.stencil, { w: 96, h: 158, rx: 6, finish: "frost", sub: "BIT CRUSHER" }),
  // ── delays ──
  "pure eko": boss("#ecebe6", "#1c1c1e", { sub: "DIGITAL DELAY", layout: "grid" }),
  "pure": boss("#ecebe6", "#1c1c1e", { sub: "DIGITAL DELAY", layout: "grid" }),
  "analog eko": mk("#1f3a35", "#f2f2f2", "#f2f2f2", F.mxr, { w: 92, h: 156, rx: 8, sub: "ANALOG DELAY", layout: "tri" }),
  "analog": mk("#1f3a35", "#f2f2f2", "#f2f2f2", F.mxr, { w: 92, h: 156, rx: 8, sub: "ANALOG DELAY", layout: "tri" }),
  "bbd delay s": mk("#7a2a34", "#fff1e0", "#fff1e0", F.script, { w: 96, h: 156, rx: 8, sub: "BBD DELAY" }),
  "mag eko": mk("#20201f", "#c9a15a", "#e2bd78", F.western, { w: 108, h: 154, rx: 6, finish: "noir", sub: "MAGNETIC ECHO", panel: { color: "#0e0e0d", border: "#c9a15a" }, cap: "#d9d3c2" }),
  "tape": mk("#18181a", "#f0f0f0", "#f0f0f0", F.retro, { w: 112, h: 154, rx: 6, finish: "noir", sub: "TAPE ECHO", panel: { color: "#0a0a0b" }, darkKnobs: false }),
  "tape delay s": mk("#6b4a2a", "#f1e1c0", "#f1e1c0", F.western, { w: 112, h: 154, rx: 6, sub: "TAPE DELAY", panel: { color: "#3b2814" } }),
  "m-echo": mk("#2d5a8a", "#f1f6ff", "#f1f6ff", F.retro, { w: 108, h: 154, rx: 6, sub: "ECHO", panel: { color: "#183552" }, darkKnobs: false }),
  "dual echo": mk("#26292e", "#f0b429", "#f0b429", F.digital, { w: 120, h: 154, rx: 8, finish: "noir", sub: "DUAL DELAY", panel: { color: "#101216", border: "#f0b429" }, layout: "dense" }),
  "ping pong": mk("#c4c8cf", "#1c1c1e", "#1c1c1e", F.boss, { w: 100, h: 168, rx: 9, finish: "frost", cover: true, label: "strip", sub: "STEREO DELAY", layout: "grid" }),
  "slapback": mk("#a8322a", "#f4e4c8", "#f4e4c8", F.western, { w: 100, h: 160, rx: 6, sub: "SLAPBACK ECHO" }),
  "sweep eko": mk("#3b3f8a", "#f4f4ff", "#f4f4ff", F.digital, { w: 104, h: 156, sub: "SWEEP ECHO" }),
  "sweep echo": mk("#3b3f8a", "#f4f4ff", "#f4f4ff", F.digital, { w: 104, h: 156, sub: "SWEEP ECHO" }),
  "ring eko": mk("#3a2a4a", "#e6b8ff", "#ecc8ff", F.retro, { w: 104, h: 156, finish: "noir", sub: "RING ECHO" }),
  "ring echo": mk("#3a2a4a", "#e6b8ff", "#ecc8ff", F.retro, { w: 104, h: 156, finish: "noir", sub: "RING ECHO" }),
  "tube eko": mk("#a8742a", "#2a1a08", "#2a1a08", F.western, { w: 108, h: 154, rx: 6, sub: "TUBE ECHO", cap: "#2a1a08" }),
  "dly:tube": mk("#a8742a", "#2a1a08", "#2a1a08", F.western, { w: 108, h: 154, rx: 6, sub: "TUBE ECHO", cap: "#2a1a08" }),
  "sweetie": boss("#6cbad2", "#1c1c1e", { sub: "ANALOG DELAY", layout: "tri" }),
  "sweet echo": boss("#6cbad2", "#1c1c1e", { sub: "ANALOG DELAY", layout: "tri" }),
  "backmask": mk("#2a1030", "#ff6ad5", "#ff9be3", F.bebas, { w: 100, h: 160, finish: "noir", sub: "REVERSE DELAY", bands: [[3, 5, "#ff6ad5"]] }),
  "rev echo": mk("#1c3a4a", "#9be8ff", "#b5eeff", F.retro, { w: 100, h: 160, finish: "noir", sub: "REVERSE ECHO" }),
  "999 echo": mk("#101010", "#f08a24", "#f08a24", F.bebas, { w: 120, h: 156, rx: 6, finish: "noir", sub: "ANALOG DELAY 999", panel: { color: "#050505", border: "#f08a24" }, layout: "dense" }),
  "vintage rack": mk("#b9bdc4", "#1c1c1e", "#1c1c1e", F.retro, { w: 140, h: 120 + 36, rx: 3, finish: "frost", sub: "RACK DELAY", panel: { color: "#202225" }, layout: "dense" }),
  "digital delay s": boss("#ecebe6", "#1c1c1e", { sub: "DIGITAL DELAY", layout: "grid" }),
  "lofi echo": mk("#c8b78a", "#2a2010", "#2a2010", F.stencil, { w: 98, h: 160, rx: 6, sub: "LO-FI ECHO" }),
  "ambience 1": mk("#1a2c44", "#8fd3ff", "#b5e3ff", F.boutique, { w: 112, h: 158, finish: "noir", sub: "AMBIENT DELAY", panel: { color: "#0a1522", border: "#8fd3ff" } }),
  "ambience 2": mk("#3a2250", "#d9a8ff", "#e6c4ff", F.boutique, { w: 112, h: 158, finish: "noir", sub: "AMBIENT DELAY", panel: { color: "#1c0f2a", border: "#d9a8ff" } }),
  "broken delay": mk("#d4d0c4", "#c8322a", "#1c1c1e", F.stencil, { w: 100, h: 160, rx: 6, finish: "frost", sub: "BROKEN DELAY" }),
  "ice delay": mk("#b8e0f0", "#0e3a52", "#0e3a52", F.digital, { w: 104, h: 158, finish: "frost", sub: "ICE DELAY" }),
  // ── reverbs ──
  "room": boss("#aab2bb", "#1c1c1e", { sub: "REVERB", layout: "grid" }),
  "hall": mk("#c3c8ce", "#1f2937", "#1f2937", F.keeley, { w: 108, h: 156, rx: 10, finish: "frost", sub: "HALL OF FAME", bands: [[24, 2, "#1f2937"]], layout: "grid", panel: { color: "#252a31" }, cap: "#e8eaee" }),
  "church": mk("#2b4a8a", "#e8ecf4", "#f2f5fb", F.fuzz, { w: 106, h: 158, rx: 8, sub: "CATHEDRAL", darkKnobs: false }),
  "spring": mk("#c9a965", "#3b2a12", "#3b2a12", F.script, { w: 100, h: 160, rx: 6, sub: "SPRING REVERB", bands: [[137, 4, "#3b2a12"]], layout: "row" }),
  "northstar": mk("#1a1832", "#b38cff", "#e5d8ff", F.boutique, { w: 114, h: 158, rx: 10, finish: "noir", sub: "NIGHTSKY", panel: { color: "#0d0a1b", border: "#5b3fa8" }, layout: "dense" }),
  "n-star": mk("#1a1832", "#b38cff", "#e5d8ff", F.boutique, { w: 114, h: 158, rx: 10, finish: "noir", sub: "NIGHTSKY", panel: { color: "#0d0a1b", border: "#5b3fa8" }, layout: "dense" }),
  "oceandeep": mk("#145a78", "#d8f6ff", "#e8fbff", F.retro, { w: 112, h: 158, rx: 10, sub: "OCEANS", cap: "#e8f2f6" }),
  "deepsea": mk("#0f4f5a", "#a8fff0", "#c4fff6", F.retro, { w: 112, h: 158, rx: 10, finish: "noir", sub: "DEEP SEA" }),
  "studio": mk("#e9e7e1", "#1c1c1e", "#1c1c1e", F.boss, { w: 96, h: 160, rx: 9, finish: "frost", label: "strip", sub: "STUDIO REVERB" }),
  "club": mk("#3a3030", "#e8c8a0", "#f0d8b8", F.bebas, { w: 100, h: 160, rx: 8, finish: "noir", sub: "CLUB REVERB" }),
  "concert": mk("#6a1f2a", "#f4e0c8", "#f4e0c8", F.keeley, { w: 106, h: 158, rx: 8, sub: "CONCERT HALL" }),
  "arena": mk("#14243c", "#f2c230", "#f2c230", F.anton, { w: 108, h: 158, rx: 8, finish: "noir", sub: "ARENA", bands: [[3, 6, "#f2c230"]] }),
  "small plate": mk("#6f9fb8", "#f4f9fc", "#f6fbff", F.boutique, { w: 112, h: 156, rx: 10, sub: "BLUE SKY", panel: { color: "#3a6580" }, layout: "dense", darkKnobs: false }),
  "large plate": mk("#456a82", "#f4f9fc", "#f6fbff", F.boutique, { w: 116, h: 156, rx: 10, sub: "BIG SKY", panel: { color: "#233f52" }, layout: "dense", darkKnobs: false }),
  "plate": mk("#6f9fb8", "#f4f9fc", "#f6fbff", F.boutique, { w: 112, h: 156, rx: 10, sub: "BLUE SKY", panel: { color: "#3a6580" }, layout: "dense", darkKnobs: false }),
  "cloud": mk("#e4ecf4", "#3a5a82", "#3a5a82", F.retro, { w: 112, h: 158, rx: 12, finish: "frost", sub: "CLOUD REVERB" }),
  "sweet space": mk("#efe7d2", "#7a4a2a", "#7a4a2a", F.script, { w: 108, h: 158, rx: 12, sub: "SWEET SPACE" }),
  "shimmer": mk("#8f9bb8", "#fff7e0", "#ffffff", F.digital, { w: 104, h: 158, rx: 8, sub: "SHIMMER", panel: { color: "#4a5578" } }),
  "amp spring": mk("#0f0f10", "#c9ccd2", "#e8ebf0", F.western, { w: 100, h: 160, rx: 4, finish: "noir", sub: "AMP REVERB", panel: { color: "#c9ccd2" }, bands: [[3, 5, "#c9ccd2"]] }),
  "tube spring": mk("#d7c293", "#3a2a10", "#3a2a10", F.script, { w: 100, h: 160, rx: 5, sub: "TUBE SPRING", bands: [[137, 4, "#3a2a10"]], layout: "row" }),
};

/** Models named after their origin, or that the table doesn't know: the old rules. */
const RULES: [RegExp, PedalStyle][] = [
  [/cry|c-wah|dunlop/i, NAMED["cry wah"]],
  [/wah/i, NAMED["c-wah"]],
  [/OD-1/i, NAMED["yellow od"]],
  [/SD-1/i, NAMED["super od"]],
  [/DS-1/i, NAMED["smooth dist"]],
  [/TS808|TS-?9/i, NAMED["green od"]],
  [/phase 90/i, NAMED["phaser 90"]],
  [/M133|micro amp/i, NAMED["micro boost"]],
  [/M104/i, NAMED["plustortion"]],
  [/xotic/i, NAMED["fat bb"]],
  [/rat\b/i, NAMED["black tail"]],
];

/** Boutique boxes for what the rules don't know: bigger for time effects, as digital delays and reverbs are. */
const BY_BLOCK: Partial<Record<BlockCode, PedalStyle>> = {
  DLY: { w: 116, h: 150, rx: 10, label: "stamp", font: F.boutique, fontWeight: 700, labelFont: F.boutique },
  RVB: { w: 116, h: 150, rx: 10, label: "stamp", font: F.boutique, fontWeight: 700, labelFont: F.boutique },
  MOD: { w: 100, h: 160, rx: 12, label: "stamp", font: F.boss, labelFont: F.boss },
  PRE: { w: 92, h: 150, rx: 15, label: "stamp", font: F.rat, labelFont: F.rat },
};

/** Looks for models nothing knows, picked by a hash of the name so a model always looks the same. */
const BOUTIQUE: PedalStyle[] = [
  mk("#8e2f2b", "#f4e7d0", "#f4e7d0", F.keeley, { w: 98 }),
  mk("#1d4b3c", "#e8dcb0", "#e8dcb0", F.fuzz, { rx: 6, darkKnobs: false, bands: [[137, 4, "#e8dcb0"]] }),
  mk("#d9d2bd", "#1c1c1e", "#1c1c1e", F.boutique, { w: 104, finish: "frost", label: "strip" }),
  mk("#14284d", "#f2c230", "#f2c230", F.rat, { w: 94, darkKnobs: false, bands: [[3, 6, "#f2c230"]] }),
  mk("#c7355c", "#fff2f6", "#fff2f6", F.script, { w: 108, rx: 12 }),
  mk("#2d2d30", "#e8e8ea", "#e8e8ea", F.mxr, { w: 96, rx: 5, finish: "noir", panel: { color: "#111113" }, darkKnobs: false }),
  mk("#e4b928", "#1c1c1e", "#1c1c1e", F.screamer, { rx: 10 }),
  mk("#3a3f4a", "#7fd1ff", "#bfe6ff", F.boutique, { w: 102, rx: 8, finish: "noir", panel: { color: "#1a1d24", border: "#7fd1ff" } }),
];
const strHash = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};

export function pedalStyle(name: string, origin: string | undefined, block: BlockCode): PedalStyle {
  const key = name.trim().toLowerCase();
  const named = NAMED[`${block.toLowerCase()}:${key}`] ?? NAMED[key];
  if (named) return named;
  const rule = RULES.find(([re]) => re.test(`${name} ${origin ?? ""}`));
  if (rule) return rule[1];
  if (block === "EQ") return NAMED["guitar eq 1"];
  const base = BY_BLOCK[block] ?? { w: 100, h: 150, rx: 15, label: "stamp" as const };
  return { ...BOUTIQUE[strHash(name) % BOUTIQUE.length], w: base.w, h: Math.max(base.h, 150) };
}
