import type { Rc10rPatternInfo } from "../rc10r-bank";

export interface Rc10rStorageView {
  id: string;
  patterns: Rc10rPatternInfo[];
  backupPath?: string;
  problem?: string;
  recoveries: { id: string; date: string; state: string }[];
}
export interface Rc10rWritePlan {
  slot: number;
  memory: number | null;
  name: string;
  previous: string | null;
  backupPath: string;
}
/** Desktop storage calls use opaque leases. The renderer never supplies a filesystem path. */
export interface Rc10rApi {
  reserve(): Promise<string>;
  inspect(id: string): Promise<Rc10rStorageView>;
  plan(id: string, record: Uint8Array, slot: number, memory: number | null): Promise<Rc10rWritePlan>;
  write(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  recover(id: string, backupId: string): Promise<void>;
  eject(id: string): Promise<void>;
  release(id: string): Promise<void>;
}
