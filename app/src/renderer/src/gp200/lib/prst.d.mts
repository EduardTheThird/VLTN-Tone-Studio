// Type declarations for prst.mjs (the JS stays the tested source of truth; keep these in sync).
import type { Bytes } from "./protocol.mjs";

export const IMAGE_SIZE: 1168;
export const IMAGE_SIZE_4CTRL: 1120;
export const PRST_SIZE: 1224;
export const PRST_SIZE_4CTRL: 1176;
export const EXP_SLOTS: 9;
export const QA_KNOBS: 3;
export const CTRL_COUNT: 8;

export interface PatchBlock {
  /** 0 PRE, 1 WAH, 2 DST, 3 AMP, 4 NR, 5 CAB, 6 EQ, 7 MOD, 8 DLY, 9 RVB, 10 VOL */
  index: number;
  name: string;
  enabled: boolean;
  fxid: number;
  /** f32[15] in display units, index = XML param ID (hidden floats included) */
  params: number[];
}
export interface PatchExp {
  /** exp << 4 | para */
  key: number;
  /** 0 EXP1 A, 1 EXP1 B, 2 EXP2 */
  pedal: number;
  para: number;
  block: number | null;
  param: number;
  max: number;
  min: number;
}
export interface PatchQuickAccess {
  index: number;
  /** block 0-10, 0x0B patch VOL, 0x0C patch tempo, null = off */
  block: number | null;
  param: number;
}
export interface PatchCtrl {
  index: number;
  state: number;
  /** bits 0-10 = blocks */
  mask: number;
}
export interface Gp200Patch {
  slot: number;
  name: string;
  author: string;
  note: string;
  tempo: number;
  volume: number;
  pan: number;
  style: number;
  sendLevel: number;
  returnLevel: number;
  loopMode: number;
  chain: { sendPos: number; returnPos: number; order: number[] };
  blocks: PatchBlock[];
  exp: PatchExp[];
  quickAccess: PatchQuickAccess[];
  /** 8 (4 in files from editors before 1.4.0) */
  ctrl: PatchCtrl[];
}
export interface PatchEdits {
  slot?: number;
  name?: string;
  author?: string;
  note?: string;
  tempo?: number;
  volume?: number;
  pan?: number;
  style?: number;
  sendLevel?: number;
  returnLevel?: number;
  loopMode?: number;
  chain?: { order?: number[]; sendPos?: number; returnPos?: number };
  blocks?: Record<string | number, { enabled?: boolean; fxid?: number; params?: Record<number, number> | number[] }>;
  exp?: Record<number, { block?: number | null; param?: number; max?: number; min?: number }>;
  quickAccess?: Record<number, { block?: number | null; param?: number }>;
  ctrl?: Record<number, { state?: number; mask?: number }>;
}
export type PatchInput = Partial<Omit<Gp200Patch, "blocks" | "exp" | "quickAccess" | "ctrl" | "chain">> & {
  chain?: Partial<Gp200Patch["chain"]>;
  blocks?: Partial<Record<number, Partial<Pick<PatchBlock, "enabled" | "fxid" | "params">>>> | Partial<Pick<PatchBlock, "enabled" | "fxid" | "params">>[];
  exp?: Partial<Record<number, Partial<Pick<PatchExp, "block" | "param" | "max" | "min">>>>;
  quickAccess?: Partial<Record<number, Partial<Pick<PatchQuickAccess, "block" | "param">>>>;
  ctrl?: Partial<Pick<PatchCtrl, "state" | "mask">>[];
};

export function expIndex(key: number): number;
export function expKey(index: number): number;
export function parsePatch(image: Bytes): Gp200Patch;
export function validateOrder(order: unknown): boolean;
export function applyPatchEdits(image: Bytes, edits?: PatchEdits): Uint8Array;
export function encodePatchImage(p?: PatchInput): Uint8Array;
export function withEightCtrl(image: Bytes): Uint8Array;
export function volatileMask(image: Bytes): Uint8Array;
/** First differing offset outside volatile bytes, -1 when the images match. */
export function firstDifference(a: Bytes, b: Bytes): number;
export function imagesMatch(a: Bytes, b: Bytes): boolean;
export function normalizeStored(image: Bytes, slot: number): Uint8Array;

export function isGp200Prst(bytes: Bytes): boolean;
export function isChecksumValid(bytes: Bytes): boolean;
export interface ParsedPrst {
  size: number;
  fwTag: number;
  /** 1 patch only, 2 patch + embedded User IR (not decoded) */
  layout: number;
  hasUserIr: boolean;
  ctrlCount: number;
  checksumOk: boolean;
  image: Uint8Array;
  patch: Gp200Patch;
}
export function parsePrst(bytes: Bytes): ParsedPrst;
export function buildPrst(image: Bytes, opts?: { fwTag?: number }): Uint8Array;
export function applyEdits(prst: Bytes, edits: PatchEdits): Uint8Array;
/** Patch image from a .prst or a raw image (validated). */
export function imageOf(bytes: Bytes): Uint8Array;
