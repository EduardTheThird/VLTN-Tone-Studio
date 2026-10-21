// SnapTone match: rank the NAM captures the user has downloaded against the song's guitar (capture-match.ts, in a
// worker), design the cab IR for the chosen one from its render, convert it into a SnapTone and hand that to the Tones
// send flow (screens/tones/store.ts), whose Write step asks before anything goes to the pedal.
import { create } from "zustand";
import type { T3kArchitecture, T3kSize, ToneRecord } from "@shared/host/tones";
import { prepareNam } from "@shared/nam";
import { gearLabel, gp5Models, proposeSlotName } from "@shared/tone3000";
import { host } from "@/host";
import { browse, loadRecords, startSendDraft, type CabIrChoice } from "@/screens/tones/store";
import { convertToClone } from "@/snaptone/convert";
import { encodeWav } from "@/song/wav";
import { useDevice } from "@/state/device";
import { isGp5Family } from "@/state/device-model";
import type { CaptureFit } from "./capture-match";
import { CaptureRanker } from "./capture-run";
import { IR_RATE, type MatchedIr } from "./irdesign";
import type { Refined } from "./refine-offline";
import { withRefinedEq } from "./proposal";
import { targetDevice, useToneMatch } from "./store";

/** TONE3000 gear Tone Match ranks: amps (with or without their cab) and drive pedals. Cabs, rooms and the rest aren't a guitar tone on their own. */
export const RANKED_GEAR: readonly string[] = ["amp", "amp-cab", "pedal"];
/** The Select flow's gear filter for the same gear */
const PICK_GEARS = "amp_amp-cab_pedal";
/** Name of the designed IR when it goes into a SnapTone (shown in the Tones send steps) */
export const MATCHED_IR_NAME = "Tone Match IR";

/** A downloaded NAM model Tone Match can rank: one per model name of a tone, its best SnapTone-ready file. */
export interface Capture {
  /** `${toneId}:${modelId}` */
  key: string;
  toneId: number;
  modelId: number;
  title: string;
  modelName: string;
  gear: string;
  architecture: T3kArchitecture | null;
  size: T3kSize;
}

export type CaptureResult = { kind: "running"; fraction: number } | { kind: "done"; fit: CaptureFit } | { kind: "failed"; message: string };

/** The offline drive + EQ refinement of one capture (refine-offline.ts) */
export type RefineResult = { kind: "running"; fraction: number } | { kind: "done"; refined: Refined } | { kind: "failed"; message: string };

export type RankStatus =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | { kind: "done" }
  | { kind: "cancelled" }
  /** `needsSignal`: Valeton's test signal isn't there yet */
  | { kind: "error"; message: string; needsSignal?: boolean };

export type BuildStatus =
  | { kind: "idle" }
  | { kind: "building"; key: string; fraction: number }
  /** The SnapTone waits in the Tones send draft of `toneId`; `withIr`: the matched IR is inside it */
  | { kind: "built"; key: string; toneId: number; withIr: boolean }
  | { kind: "error"; key: string; message: string };

export type PickStatus = { kind: "idle" } | { kind: "adding" } | { kind: "error"; message: string };

export interface CaptureMatchState {
  /** Null until the local tone records were read */
  captures: Capture[] | null;
  results: Record<string, CaptureResult>;
  /** Refinements by capture key; only captures with a result can be refined */
  refined: Record<string, RefineResult>;
  status: RankStatus;
  selected: string | null;
  build: BuildStatus;
  pick: PickStatus;
  /** Read the downloaded captures again */
  load(): Promise<void>;
  /** Rank every capture without a result yet (all of them the first time) */
  rank(): Promise<void>;
  cancel(): void;
  /** Refine the drive and EQ of a ranked capture against the stem (minutes of NAM renders; one at a time) */
  refine(key: string): Promise<void>;
  /** Put a finished refinement's EQ into the proposal's Guitar EQ (the drive is only shown); false when there is nothing to apply */
  applyRefinedEq(key: string): boolean;
  select(key: string): void;
  /** Convert the selected capture (+ its matched IR) into a SnapTone and start its Tones send draft */
  buildSnapTone(): Promise<void>;
  cancelBuild(): void;
  /** Pick a capture with TONE3000's Select flow, download it and rank it */
  pickOnTone3000(): Promise<void>;
  /** Drop results and builds (a new analysis) */
  reset(): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The rankable captures of local tone records, by title then model name. */
export function capturesFrom(records: ToneRecord[]): Capture[] {
  return records
    .filter((r) => r.format === "nam" && RANKED_GEAR.includes(r.gear))
    .flatMap((r) => {
      // gp5Models keeps SnapTone-ready files, best first (A2, then the largest A1): the first of each name wins.
      const best = new Map<string, Capture>();
      for (const m of gp5Models(r.models.map((m) => ({ ...m, architecture_version: m.architecture })))) {
        if (best.has(m.name)) continue;
        best.set(m.name, { key: `${r.tone_id}:${m.id}`, toneId: r.tone_id, modelId: m.id, title: r.title, modelName: m.name, gear: r.gear, architecture: m.architecture, size: m.size });
      }
      return [...best.values()];
    })
    .sort((a, b) => a.title.localeCompare(b.title) || a.modelName.localeCompare(b.modelName));
}

/** Ranked first by distance, then the ones still to come, failures last. */
export function rankedCaptures(captures: Capture[], results: Record<string, CaptureResult>): Capture[] {
  const order = (c: Capture) => {
    const r = results[c.key];
    return r?.kind === "done" ? r.fit.distance : r?.kind === "failed" ? Infinity : Number.MAX_VALUE;
  };
  return [...captures].sort((a, b) => order(a) - order(b));
}

/** The matched IR as a 24-bit mono WAV at IR_RATE (what the IR match saves and the SnapTone conversion reads). */
export const matchedIrWav = (ir: MatchedIr) => encodeWav({ sampleRate: IR_RATE, channels: [ir.ir] }, 24);

let run: { ctrl: AbortController; ranker: CaptureRanker | null } | null = null;
let building: AbortController | null = null;
let refining: { ctrl: AbortController; ranker: CaptureRanker | null } | null = null;

export const useCaptureMatch = create<CaptureMatchState>((set, get) => {
  const patchResult = (key: string, result: CaptureResult | null) =>
    set((s) => {
      const results = { ...s.results };
      if (result) results[key] = result;
      else delete results[key];
      return { results };
    });

  /** Download the best SnapTone-ready model of a picked tone, then rank it with the others. */
  const addTone = async (toneId: number) => {
    set({ pick: { kind: "adding" } });
    try {
      const best = gp5Models(await host.tones.models(toneId))[0];
      if (!best) throw new Error("This tone has no NAM A1 or A2 model, so it can't become a SnapTone.");
      const { record } = await host.tones.downloadModel(toneId, best.id);
      void loadRecords();
      if (!RANKED_GEAR.includes(record.gear)) throw new Error(`${record.title} is a ${gearLabel(record.gear).toLowerCase()} capture. Tone match ranks amp and pedal captures.`);
      await get().load();
      set({ pick: { kind: "idle" }, selected: `${toneId}:${best.id}` });
      void get().rank();
    } catch (e) {
      set({ pick: { kind: "error", message: message(e) } });
    }
  };

  return {
    captures: null,
    results: {},
    refined: {},
    status: { kind: "idle" },
    selected: null,
    build: { kind: "idle" },
    pick: { kind: "idle" },

    async load() {
      const records = await host.tones.local().catch(() => [] as ToneRecord[]);
      set({ captures: capturesFrom(records) });
    },

    async rank() {
      const analysis = useToneMatch.getState().analysis;
      if (!analysis || run || refining) return;
      const ctrl = new AbortController();
      const current = { ctrl, ranker: null as CaptureRanker | null };
      run = current;
      try {
        if (!get().captures) await get().load();
        const todo = (get().captures ?? []).filter((c) => get().results[c.key]?.kind !== "done");
        if (todo.length === 0) return set({ status: { kind: "done" } });
        set({ status: { kind: "running", done: 0, total: todo.length } });
        const signalWav = await host.snaptone.signal().catch(() => null);
        if (ctrl.signal.aborted) return;
        if (!signalWav) return set({ status: { kind: "error", message: "Ranking captures needs Valeton's test signal (nam_input_wav.wav).", needsSignal: true } });
        const ranker = new CaptureRanker(signalWav, { ltas: analysis.ltas, gainScore: analysis.gain.score, tone: analysis.tone, texture: analysis.texture });
        current.ranker = ranker;
        for (const [i, c] of todo.entries()) {
          if (ctrl.signal.aborted) return;
          patchResult(c.key, { kind: "running", fraction: 0 });
          try {
            const namText = await host.tones.readNam(c.toneId, c.modelId);
            if (ctrl.signal.aborted) return;
            const fit = await ranker.evaluate(namText, c.gear, (fraction) => !ctrl.signal.aborted && patchResult(c.key, { kind: "running", fraction }));
            patchResult(c.key, { kind: "done", fit });
          } catch (e) {
            if (ctrl.signal.aborted) return;
            patchResult(c.key, { kind: "failed", message: message(e) });
            if (ranker.failure) return set({ status: { kind: "error", message: message(ranker.failure) } });
          }
          set({ status: { kind: "running", done: i + 1, total: todo.length } });
        }
        set({ status: { kind: "done" } });
        if (!get().selected) set({ selected: rankedCaptures(get().captures ?? [], get().results)[0]?.key ?? null });
      } finally {
        current.ranker?.close();
        if (run === current) run = null;
      }
    },

    cancel() {
      if (refining) {
        refining.ctrl.abort();
        refining.ranker?.close();
        refining = null;
        set((s) => ({ refined: Object.fromEntries(Object.entries(s.refined).filter(([, r]) => r.kind !== "running")) }));
      }
      const current = run;
      if (!current) return;
      run = null;
      current.ctrl.abort();
      current.ranker?.close();
      set((s) => ({
        status: { kind: "cancelled" },
        results: Object.fromEntries(Object.entries(s.results).filter(([, r]) => r.kind !== "running")),
      }));
    },

    async refine(key) {
      const analysis = useToneMatch.getState().analysis;
      const capture = get().captures?.find((c) => c.key === key);
      const result = get().results[key];
      if (!analysis || !capture || result?.kind !== "done" || Object.values(get().refined).some((r) => r.kind === "running")) return;
      const set1 = (r: RefineResult) => set((s) => ({ refined: { ...s.refined, [key]: r } }));
      const ctrl = new AbortController();
      set1({ kind: "running", fraction: 0 });
      let ranker: CaptureRanker | null = null;
      refining = { ctrl, ranker: null };
      try {
        const signalWav = await host.snaptone.signal().catch(() => null);
        if (!signalWav) throw new Error("Refining needs Valeton's test signal (nam_input_wav.wav).");
        const namText = await host.tones.readNam(capture.toneId, capture.modelId);
        if (ctrl.signal.aborted) return;
        ranker = new CaptureRanker(signalWav, { ltas: analysis.ltas, gainScore: analysis.gain.score, tone: analysis.tone, texture: analysis.texture });
        refining = { ctrl, ranker };
        const refined = await ranker.refine(namText, result.fit.ir?.ir ?? null, (fraction) => !ctrl.signal.aborted && set1({ kind: "running", fraction }));
        if (!ctrl.signal.aborted) set1({ kind: "done", refined });
      } catch (e) {
        if (!ctrl.signal.aborted) set1({ kind: "failed", message: message(e) });
      } finally {
        ranker?.close();
        if (refining?.ctrl === ctrl) refining = null;
      }
    },

    applyRefinedEq(key) {
      const r = get().refined[key];
      const capture = get().captures?.find((c) => c.key === key);
      const proposal = useToneMatch.getState().proposal;
      if (r?.kind !== "done" || !capture || !proposal) return false;
      useToneMatch.setState({ proposal: withRefinedEq(proposal, r.refined.settings.eqDb, capture.title) });
      return true;
    },

    select(key) {
      if (get().build.kind === "building") return;
      set({ selected: key });
    },

    async buildSnapTone() {
      const { selected, captures, results, build } = get();
      const capture = captures?.find((c) => c.key === selected);
      const result = selected ? results[selected] : undefined;
      if (!capture || result?.kind !== "done" || build.kind === "building") return;
      const ctrl = new AbortController();
      building = ctrl;
      // The GP-200 family plays CAB after the SnapTone: the IR goes to a User IR slot there, not into the SnapTone.
      const ir = isGp5Family(targetDevice(useDevice.getState())) ? result.fit.ir : null;
      set({ build: { kind: "building", key: capture.key, fraction: 0 } });
      try {
        const namText = await host.tones.readNam(capture.toneId, capture.modelId);
        const { check } = prepareNam(namText);
        const wav = ir ? matchedIrWav(ir) : undefined;
        const clone = await convertToClone(namText, (fraction) => !ctrl.signal.aborted && set({ build: { kind: "building", key: capture.key, fraction } }), ctrl.signal, wav);
        const cabIr: CabIrChoice | null = wav ? { kind: "file", name: MATCHED_IR_NAME, wav } : null;
        const started = startSendDraft(capture.toneId, capture.modelId, proposeSlotName(capture.title, capture.modelName), "snaptone", { cabIr, built: { clone, check } });
        if (!started) throw new Error(`${capture.title} is being sent from Tones right now. Build again when that has finished.`);
        set({ build: { kind: "built", key: capture.key, toneId: capture.toneId, withIr: wav !== undefined } });
      } catch (e) {
        if (ctrl.signal.aborted) set({ build: { kind: "idle" } });
        else set({ build: { kind: "error", key: capture.key, message: message(e) } });
      } finally {
        if (building === ctrl) building = null;
      }
    },

    cancelBuild() {
      building?.abort();
      building = null;
      set({ build: { kind: "idle" } });
    },

    async pickOnTone3000() {
      set({ pick: { kind: "idle" } });
      await browse({ prompt: "select_tone", format: "nam", gears: PICK_GEARS }, (toneId) => void addTone(toneId));
    },

    reset() {
      get().cancel();
      get().cancelBuild();
      set({ results: {}, refined: {}, status: { kind: "idle" }, selected: null, build: { kind: "idle" }, pick: { kind: "idle" } });
    },
  };
});

// A new analysis (another song, or the same one analysed again) makes the ranking and any build stale.
useToneMatch.subscribe((s, prev) => {
  if (s.analysis !== prev.analysis) useCaptureMatch.getState().reset();
});
