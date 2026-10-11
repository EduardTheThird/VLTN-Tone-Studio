// Type declarations for mock-device.mjs (the JS stays the tested source of truth; keep these in sync).
import type { Gp200Catalog } from "./catalog.mjs";
import type { Bytes, DecodedRecord, GlobalName, Gp200FamilyKey, HeaderRecord } from "./protocol.mjs";
import type { Gp200Transport } from "./session.mjs";

export function generatePatch(slot: number, opts?: { catalog?: Gp200Catalog }): Uint8Array;

export interface MockGp200Options {
  type?: Gp200FamilyKey | 2 | 3 | 4;
  /** 1 normal, 0 firmware-update mode (answers SOFTWARE_STATE only) */
  state?: 0 | 1;
  firmware?: string;
  /** patch images or .prst files for slots 0.. (the rest is generated) */
  images?: Bytes[];
  catalog?: Gp200Catalog;
  latencyMs?: number;
  minGapMs?: number;
  deafMs?: number;
  push1007?: boolean;
  verifyGlitch?: number;
  loseWrites?: number;
  junkVolatile?: boolean;
  fragmentSysex?: number;
  flushAfter?: number;
  ackWaitMs?: number;
  allowDestructive?: boolean;
  failUploads?: boolean;
  emitKnobNotify?: boolean;
  bankPolarity?: "manual" | "inverted";
  random?: () => number;
}
export type MockViolation =
  | { kind: "gap"; gapMs: number }
  | { kind: "deaf"; msLeft: number }
  | { kind: "danger"; what: string; bytes: Uint8Array }
  | { kind: "ackWait"; gapMs: number }
  | { kind: "hostBug"; what: string };
export interface MockSlotFile {
  name: string;
  sum: number;
  data: Uint8Array | null;
}

export class MockGp200 {
  constructor(opts?: MockGp200Options);
  type: 2 | 3 | 4;
  device: Gp200FamilyKey;
  name: string;
  slotCount: number;
  state: 0 | 1;
  firmware: string;
  slots: Uint8Array[];
  current: number;
  editBuffer: Uint8Array;
  dirty: boolean;
  globals: Record<GlobalName, number>;
  globalEq: number[];
  userIr: MockSlotFile[];
  snapTone: MockSlotFile[];
  styles: string[];
  drum: { playing: boolean; rhythm: number; volume: number; bpm: number };
  exp1AB: number;
  tuner: boolean;
  latencyMs: number;
  verifyGlitch: number;
  loseWrites: number;
  flushAfter: number;
  failUploads: boolean;
  emitKnobNotify: boolean;
  /** decoded host messages, newest last */
  log: { cmd: number | null; header: HeaderRecord | null; records: (DecodedRecord | { kind: "footswitch"; n: number; mode: number })[] }[];
  violations: MockViolation[];
  transport(): Gp200Transport;
  setOutput(cb: ((bytes: Uint8Array) => void) | null): void;
  receive(bytes: Bytes): void;
  pressPreset(slot: number): void;
  pressFootswitch(n: number): void;
  turnKnob(block: number, paramId: number, value: number): void;
  toggleBlock(block: number, on?: boolean): void;
  tapTempo(bpm: number): void;
}
