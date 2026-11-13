import { expect, it } from "vitest";
import { clock, tempo } from "./format";

it("shows a clock as m:ss", () => {
  expect(clock(0)).toBe("0:00");
  expect(clock(330)).toBe("5:30");
  expect(clock(329.99)).toBe("5:29");
  expect(clock(-3)).toBe("0:00");
  expect(clock(Number.NaN)).toBe("0:00");
});

it("shows a whole tempo without a decimal and any other with one", () => {
  expect(tempo(150)).toBe("150 BPM");
  expect(tempo(149.9)).toBe("149.9 BPM");
  expect(tempo(149.96)).toBe("150 BPM");
});
