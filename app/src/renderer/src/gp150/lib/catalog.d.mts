// Type declarations for catalog.mjs (the JS stays the tested source of truth; keep these in sync).
export interface Gp150Knob {
  kind: "Knob" | "Switch" | "Combox";
  name: string;
  /** param id 0..14 */
  id: number;
  default: number;
  min: number;
  max: number;
  step: number;
  /** display unit of a knob ("Hz", "ms") */
  unit?: string;
  /** menu / switch labels, labels[value - min] */
  labels?: string[];
  /** id of the Sync switch that turns this Time/Rate knob into note values */
  sync?: number;
}
export interface Gp150Model {
  name: string;
  module: string;
  /** fxid */
  code: number;
  index: number;
  knobs: Gp150Knob[];
}
export interface Gp150Catalog {
  meta: {
    device: string;
    source: string;
    counts: { algEntries: number; uniqueCodes: number; perModule: Record<string, number>; controls: number };
  };
  modules: { module: string; algs: Gp150Model[] }[];
}

export function modelByFxid(catalog: Gp150Catalog, fxid: number, block: number | string): Gp150Model | undefined;
export function modelsForBlock(catalog: Gp150Catalog, block: number | string): Gp150Model[];
export function clampParam(knob: Gp150Knob, value: number): number;
export function defaultParams(catalog: Gp150Catalog, fxid: number, block: number | string): number[];
