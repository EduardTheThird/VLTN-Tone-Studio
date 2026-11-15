import { setStageBusy, useStageActivity } from "./stage-activity";

let owner: object | undefined;
/** File transfer owns the pedal until storage is ejected and editor mode has ended. */
export const stageOperationActive = () => owner !== undefined;

/** Acquires an idle stage synchronously, before the first permission prompt or asynchronous request. */
export function claimStageOperation(next: object): () => void {
  if (owner || useStageActivity.getState().busy) throw new Error("Stop playback and pedal jobs before opening native transfer.");
  owner = next;
  setStageBusy(true, next);
  return () => {
    if (owner !== next) return;
    owner = undefined;
    setStageBusy(false, next);
  };
}
