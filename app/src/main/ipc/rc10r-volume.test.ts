import { describe, expect, it } from "vitest";
import { ejectWithRetry, rc10rDiskInfo } from "./rc10r-volume";
const root = "/Volumes/BOSS RC-10R";
const xml = `<plist><dict><key>MountPoint</key><string>${root}</string><key>DeviceIdentifier</key><string>disk4s1</string><key>VolumeUUID</key><string>AAAA-BBBB</string><key>Internal</key><false/><key>FilesystemType</key><string>msdos</string></dict></plist>`;
it("requires a removable FAT volume with an OS mount point and stable UUID", () => {
  expect(rc10rDiskInfo(xml, root)).toBe("AAAA-BBBB");
  for (const invalid of [
    xml.replace("<false/>", "<true/>"),
    xml.replace("msdos", "apfs"),
    xml.replace("AAAA-BBBB", ""),
    xml.replace("disk4s1", "../../../tmp"),
    xml.replace(root, "/tmp/copy"),
  ])
    expect(() => rc10rDiskInfo(invalid, root)).toThrow();
});

describe("RC-10R eject retry (spec 175)", () => {
  it("retries while macOS reports the drive busy, then succeeds", async () => {
    const waits: number[] = [];
    let calls = 0;
    await ejectWithRetry(
      async () => {
        if (++calls < 3) throw new Error("Unmount of disk8 failed: at least one volume could not be unmounted");
      },
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(calls).toBe(3);
    expect(waits).toEqual([1000, 2000]);
  });
  it("gives a plain message after the last retry and reports other errors at once", async () => {
    await expect(ejectWithRetry(async () => Promise.reject(new Error("Resource busy")), async () => {})).rejects.toThrow("Eject BOSS RC-10R in Finder");
    let calls = 0;
    await expect(
      ejectWithRetry(async () => {
        calls++;
        throw new Error("Permission denied");
      }, async () => {}),
    ).rejects.toThrow("Permission denied");
    expect(calls).toBe(1);
  });
});
