// Device diagnostics that need the OS: USB enumeration, bound driver, Linux /dev/snd/seq access, Valeton Suite running,
// saving the diagnostic report, picking the Valeton Suite program. Owner: Device screen.
import { VALETON_VID, deviceForUsbPid, type DeviceKey } from "../devices";

export interface UsbDeviceInfo {
  vendorId: number;
  productId: number;
  /** USB product string, when the OS reports it */
  product: string | null;
}

export interface LinuxSeqAccess {
  path: string;
  exists: boolean;
  /** The current user can open it for reading and writing */
  accessible: boolean;
  /** Group that owns the device node (usually `audio`) */
  group: string | null;
  /** The current process is in that group */
  inGroup: boolean;
}

export interface HostVersions {
  app: string;
  electron: string | null;
  chrome: string | null;
  node: string | null;
}

export interface DeviceHostStatus {
  checkedAt: number;
  /** "linux 6.9.1 x64", "Windows 10.0.26100 x64", or the browser's user agent */
  os: string;
  versions: HostVersions;
  /** USB devices with Valeton's vendor id; null when this host can't enumerate USB */
  usb: UsbDeviceInfo[] | null;
  /** Driver bound to the pedal's MIDI interface (Linux kernel module, Windows service); null = unknown */
  driver: string | null;
  /** Linux only: access to the ALSA sequencer device */
  linuxSeq: LinuxSeqAccess | null;
  /** A Valeton Suite process is running; null = can't tell */
  suiteRunning: boolean | null;
}

/** Which pedal (normal mode) the host saw on USB; null when none or when USB can't be listed. */
export function pedalOnUsb(status: DeviceHostStatus | null): DeviceKey | null {
  for (const d of status?.usb ?? []) {
    const key = d.vendorId === VALETON_VID ? deviceForUsbPid(d.productId) : null;
    if (key) return key;
  }
  return null;
}

/** A Valeton device that is not a known pedal (firmware update mode) is on USB, and no pedal in normal mode. */
export function updaterOnUsb(status: DeviceHostStatus | null): boolean {
  return !pedalOnUsb(status) && !!status?.usb?.some((d) => d.vendorId === VALETON_VID);
}

export interface DeviceHostApi {
  /** Run the OS-side checks (USB, driver, /dev/snd/seq, Valeton Suite). */
  status(): Promise<DeviceHostStatus>;
  /** Save the diagnostic report through a save dialog. Returns the path, or null when cancelled. */
  saveReport(text: string, fileName: string): Promise<string | null>;
  /** Pick the Valeton Suite program. Returns its path, or null when cancelled. Desktop only. */
  pickSuitePath(): Promise<string | null>;
}
