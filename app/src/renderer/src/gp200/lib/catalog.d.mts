// Type declarations for catalog.mjs (the JS stays the tested source of truth; keep these in sync).
import type { Gp200Patch } from "./prst.mjs";

export interface CatalogOption {
  name: string;
  /** menu position */
  value: number;
  /** wire value when present (Empire OD Mode) */
  trueId?: number;
}
export interface CatalogKnob {
  kind: "Knob" | "Slider" | "Combox" | "Switch";
  name: string;
  /** UI order; `bind` refers to it */
  idx: number;
  /** param index in f32[15] and the 0x0005 param byte */
  id: number;
  /** 1 continuous, 2 enum, 3 switch */
  type: number;
  default: number;
  /** the XML text when it is not a plain number (e.g. "-25 Cents") */
  defaultRaw?: string;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  /** 1 = tempo-syncable, 2 = High-Cut / Pitch Low special */
  valueType?: number;
  bind?: number;
  minIsOff?: number;
  subType?: string;
  options?: CatalogOption[];
}
export interface CatalogModel {
  name: string;
  module: string;
  /** fxid */
  code: number;
  index: number;
  cabCode?: number;
  knobs: CatalogKnob[];
}
export interface Gp200Catalog {
  meta: {
    device: string;
    source: string;
    counts: { algEntries: number; uniqueCodes: number; perModule: Record<string, number>; controls: number };
  };
  modules: { module: string; algs: CatalogModel[] }[];
}
export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

export function parseXml(text: string): XmlNode;
/** algorithm.xml text (the user's own file) -> catalog. Throws a plain-language Error when it is not one. */
export function buildCatalogFromXml(xmlText: string, opts?: { device?: string; source?: string }): Gp200Catalog;
export function modelByFxid(catalog: Gp200Catalog, fxid: number, block?: string | number): CatalogModel | undefined;
export function modelsForBlock(catalog: Gp200Catalog, block: string | number): CatalogModel[];
export function optionValues(knob: CatalogKnob): number[];
export function clampParam(knob: CatalogKnob, value: number): number;
export function defaultValue(knob: CatalogKnob): number;
export function defaultParams(catalog: Gp200Catalog, fxid: number, block?: string | number): number[];
export function tempoSyncBinding(model: CatalogModel, knob: CatalogKnob): { sync: CatalogKnob; target: CatalogKnob } | null;
export function describePatch(
  catalog: Gp200Catalog,
  patch: Gp200Patch,
): { block: string; enabled: boolean; fxid: string; model: string; params: Record<string, number> }[];
