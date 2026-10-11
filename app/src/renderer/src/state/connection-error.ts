// Connection failures → the stable ConnectionError (a fixed code plus a plain message) the Device screen explains.
import { profileFor, type DeviceKey } from "@shared/devices";
import { pedalOnUsb, updaterOnUsb, type DeviceHostStatus } from "@shared/host/device";
import { pedalNameOrBoth } from "./device-model";
import { unsupportedModelError } from "./driver";
import { hasDriver } from "./driver/types";
import type { ConnectionError, ConnectionErrorCode } from "./device-types";

const CONNECT_CODES: Record<string, ConnectionErrorCode> = {
  "no-webmidi": "unsupported",
  insecure: "insecure",
  permission: "permission",
  "sysex-denied": "no-sysex",
  "chrome-152": "broken-browser",
  "not-found": "not-found",
};

/** `device`: the pedal model for the copy; unknown → every supported model ("GP-5 / GP-50"). */
export function toConnectionError(e: unknown, gotBytes: boolean, device: DeviceKey | null): ConnectionError {
  const pedal = pedalNameOrBoth(device);
  const err = e as { code?: string; message?: string; visiblePorts?: string[] };
  if (err?.code && CONNECT_CODES[err.code]) return { code: CONNECT_CODES[err.code], message: err.message ?? String(e), ports: err.visiblePorts };
  if (err?.code === "timeout")
    return gotBytes
      ? { code: "timeout", message: `The pedal answered but not like a ${pedal}. Check the firmware or the device.` }
      : { code: "busy", message: `The ${pedal} port is open but silent. Close Valeton Suite, then reconnect.` };
  if (err?.code === "length") return { code: "unknown", message: err.message ?? `Unexpected reply length (is this a ${pedal}?)` };
  return { code: "unknown", message: err?.message ?? String(e) };
}

/**
 * Use the host's USB view to sharpen a failed connect: no port + a Valeton device in update mode = "bootloader";
 * a pedal on USB that this version has no driver for = "unsupported-model" (e.g. a GP-200 in Legacy USB mode, no MIDI).
 */
export function refineConnectionError(error: ConnectionError, status: DeviceHostStatus | null): ConnectionError {
  if (error.code !== "not-found" && error.code !== "busy" && error.code !== "timeout") return error;
  if (updaterOnUsb(status)) return { ...error, code: "bootloader", message: "The pedal is in firmware update mode. The app sends nothing until it restarts normally." };
  const onUsb = pedalOnUsb(status);
  return onUsb && !hasDriver(profileFor(onUsb).family) ? unsupportedModelError(onUsb) : error;
}
