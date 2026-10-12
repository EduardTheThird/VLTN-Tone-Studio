// Audition on the simulated pedal: the proposal reaches the pedal through the Rig's live edits, and putting it
// back restores the blocks.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findParam } from "@/gp5/lib/catalog.mjs";
import { useHistory } from "@/screens/rig/history";
import { getDriver, useDevice } from "@/state/device";
import type { BlockState, Gp5FamilyKey } from "@/state/device-types";
import { toPresetState } from "@/state/preset-codec";
import type { Gp5Driver } from "@/state/driver/gp5-driver";
import { auditionProposal, restoreBlocks } from "./apply";
import { proposePreset } from "./proposal";
import { analysisFixture } from "./test-signals";

// The simulator loads the bundled backup by URL; serve those URLs from disk (paths are relative to the app root).
vi.stubGlobal("fetch", async (url: string) => new Response(readFileSync(resolve(`.${decodeURIComponent(url)}`))));

/** Model, on/off and the catalog params of a block (what the pedal plays). */
const played = (b: BlockState) => ({
  fxid: b.fxid,
  enabled: b.enabled,
  params: Object.fromEntries((b.model?.params ?? []).map((p) => [p.name, b.params[p.index]])),
});

/** The blocks in the simulator's live buffer, read over MIDI (queued behind the live edits still in flight). */
async function pedalBlocks(): Promise<BlockState[]> {
  const p = useDevice.getState().preset!;
  return toPresetState(p.slot, await getDriver()!.readEditBuffer(p.name)).blocks;
}

/** Memory of the simulated pedal (what a write would change). */
const simulator = () => (getDriver() as Gp5Driver).mock!;

describe("auditionProposal on the simulated pedal", () => {
  beforeAll(async () => {
    await useDevice.getState().connect("mock");
  });
  afterAll(async () => {
    await useDevice.getState().disconnect();
  });

  it("plays every proposed block live, records it in the Rig history and writes nothing", async () => {
    const proposal = proposePreset(analysisFixture(), useDevice.getState().preset!.device as Gp5FamilyKey);
    const before = useDevice.getState().preset!.blocks.map(played);
    const savedBefore = useDevice.getState().saved;
    const slot = useDevice.getState().slot!;
    const flashBefore = simulator().slots[slot].body.slice();

    const snapshots = await auditionProposal(proposal);
    expect(snapshots).toHaveLength(10);
    const live = await pedalBlocks();
    for (const b of proposal.blocks) {
      const now = played(live[b.index]);
      expect(now.enabled, b.code).toBe(b.enabled);
      if (b.fxid === null) {
        expect(now.fxid, b.code).toBe(before[b.index].fxid);
        continue;
      }
      expect(now.fxid, b.code).toBe(b.fxid);
      for (const s of b.settings) expect(now.params[s.name], `${b.code} ${s.name}`).toBeCloseTo(s.value, 3);
    }
    expect(live[7].model?.name).toBe("Pure");
    expect(played(live[7]).params.Time).toBe(375);
    // The Rig shows it as unsaved changes; the slot itself is untouched.
    expect(useDevice.getState().preset!.blocks.map(played)).toEqual(live.map(played));
    expect(useDevice.getState().saved).toEqual(savedBefore);
    expect(useDevice.getState().unsavedChanges).toBeGreaterThan(0);
    expect(simulator().slots[slot].body).toEqual(flashBefore);
    expect(useHistory.getState().past.some((e) => e.kind === "block" && e.label === "Tone Match AMP")).toBe(true);

    await restoreBlocks(snapshots);
    expect((await pedalBlocks()).map(played)).toEqual(before);
    expect(useDevice.getState().unsavedChanges).toBe(0);
  }, 60_000);

  it("refuses to audition without a connected pedal", async () => {
    await useDevice.getState().disconnect();
    await expect(auditionProposal(proposePreset(analysisFixture(), "gp5"))).rejects.toThrow(/Connect the GP-5/);
  });
});

describe("auditionProposal on a simulated GP-50", () => {
  beforeAll(async () => {
    await useDevice.getState().connect("mock", { mockDevice: "gp50" });
  });
  afterAll(async () => {
    await useDevice.getState().disconnect();
  });

  it("plays a GP-50 proposal with the GP-50's params, Sync left off", async () => {
    expect(useDevice.getState().preset!.device).toBe("gp50");
    const proposal = proposePreset(analysisFixture(), "gp50");
    const dly = proposal.blocks[7];
    const sync = findParam(dly.fxid!, "Sync", "gp50");
    expect(dly.params![sync.index]).toBe(0);

    const snapshots = await auditionProposal(proposal);
    const live = await pedalBlocks();
    expect(live[7].model?.name).toBe("Pure");
    expect(played(live[7]).params).toMatchObject({ Time: 375, Sync: 0 });
    await restoreBlocks(snapshots);
  }, 60_000);

  it("refuses a proposal made from the GP-5 catalog", async () => {
    await expect(auditionProposal(proposePreset(analysisFixture(), "gp5"))).rejects.toThrow(/for the GP-5, but the GP-50 is connected/);
  });
});

describe("auditionProposal on a simulated GP-200", () => {
  beforeAll(async () => {
    await useDevice.getState().connect("mock", { mockDevice: "gp200" });
  }, 30_000);
  afterAll(async () => {
    await useDevice.getState().disconnect();
  });

  it("plays a GP-200 proposal from the built-in list live and puts it back", async () => {
    const proposal = proposePreset(analysisFixture(), "gp200");
    const before = useDevice.getState().preset!.blocks.map(played);
    const snapshots = await auditionProposal(proposal);
    expect(snapshots).toHaveLength(11);
    const live = await pedalBlocks();
    for (const b of proposal.blocks.filter((x) => x.fxid !== null)) {
      expect(live[b.index].fxid, b.code).toBe(b.fxid);
      for (const s of b.settings) expect(played(live[b.index]).params[s.name], `${b.code} ${s.name}`).toBeCloseTo(s.value, 3);
    }
    expect(live[3].model?.name).toBe("Mess DualM");
    expect(live[10]).toMatchObject({ fxid: before[10].fxid, enabled: before[10].enabled });
    await restoreBlocks(snapshots);
    expect((await pedalBlocks()).map(played)).toEqual(before);
  }, 60_000);
});
