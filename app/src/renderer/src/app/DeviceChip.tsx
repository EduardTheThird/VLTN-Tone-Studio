import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { host } from "@/host";
import { connectionView } from "@/screens/device/guidance";
import { useDevice, useProfile } from "@/state/device";
import { attachedDevice, pedalName } from "@/state/device-model";
import { useNav } from "@/state/nav";

const LED = { on: "bg-led-on", off: "bg-led-off", warn: "bg-led-warn", fault: "bg-led-fault" } as const;

/** Connection state in the title bar (mockup device-chip variants); opens the Device screen. */
export function DeviceChip() {
  const status = useDevice((s) => s.status);
  const mode = useDevice((s) => s.mode);
  const error = useDevice((s) => s.error);
  const hostStatus = useDevice((s) => s.hostStatus);
  const disconnectReason = useDevice((s) => s.disconnectReason);
  const lastConnectedAt = useDevice((s) => s.lastConnectedAt);
  const portName = useDevice((s) => s.portName);
  const device = useDevice((s) => s.device);
  // The pedal being connected (or on USB) before a remembered other model
  const attached = attachedDevice({ status, hostStatus, device, portName });
  const pedal = pedalName(attached);
  const { slotCount } = useProfile();
  const chipName = attached ? pedal : "Pedal";
  const go = useNav((s) => s.go);
  const view = connectionView({ status, error, mode, hostStatus, platform: host.platform, disconnectReason, lastConnectedAt, device, portName });
  const detail = status === "connected" ? (mode === "mock" ? `Simulated ${pedal} with ${slotCount} preset slots` : `MIDI port ${portName}`) : `${view.state}: ${view.detail}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => go("device")}
          aria-label={`${chipName}: ${view.chip}. Open Device`}
          className="no-drag glass-float flex h-8 items-center gap-2 rounded-pill px-3 text-xs text-silkscreen-2 shadow-[var(--glass-shine),0_0_0_1px_var(--glass-edge),0_4px_16px_rgb(0_0_0/0.3)] transition-colors hover:text-silkscreen"
        >
          <span className={cn("size-[7px] shrink-0 rounded-full", LED[view.led])} aria-hidden />
          <b className="font-semibold text-silkscreen">{chipName}</b>
          <span className="text-silkscreen-3">{view.chip}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72">
        {detail}
      </TooltipContent>
    </Tooltip>
  );
}
