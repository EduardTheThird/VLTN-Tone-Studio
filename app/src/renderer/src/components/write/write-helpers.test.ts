import { afterEach, describe, expect, it } from "vitest";
import { DeviceError, useDevice } from "@/state/device";
import { describeError } from "./write-helpers";

const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

describe("describeError", () => {
  afterEach(() => useDevice.setState({ device: null }));

  it("keeps the store's plain refusal for a feature behind Experimental pedal commands", () => {
    useDevice.setState({ device: "gp200" });
    const locked = new DeviceError("unsafe", "This needs Experimental pedal commands, which you can turn on in Settings.");
    expect(describeError(locked)).toBe(locked.message);
    expect(describeError(failure("unsafe", "refusing to send a destructive frame"))).toMatch(/data looked wrong\. Nothing was sent/);
  });

  it("says a GP-200 write the pedal read back nothing for isn't confirmed, and an unacknowledged GP-5 frame left the slot alone", () => {
    useDevice.setState({ device: "gp200" });
    expect(describeError(failure("verify", "slot 12-C not verified after 3 writes: the pedal did not answer the read-back"), 46)).toBe(
      "The GP-200 didn't answer when Tone Studio read slot 12-C back, so the write isn't confirmed. Retry, or restore slot 12-C from the backup.",
    );
    useDevice.setState({ device: "gp5" });
    expect(describeError(failure("verify", "frame 4/26 not acknowledged after 3 attempts; slot 7 unchanged"), 7)).toMatch(/discarded the write\. Slot 07 was not changed/);
  });
});
