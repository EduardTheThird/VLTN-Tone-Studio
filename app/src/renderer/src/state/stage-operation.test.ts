import { afterEach, expect, it, vi } from "vitest";
import { claimStageOperation, stageOperationActive } from "./stage-operation";
import { resetStageActivity, setStageBusy, useStageActivity } from "./stage-activity";
afterEach(() => {
  resetStageActivity();
  vi.useRealTimers();
});
it("claims an idle stage synchronously and refuses playback or another transfer owner", () => {
  setStageBusy(true, "playing");
  expect(() => claimStageOperation({})).toThrow(/Stop playback/);
  resetStageActivity();
  const release = claimStageOperation({});
  try {
    expect(stageOperationActive()).toBe(true);
    expect(useStageActivity.getState().busy).toBe(true);
    expect(() => claimStageOperation({})).toThrow();
  } finally {
    release();
  }
  expect(stageOperationActive()).toBe(false);
  release();
});
