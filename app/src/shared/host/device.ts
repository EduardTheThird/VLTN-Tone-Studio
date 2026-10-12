// Device diagnostics that need the OS: USB enumeration, bound driver, Linux /dev/snd/seq access, Valeton apps running
// (Valeton Suite, the GP-200 editor), saving the diagnostic report, picking the Valeton Suite program. Owner: Device screen.
import { VALETON_VID, deviceForUsbPid, profileFor, type DeviceKey } from "../devices";

/** Windows' MIDI 2.0 class driver (service "usbmidi2", name "USB MIDI 2.0 Device"): the port shows, SysEx doesn't pass. */
export const MIDI2_DRIVER_RE = /midi\s*2|usbmidi2/i;
/** Windows' generic USB audio class driver (wdma_usb.inf, service "usbaudio"): the one that works with the pedals. */
export const GENERIC_DRIVER_RE = /usbaudio/i;

export interface UsbDeviceInfo {
  vendorId: number;
  productId: number;
  /** USB product string, when the OS reports it */
  product: string | null;
}

/** One USB interface of a Valeton device, as far as the host can tell. */
export interface UsbInterfaceInfo {
  productId: number;
  iface: number;
  /** Bound driver: Windows service, Linux kernel driver; null = none */
  service: string | null;
  /** Windows device name ("USB Audio Device"); null on Linux */
  name: string | null;
  /** USB audio class, MIDIStreaming subclass (01/03) */
  midi: boolean;
}

/** Valeton apps that may hold a pedal's port. */
export interface VendorAppsRunning {
  suite: boolean;
  gp200Editor: boolean;
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
  /** Every interface of the Valeton devices on USB; null = this host can't list them (macOS, browser) */
  usbInterfaces: UsbInterfaceInfo[] | null;
  /** Valeton apps running; null = can't tell */
  vendorApps: VendorAppsRunning | null;
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

export type VendorApp = "suite" | "gp200-editor";

/** Valeton apps that may hold `device`'s port; null = unknown model, check both. */
export function portHolders(device: DeviceKey | null): VendorApp[] {
  if (!device) return ["suite", "gp200-editor"];
  return profileFor(device).family === "gp200" ? ["gp200-editor"] : ["suite"];
}

/** First running app of portHolders(device), or null (none, or the host can't tell). */
export function runningPortHolder(status: DeviceHostStatus | null, device: DeviceKey | null): VendorApp | null {
  const apps = status?.vendorApps;
  if (!apps) return null;
  return portHolders(device).find((app) => (app === "suite" ? apps.suite : apps.gp200Editor)) ?? null;
}

export interface DeviceHostApi {
  /** Run the OS-side checks (USB, driver, /dev/snd/seq, Valeton apps). */
  status(): Promise<DeviceHostStatus>;
  /** Save the diagnostic report through a save dialog. Returns the path, or null when cancelled. */
  saveReport(text: string, fileName: string): Promise<string | null>;
  /** Pick the Valeton Suite program. Returns its path, or null when cancelled. Desktop only. */
  pickSuitePath(): Promise<string | null>;
}
