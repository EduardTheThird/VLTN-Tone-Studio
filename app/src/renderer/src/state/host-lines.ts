// The host checks in plain text, shared by the diagnostic report and the session log.
import type { DeviceHostStatus } from "@shared/host/device";

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

/** "USB (vendor 84EF): …", "Driver: …", "USB interfaces: …", "/dev/snd/seq: …" (Linux), "Valeton apps running: …". */
export function hostLines(h: DeviceHostStatus | null): string[] {
  return [
    `USB (vendor 84EF): ${h?.usb ? h.usb.map((d) => `${hex4(d.vendorId)}:${hex4(d.productId)}${d.product ? ` ${d.product}` : ""}`).join(", ") || "none" : "not available"}`,
    `Driver: ${h?.driver ?? "unknown"}`,
    `USB interfaces: ${h?.usbInterfaces ? h.usbInterfaces.map((i) => `${hex4(i.productId)} MI_${i.iface.toString(16).toUpperCase().padStart(2, "0")} ${i.service ?? "no driver"}${i.name ? ` (${i.name})` : ""}${i.midi ? " [MIDI]" : ""}`).join(", ") || "none" : "not available"}`,
    ...(h?.linuxSeq ? [`/dev/snd/seq: ${h.linuxSeq.exists ? (h.linuxSeq.accessible ? "accessible" : "no access") : "missing"}, group ${h.linuxSeq.group ?? "?"}, member ${h.linuxSeq.inGroup ? "yes" : "no"}`] : []),
    `Valeton apps running: ${h?.vendorApps ? `Suite ${h.vendorApps.suite ? "yes" : "no"}, GP-200 editor ${h.vendorApps.gp200Editor ? "yes" : "no"}` : "unknown"}`,
  ];
}
