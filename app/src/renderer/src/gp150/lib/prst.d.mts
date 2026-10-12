// Type declarations for prst.mjs (the JS stays the tested source of truth; keep these in sync).
import type { BlockName, Bytes } from "./protocol.mjs";

export const PRST_SIZE: number;
export const OFFSET: Readonly<{
  SLOT: number;
  BODY_LEN: number;
  CHECKSUM: number;
  CONFIG: number;
  SETTINGS: number;
  CHAIN: number;
  BLOCKS: number;
  KNOBS: number;
  EXP: number;
  STATE: number;
  CTRL: number;
}>;
export const NAME_LEN: number;
export const NAME_MAX: number;
export const EXP_ENTRIES: number;
export const FOOTSWITCHES: number;

export interface Gp150Block {
  index: number;
  code: BlockName;
  enabled: boolean;
  fxid: number;
  /** 15 params by param id */
  params: number[];
}
export interface Gp150Exp {
  /** module the EXP pedal sweeps */
  target: number;
  entries: { min: number; max: number; param: number; flag: number }[];
}
export interface Gp150Patch {
  slot: number;
  name: string;
  tempo: number;
  volume: number;
  /** 0 SnapTone, 1 NAM */
  namMode: number;
  /** module indices in signal order */
  chain: number[];
  /** in module order */
  blocks: Gp150Block[];
  knobs: { target: number; param: number }[];
  exp: Gp150Exp;
  /** module masks of footswitches A, B, C */
  footswitches: number[];
  activeMask: number;
}
export interface PatchEdits {
  slot?: number;
  name?: string;
  tempo?: number;
  volume?: number;
  namMode?: number;
  chain?: readonly number[];
  blocks?: Record<number, { enabled?: boolean; fxid?: number; params?: Record<number, number> }>;
  knobs?: Record<number, { target?: number; param?: number }>;
  footswitches?: readonly (readonly number[])[];
}

export function isGp150Prst(bytes: Bytes): boolean;
export function parsePrst(bytes: Bytes): Gp150Patch;
export function blocksOfMask(mask: number): number[];
export function maskOf(blocks: readonly number[]): number;
export function validChain(chain: readonly number[]): boolean;
export function settingsRecord(bytes: Bytes): Uint8Array;
export function ctrlRecord(bytes: Bytes): Uint8Array;
export function expRecord(bytes: Bytes): Uint8Array;
export function applyPatchEdits(bytes: Bytes | null, edits?: PatchEdits): Uint8Array;
export function blankPrst(slot?: number, name?: string): Uint8Array;
export function forImport(bytes: Bytes, slot: number): Uint8Array;
export function normalize(bytes: Bytes): Uint8Array;
export function imagesMatch(a: Bytes, b: Bytes): boolean;
export function prstName(bytes: Bytes): string;
