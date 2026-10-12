// Tone Match state: the guitar stem's analysis, the preset proposal built from it, and the live audition.
// Reads the stems from useSong; a new song (or new stems) clears everything here.
import { create } from "zustand";
import type { BlockSnapshot } from "@/screens/rig/history";
import { useGp200Catalog } from "@/gp200/app/catalog-store";
import { useSong } from "@/song/store";
import { useDevice } from "@/state/device";
import { DEFAULT_DEVICE, isGp5Family } from "@/state/device-model";
import type { DeviceKey, DeviceState } from "@/state/device-types";
import type { GuitarAnalysis } from "./analyse";
import { auditionProposal, restoreBlocks } from "./apply";
import { proposePreset, type Proposal } from "./proposal";
import { analyseStem } from "./run";

export type AnalysisStatus = { kind: "idle" } | { kind: "running"; fraction: number } | { kind: "done" } | { kind: "error"; message: string };

export type AuditionStatus =
  | { kind: "idle" }
  | { kind: "applying" }
  /** Playing on the pedal; `before` puts the blocks back, on the same `slot` only */
  | { kind: "applied"; before: BlockSnapshot[]; slot: number }
  | { kind: "restoring" }
  | { kind: "error"; message: string };

export interface ToneMatchState {
  status: AnalysisStatus;
  analysis: GuitarAnalysis | null;
  proposal: Proposal | null;
  audition: AuditionStatus;
  /** Analyse the current guitar stem (cancels a running analysis) */
  analyse(): Promise<void>;
  /** Play the proposal on the pedal through the Rig's live edits */
  auditionProposal(): Promise<void>;
  /** Put the blocks back as they were before the audition */
  putBack(): Promise<void>;
  reset(): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
let running: AbortController | null = null;

/**
 * The pedal a proposal is for: the live preset's model, else the connected (or last connected) pedal's. A song can be
 * analysed before any pedal was ever connected; that proposal comes from DEFAULT_DEVICE's catalog and is rebuilt for
 * the real model when one connects (the useDevice subscription below).
 */
export const targetDevice = (d: Pick<DeviceState, "preset" | "device">): DeviceKey => d.preset?.device ?? d.device ?? DEFAULT_DEVICE;

export const useToneMatch = create<ToneMatchState>((set, get) => ({
  status: { kind: "idle" },
  analysis: null,
  proposal: null,
  audition: { kind: "idle" },

  async analyse() {
    const guitar = useSong.getState().stems?.guitar;
    if (!guitar) return;
    running?.abort();
    const ctrl = new AbortController();
    running = ctrl;
    set({ status: { kind: "running", fraction: 0 }, analysis: null, proposal: null, audition: { kind: "idle" } });
    try {
      const analysis = await analyseStem(guitar, (fraction) => !ctrl.signal.aborted && set({ status: { kind: "running", fraction } }), ctrl.signal);
      set({ status: { kind: "done" }, analysis, proposal: proposePreset(analysis, targetDevice(useDevice.getState())) });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      set({ status: { kind: "error", message: message(e) } });
    } finally {
      if (running === ctrl) running = null;
    }
  },

  async auditionProposal() {
    const { proposal, audition } = get();
    if (!proposal || audition.kind === "applying" || audition.kind === "restoring") return;
    // Auditioning again keeps the first "before", so Put back still returns to the user's own blocks.
    const earlier = audition.kind === "applied" && audition.slot === useDevice.getState().slot ? audition.before : null;
    set({ audition: { kind: "applying" } });
    try {
      const before = await auditionProposal(proposal);
      set({ audition: { kind: "applied", before: earlier ?? before, slot: useDevice.getState().slot ?? -1 } });
    } catch (e) {
      set({ audition: { kind: "error", message: message(e) } });
    }
  },

  async putBack() {
    const { audition } = get();
    if (audition.kind !== "applied") return;
    if (useDevice.getState().slot !== audition.slot) {
      set({ audition: { kind: "error", message: "The pedal is on another preset now, so there's nothing to put back." } });
      return;
    }
    set({ audition: { kind: "restoring" } });
    try {
      await restoreBlocks(audition.before);
      set({ audition: { kind: "idle" } });
    } catch (e) {
      set({ audition: { kind: "error", message: message(e) } });
    }
  },

  reset() {
    running?.abort();
    running = null;
    set({ status: { kind: "idle" }, analysis: null, proposal: null, audition: { kind: "idle" } });
  },
}));

/** Build the proposal again for `device` (another catalog); a failure drops the analysis with the reason. */
function repropose(device: DeviceKey): void {
  const { analysis } = useToneMatch.getState();
  if (!analysis) return;
  try {
    useToneMatch.setState({ proposal: proposePreset(analysis, device) });
  } catch (e) {
    useToneMatch.setState({ status: { kind: "error", message: message(e) }, analysis: null, proposal: null, audition: { kind: "idle" } });
  }
}

// Another pedal model (a GP-50 after a GP-5, a GP-200 after either): the proposal has to come from that pedal's catalog.
useDevice.subscribe((s, prev) => {
  const device = targetDevice(s);
  if (device !== targetDevice(prev) && useToneMatch.getState().proposal?.device !== device) repropose(device);
});

// A GP-200 effect list imported or removed: the GP-200 family's proposal picks its models from the new one.
useGp200Catalog.subscribe((c, prev) => {
  const device = useToneMatch.getState().proposal?.device;
  if (c.catalog !== prev.catalog && device && !isGp5Family(device)) repropose(device);
});

// Another song or a new split: the old analysis no longer applies. Fresh stems are analysed right away (in the
// worker), so the result is ready by the time anyone opens Tone match.
useSong.subscribe((s, prev) => {
  if (s.stems === prev.stems) return;
  const tm = useToneMatch.getState();
  tm.reset();
  if (s.stems) void tm.analyse();
});
