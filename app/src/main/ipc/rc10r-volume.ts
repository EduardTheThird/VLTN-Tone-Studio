import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { HostError } from "@shared/ipc";
import type { Rc10rVolume } from "./rc10r-store";

const exec = promisify(execFile);

/** Disk identity is obtained from macOS, never from a renderer-provided path or volume label alone. */
export function rc10rDiskInfo(xml: string, root: string): string {
  const text = (key: string) => new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(xml)?.[1];
  const device = text("DeviceIdentifier"),
    uuid = text("VolumeUUID");
  if (
    text("MountPoint") !== root ||
    !device ||
    !/^disk\d+s\d+$/.test(device) ||
    !uuid ||
    !/^[a-zA-Z0-9-]{4,80}$/.test(uuid) ||
    !/<key>Internal<\/key>\s*<false\s*\/>/.test(xml) ||
    !["msdos", "exfat"].includes(text("FilesystemType") ?? "")
  )
    throw new HostError("invalid", "This is not a supported removable RC-10R storage volume.");
  return uuid;
}

async function info(root: string): Promise<string> {
  const { stdout } = await exec("/usr/sbin/diskutil", ["info", "-plist", root], { timeout: 10000, maxBuffer: 128 * 1024 });
  return rc10rDiskInfo(stdout, root);
}

/** macOS storage transfer is beta; other platforms retain the native-bank file export. */
export async function findRc10rVolumes(): Promise<Rc10rVolume[]> {
  if (process.platform !== "darwin")
    throw new HostError("unsupported", "Native RC-10R sending currently requires macOS. Export the rhythm files on this platform.");
  const result: Rc10rVolume[] = [];
  for (const name of await readdir("/Volumes")) {
    if (!/^BOSS RC-10R(?: \d+)?$/.test(name)) continue;
    const root = join("/Volumes", name),
      stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(root)) !== root) continue;
    result.push({ root, identity: await info(root) });
  }
  return result;
}

/** OS eject must finish before the renderer asks the pedal to leave editor mode. */
export async function ejectRc10rVolume(volume: Rc10rVolume): Promise<void> {
  try {
    await lstat(volume.root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if ((await info(volume.root)) !== volume.identity) throw new HostError("invalid", "The mounted device changed. It was not ejected.");
  await exec("/usr/sbin/diskutil", ["eject", volume.root], { timeout: 20000, maxBuffer: 128 * 1024 });
  try {
    await lstat(volume.root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new HostError("io", "RC-10R storage is still mounted. Finish ejecting it before leaving editor mode.");
}
