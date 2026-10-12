// Picks and opens the driver for a pedal by its family (registry: @shared/devices). Families without a driver in this
// build fail with a ConnectionError "unsupported-model" before anything is sent to the pedal.
import { requestAccess } from "@/gp5/lib/transport-webmidi.mjs";
import { deviceForPortName, familyKeys, listNames, profileFor, type DeviceFamily, type DeviceKey } from "@shared/devices";
import type { Gp200FamilyKey } from "@/gp200/lib/session.mjs";
import type { ConnectionError, Gp5FamilyKey } from "../device-types";
import { Gp150Driver } from "./gp150-driver";
import { Gp200Driver } from "./gp200-driver";
import { Gp5Driver } from "./gp5-driver";
import { DRIVER_FAMILIES, SUPPORTED_DEVICE_KEYS, hasDriver, type DeviceDriver, type DriverFamily, type DriverOptions } from "./types";

interface DriverFactory {
  /** Open the ports matching `port` */
  open(access: MIDIAccess, port: string | RegExp, opts: DriverOptions): Promise<DeviceDriver>;
  /** Connect the simulated `device` (one of this family's models) */
  simulate(device: DeviceKey, opts: DriverOptions): Promise<DeviceDriver>;
}

const FACTORIES: Record<DriverFamily, DriverFactory> = {
  gp5: {
    open: (access, port, opts) => Gp5Driver.open(access, port, opts),
    // familyKeys("gp5") are exactly the Gp5FamilyKey models
    simulate: (device, opts) => Gp5Driver.simulate(device as Gp5FamilyKey, opts),
  },
  gp200: {
    open: (access, port, opts) => Gp200Driver.open(access, port, opts),
    // familyKeys("gp200") are exactly the Gp200FamilyKey models
    simulate: (device, opts) => Gp200Driver.simulate(device as Gp200FamilyKey, opts),
  },
  gp150: {
    open: (access, port, opts) => Gp150Driver.open(access, port, opts),
    simulate: (device, opts) => Gp150Driver.simulate(device, opts),
  },
};

/** The connection error for a model this build has no driver for (plain copy for the Device screen). */
export function unsupportedModelError(device: DeviceKey): ConnectionError {
  const { name } = profileFor(device);
  return {
    code: "unsupported-model",
    message: `${name} support is coming in a later version of Tone Studio. This version works with the ${listNames(SUPPORTED_DEVICE_KEYS, "and")}.`,
  };
}

/** Port names of one family, e.g. /GP-5(?!\d)|GP-50(?!\d)/i for the GP-5 family. */
function familyPortPattern(family: DeviceFamily): RegExp {
  const patterns = familyKeys(family).map((k) => profileFor(k).portPattern);
  return new RegExp(patterns.map((p) => `(?:${p.source})`).join("|"), patterns[0].flags);
}

/** Driver family for a port of `device`; an unknown port (null) goes to the first driver, as before the registry. */
function familyFor(device: DeviceKey | null): DriverFamily {
  if (!device) return DRIVER_FAMILIES[0];
  const { family } = profileFor(device);
  if (!hasDriver(family)) throw unsupportedModelError(device);
  return family;
}

/**
 * Open the pedal's MIDI port. `portPattern`: the user's port setting (Settings › Connection), else the first port a
 * known model answers on, preferring models with a driver. Throws a Gp5ConnectError-style `{ code }` for WebMIDI
 * problems (including "not-found" with the visible ports) and a ConnectionError for a model without a driver.
 */
export async function openPort(portPattern: string | undefined, opts: DriverOptions): Promise<DeviceDriver> {
  const access: MIDIAccess = await requestAccess();
  const outputs = [...access.outputs.values()].filter((p) => p.state !== "disconnected").map((p) => p.name ?? "");
  if (portPattern) {
    const named = outputs.find((n) => n === portPattern) ?? outputs.find((n) => n.includes(portPattern));
    return FACTORIES[familyFor(named ? deviceForPortName(named) : null)].open(access, portPattern, opts);
  }
  const found = outputs.map(deviceForPortName).filter((k): k is DeviceKey => k !== null);
  const family = familyFor(found.find((k) => hasDriver(profileFor(k).family)) ?? found[0] ?? null);
  return FACTORIES[family].open(access, familyPortPattern(family), opts);
}

/** Connect the simulated `device`. */
export async function simulate(device: DeviceKey, opts: DriverOptions): Promise<DeviceDriver> {
  return FACTORIES[familyFor(device)].simulate(device, opts);
}
