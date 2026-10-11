import { forwardRef, useEffect } from "react";
import { CircleCheck, CircleX, ExternalLink, Heart, Link2, Speaker } from "lucide-react";
import type { T3kTone, ToneRecord } from "@shared/host/tones";
import { gearLabel, slotLinkOn, toneVerdict, verdictLabel, type Verdict } from "@shared/tone3000";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useDevice, usePedalNameOrBoth, useProfile } from "@/state/device";
import { pedalName } from "@/state/device-model";
import type { DeviceKey } from "@/state/device-types";
import { irSlotLabel, requestImage, useTones } from "./store";
import { ToneImage } from "./ToneImage";

export function CreatorAvatar({ username, url, className }: { username: string; url: string | null; className?: string }) {
  const data = useTones((s) => (url ? s.images[url] : null));
  useEffect(() => {
    if (url) requestImage(url);
  }, [url]);
  return (
    <Avatar className={cn("size-[18px] shadow-[inset_0_0_0_1px_var(--seam-strong)]", className)}>
      {data && <AvatarImage src={data} alt="" />}
      <AvatarFallback className="bg-surface-solid-raised text-[11px] font-semibold text-silkscreen-2">{username.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Linked beats every other verdict: the tone is already on the pedal. A link made on the other model (`device` is
 * the connected or last pedal) names that model, since its slot numbers mean nothing on this one.
 */
export function linkLabel(record: ToneRecord | undefined, device: DeviceKey | null): string | null {
  const link = slotLinkOn(record, device);
  if (!link) return null;
  const slot = link.kind === "snaptone" ? `SnapTone ${link.slot}` : irSlotLabel(link.slot);
  return link.other ? `Linked to ${slot} on your ${pedalName(link.other)}` : `Linked to ${slot}`;
}

/**
 * `model`: the pedal name, or "GP-5 / GP-50" before the first connection (both take the same SnapTones and IRs);
 * `irSlots`: its User IR slot count.
 */
function verdictReason(kind: string, model: string, irSlots: number): string {
  switch (kind) {
    case "ready":
      return `This tone has NAM A1 or A2 models. Tone Studio turns them into ${model} SnapTones the way Valeton Suite does.`;
    case "reshape":
      return "The A1 file is in NAM 0.7 format. Tone Studio converts it to the 0.5 layout Valeton Suite imports, without changing the sound.";
    case "ir":
      return `Tone Studio writes IRs over USB to one of the ${model}'s ${irSlots} User IR slots. The pedal keeps the first 11.6 ms.`;
    case "custom":
      return "This tone uses a custom NAM layout. Tone Studio can't turn it into a SnapTone.";
    default:
      return `The ${model} takes SnapTones made from NAM captures, and WAV IRs.`;
  }
}

export function CompatVerdict({ verdict, linked, className }: { verdict: Verdict; linked: string | null; className?: string }) {
  const model = usePedalNameOrBoth();
  const irSlots = useProfile().userIr.slots;
  const ok = verdict.kind === "ready" || verdict.kind === "reshape";
  const Icon = linked ? Link2 : verdict.kind === "ir" ? Speaker : ok ? CircleCheck : CircleX;
  const reason = verdictReason(verdict.kind === "not-loadable" ? verdict.reason : verdict.kind, model, irSlots);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "flex items-start gap-1.5 text-[12px] leading-[1.3]",
            verdict.kind === "not-loadable" && !linked ? "text-silkscreen-3" : "text-silkscreen-2",
            className,
          )}
        >
          <Icon
            className={cn(
              "mt-px size-3.5 flex-none",
              linked || ok ? "text-led-on" : verdict.kind === "ir" ? "text-silkscreen-3" : "text-silkscreen-4",
            )}
            aria-hidden
          />
          {linked ?? verdictLabel(verdict, model)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{reason}</TooltipContent>
    </Tooltip>
  );
}

export const ToneCard = forwardRef<
  HTMLButtonElement,
  { tone: T3kTone; record?: ToneRecord; tabIndex: number; onOpen: () => void; onFocus: () => void }
>(function ToneCard({ tone, record, tabIndex, onOpen, onFocus }, ref) {
  const verdict = toneVerdict(tone, record);
  const device = useDevice((s) => s.device);
  return (
    <button
      ref={ref}
      type="button"
      tabIndex={tabIndex}
      onClick={onOpen}
      onFocus={onFocus}
      data-tone-card
      className="flex min-w-0 flex-col overflow-hidden rounded-lg bg-card text-left shadow-[0_0_0_1px_var(--seam)] transition-colors duration-[120ms] hover:bg-faceplate-raised"
    >
      <ToneImage url={tone.images?.[0] ?? null} gear={tone.gear} format={tone.format} alt="">
        <Badge variant="outline" className="absolute top-2 left-2 bg-faceplate-raised">{tone.format === "ir" ? "IR" : tone.format.toUpperCase()}</Badge>
      </ToneImage>
      <span className="flex flex-1 flex-col gap-1 px-3 pt-2.5 pb-3">
        <b className="line-clamp-2 leading-[1.3] font-semibold text-pretty text-silkscreen">{tone.title}</b>
        <span className="text-[12px] text-silkscreen-3">{gearLabel(tone.gear)}</span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-silkscreen-2">
          <CreatorAvatar username={tone.user.username} url={tone.user.avatar_url} />
          <span className="truncate">{tone.user.display_name ?? tone.user.username}</span>
        </span>
        <span className="mt-auto pt-2">
          <span className="block border-t border-seam pt-2">
            <CompatVerdict verdict={verdict} linked={linkLabel(record, device)} />
          </span>
        </span>
      </span>
    </button>
  );
});

/** Ends every list (TONE3000 requirement 4f): a path to the full catalog. */
export function DiscoverCard({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="flex min-w-0 flex-col items-start justify-center gap-2 rounded-lg p-5 shadow-[inset_0_0_0_1px_var(--seam-strong)]">
      <Heart className="size-5 text-silkscreen-3" aria-hidden />
      <b className="text-[15px] font-[650] text-balance">Find more on TONE3000</b>
      <p className="mb-1 text-[12px] text-pretty text-silkscreen-3">Thousands of NAM captures and IRs of real gear. Favorite one there and it shows up here.</p>
      <Button variant="outline" size="sm" onClick={onBrowse}>
        <ExternalLink data-icon="inline-start" />
        Browse TONE3000
      </Button>
    </div>
  );
}

export function ToneCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg bg-card shadow-[0_0_0_1px_var(--seam)]" aria-hidden>
      <Skeleton className="aspect-[16/10] rounded-none" />
      <div className="flex flex-col gap-2 px-3 pt-3 pb-4">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}
