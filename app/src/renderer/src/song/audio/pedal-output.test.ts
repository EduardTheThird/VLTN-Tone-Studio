import { expect, it } from "vitest";
import { findPedalOutput } from "./pedal-output";

it("finds the connected GP model by name and ignores the system default alias", () => {
  const gp150 = { deviceId: "a", label: "GP-150" };
  const gp180 = { deviceId: "b", label: "USB GP180 Audio" };
  const devices = [{ ...gp180, deviceId: "default" }, gp150, gp180, { deviceId: "hp", label: "Headphones" }];
  expect(findPedalOutput(devices, "gp150")).toBe(gp150);
  expect(findPedalOutput(devices, "gp180")).toBe(gp180);
  expect(findPedalOutput([gp150], "gp180")).toBeNull();
  expect(findPedalOutput([gp150, { ...gp150, deviceId: "other" }], "gp150")).toBeNull();
});

it("keeps the Rig metronome's Valeton matching", () => {
  const pedal = { deviceId: "pedal", label: "GP-200 USB" };
  expect(findPedalOutput([pedal])).toBe(pedal);
  expect(findPedalOutput([{ deviceId: "hp", label: "Headphones" }])).toBeNull();
});
