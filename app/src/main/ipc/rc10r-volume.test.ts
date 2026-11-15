import { expect, it } from "vitest";
import { rc10rDiskInfo } from "./rc10r-volume";
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
