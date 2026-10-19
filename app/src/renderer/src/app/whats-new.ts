import { useEffect } from "react";
import { isElectron } from "@/host";
import { useUi } from "@/state/ui";
import { isReturningUser, loadWhatsNewSeen, saveWhatsNewSeen, shouldShowWhatsNew } from "@/state/whats-new";

const modalOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');

/** Opens the release notes once after an upgrade (desktop only), unless another dialog (an update prompt) is up. Mount once (AppShell). */
export function useWhatsNewOnLaunch(): void {
  useEffect(() => {
    if (!isElectron) return;
    const seen = loadWhatsNewSeen();
    if (!shouldShowWhatsNew(seen, isReturningUser())) return saveWhatsNewSeen();
    const t = setTimeout(() => !modalOpen() && useUi.getState().setWhatsNewOpen(true), 1500);
    return () => clearTimeout(t);
  }, []);
}
