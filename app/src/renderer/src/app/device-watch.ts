import { useEffect } from "react";
import { toast } from "sonner";
import { useGp200Catalog } from "@/gp200/app/catalog-store";
import { host } from "@/host";
import { profileFor } from "@shared/devices";
import { useDevice } from "@/state/device";
import { pedalName } from "@/state/device-model";
import { useNav } from "@/state/nav";
import { reconnect } from "./commands";
import { notifySuccess, showToast } from "./notify";

/**
 * Shell reactions to the device store: a toast when the pedal goes away or comes back (overlays.md C/G), a hint while a
 * GP-200 family pedal is connected without its effect list, and taskbar/dock progress for long jobs (electron.md ›
 * Hardware access).
 */
export function useDeviceWatch(): void {
  useEffect(() => {
    let lostAt: number | null = null;
    let lastProgress: number | null = null;
    let catalogHint: string | number | null = null;
    const dropHint = () => {
      if (catalogHint !== null) toast.dismiss(catalogHint);
      catalogHint = null;
    };
    const offDevice = useDevice.subscribe((s, prev) => {
      if (prev.status === "connected" && s.status === "disconnected" && s.disconnectReason === "lost") {
        lostAt = Date.now();
        const edits = s.unsavedChanges;
        showToast({
          tone: "fault",
          title: `The ${pedalName(s.device)} disconnected`,
          body: `Check the USB cable and power. Tone Studio tries to reconnect on its own.${edits ? ` Your ${edits} unsaved change${edits === 1 ? " is" : "s are"} still here.` : ""}`,
          action: { label: "Reconnect", run: reconnect, retry: true },
        });
      }
      if (s.status === "connected" && prev.status !== "connected" && lostAt !== null) {
        lostAt = null;
        notifySuccess(`The ${pedalName(s.device)} is back`, "Reconnected over USB.", { label: "Open Rig", run: () => useNav.getState().go("rig") });
      }
      // The store reads the catalog before it reports a GP-200 family pedal connected; the Device screen has the panel.
      const missing = s.status === "connected" && s.device !== null && profileFor(s.device).family === "gp200" && !useGp200Catalog.getState().catalog;
      if (missing && prev.status !== "connected" && catalogHint === null && useNav.getState().screen !== "device")
        catalogHint = showToast({
          tone: "info",
          title: "No GP-200 effect list yet",
          body: "Effects show as numbers and their knobs can't be edited until you import the list from Valeton's GP-200 editor on the Device screen.",
          action: { label: "Open Device", run: () => useNav.getState().go("device") },
          sticky: true,
        });
      if (s.status !== "connected") dropHint();
      const progress = s.busy && s.busy.kind !== "sync" ? s.busy.progress : null;
      if (progress !== lastProgress && (progress === null || lastProgress === null || Math.abs(progress - lastProgress) >= 0.01)) {
        lastProgress = progress;
        void host.app.setProgress(progress).catch(() => {});
      }
    });
    const offCatalog = useGp200Catalog.subscribe((c) => {
      if (c.catalog) dropHint();
    });
    return () => {
      offDevice();
      offCatalog();
    };
  }, []);
}
