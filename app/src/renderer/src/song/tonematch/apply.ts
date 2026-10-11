// Audition a Tone Match proposal on the pedal with the Rig's live edits: each block goes through
// screens/rig/edits.ts `editBlock`, so it plays immediately, shows on the Rig, lands in the Rig's undo history and
// counts as unsaved changes. Nothing is written to a slot; the user saves through the Rig's save flow.
import { editBlock, snapshot } from "@/screens/rig/edits";
import type { BlockSnapshot } from "@/screens/rig/history";
import { useDevice } from "@/state/device";
import { pedalName } from "@/state/device-model";
import type { Proposal, ProposedBlock } from "./proposal";

/** The live preset, or an error the UI can show as is. */
function livePreset() {
  const d = useDevice.getState();
  if (d.status !== "connected" || !d.preset) throw new Error(`Connect the ${pedalName(d.device)} (or the simulated pedal) to audition the proposal.`);
  if (d.busy) throw new Error(`Wait until the ${d.busy.kind} finishes.`);
  return d.preset;
}

/** What `block` should become, given the block on the pedal now. */
export function targetOf(block: ProposedBlock, current: BlockSnapshot): BlockSnapshot {
  if (block.fxid === null || !block.params) return { ...current, enabled: block.enabled };
  return { index: block.index, fxid: block.fxid, enabled: block.enabled, params: [...block.params] };
}

/** Play `proposal` on the pedal. Resolves with the blocks as they were, for `restoreBlocks`. */
export async function auditionProposal(proposal: Proposal): Promise<BlockSnapshot[]> {
  const preset = livePreset();
  // Its models and param slots come from one pedal's catalog; the other model may lack them.
  if (proposal.device !== preset.device) throw new Error(`This proposal is for the ${pedalName(proposal.device)}, but the ${pedalName(preset.device)} is connected. Analyse again.`);
  const before = preset.blocks.map(snapshot);
  for (const block of proposal.blocks) {
    const current = useDevice.getState().preset?.blocks[block.index];
    if (!current) throw new Error("The pedal's preset went away during the audition.");
    await editBlock(`Tone Match ${block.code}`, targetOf(block, snapshot(current)));
  }
  return before;
}

/** Put blocks back as they were before an audition. */
export async function restoreBlocks(before: BlockSnapshot[]): Promise<void> {
  livePreset();
  for (const b of before) await editBlock(`Undo Tone Match ${useDevice.getState().preset?.blocks[b.index]?.code ?? ""}`.trim(), b);
}
