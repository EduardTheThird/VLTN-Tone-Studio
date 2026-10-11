// Native GP-50 preset bank for the simulator (MockGp5). Valeton's 55 factory presets live in the firmware and must
// not be redistributed, so slots 00..54 hold the caller's seed presets (MIT fixtures such as gp50-US-Lead.prst)
// followed by presets generated from the catalog; user slots 55..99 are empty, as on a new pedal.
import { defaultParams, modelsForBlock } from "./catalog.mjs";
import { BLOCK, BLOCKS, PRESET_COUNT } from "./protocol.mjs";
import { applyEdits, blankGp50Prst, detectDevice } from "./prst.mjs";

/** First user slot of the GP-50 (00..54 factory). */
export const GP50_FIRST_USER_SLOT = 55;

// Always-on blocks of a generated preset; the others switch on in a pattern that varies per slot.
const ALWAYS_ON = new Set([BLOCK.NR, BLOCK.AMP, BLOCK.CAB]);

/** Generated preset number `n`: one model per block (NS stays SnapTone 0, off), footswitches on DST+MOD and DLY. */
function generatedPreset(n) {
  const blocks = {};
  let amp = "";
  for (const name of BLOCKS.slice(0, 9)) {
    const k = BLOCK[name];
    const models = modelsForBlock(k, "gp50");
    const m = models[(n * 7 + k * 3) % models.length];
    if (k === BLOCK.AMP) amp = m.title;
    blocks[k] = { fxid: m.fxid, params: Object.fromEntries(defaultParams(m.fxid, "gp50").map((v, i) => [i, v])), enabled: ALWAYS_ON.has(k) || ((n >> k) & 1) === 1 };
  }
  const name = `${String(n).padStart(2, "0")} ${amp}`.slice(0, 10).trim();
  return applyEdits(blankGp50Prst(), { name, blocks, footswitches: { fs1: [BLOCK.DST, BLOCK.MOD], fs2: [BLOCK.DLY] }, bpm: 90 + n });
}

/** 100 GP-50 presets: `seeds` (552-byte .prst, at most 55), generated factory-style presets, then empty user slots. */
export function nativeGp50Bank(seeds = []) {
  if (seeds.length > GP50_FIRST_USER_SLOT) throw new RangeError(`at most ${GP50_FIRST_USER_SLOT} seed presets fit the factory slots`);
  if (seeds.some((p) => detectDevice(p).key !== "gp50")) throw new Error("seed presets must be GP-50 .prst files");
  return Array.from({ length: PRESET_COUNT }, (_, slot) => {
    if (slot < seeds.length) return Uint8Array.from(seeds[slot]);
    return slot < GP50_FIRST_USER_SLOT ? generatedPreset(slot) : blankGp50Prst();
  });
}
