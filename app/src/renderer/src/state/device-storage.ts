// What the device store remembers across launches (localStorage): the last pedal model, its slot names and when a
// pedal was last connected. Every read survives missing or corrupt storage.
import { isDeviceKey, type DeviceKey } from "@shared/devices";
import type { SlotName } from "./device-types";

const NAMES_KEY = "gp5.names.v1";
const LAST_CONNECTED_KEY = "gp5.lastConnected.v1";
/** Model of the last connected pedal (a DeviceKey). */
const DEVICE_KEY = "gp5.device.v1";

/**
 * Model of the last connected pedal. Before this key existed only the GP-5 was supported, so a user who connected
 * before (LAST_CONNECTED_KEY set) had a GP-5.
 */
export function loadDevice(): DeviceKey | null {
  try {
    const v = localStorage.getItem(DEVICE_KEY);
    if (isDeviceKey(v)) return v;
    return localStorage.getItem(LAST_CONNECTED_KEY) ? "gp5" : null;
  } catch {
    return null;
  }
}

export function saveDevice(device: DeviceKey) {
  try {
    localStorage.setItem(DEVICE_KEY, device);
  } catch {
    /* storage unavailable: the model is detected again on connect */
  }
}

/** Cached slot names of `device`'s pedal; entries written before the GP-50 existed belong to a GP-5. */
export function loadCachedNames(device: DeviceKey | null): SlotName[] {
  try {
    const env = JSON.parse(localStorage.getItem(NAMES_KEY) ?? "null");
    if (env?.v === 1 && Array.isArray(env.names) && (env.device ?? "gp5") === device) return env.names;
  } catch {
    /* corrupt cache: start empty */
  }
  return [];
}

export function cacheNames(device: DeviceKey | null, names: SlotName[]) {
  if (!device) return;
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify({ v: 1, device, names }));
  } catch {
    /* storage full or unavailable: the cache is only an optimisation */
  }
}

export function loadLastConnected(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_CONNECTED_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveLastConnected(at: number) {
  try {
    localStorage.setItem(LAST_CONNECTED_KEY, String(at));
  } catch {
    /* storage unavailable: "last connected" is informational only */
  }
}
