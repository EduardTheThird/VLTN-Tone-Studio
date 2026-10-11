import { AudioLines, Guitar, Info, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useSong } from "@/song/store";
import { targetDevice, useToneMatch } from "@/song/tonematch/store";
import { useDevice, usePedalNameOrBoth } from "@/state/device";
import { isGp5Family, pedalName } from "@/state/device-model";
import type { DeviceKey } from "@/state/device-types";
import { familyKeys, listNames } from "@shared/devices";
import { AnalysisCard } from "./AnalysisCard";
import { IrMatchCard } from "./IrMatchCard";
import { PANEL } from "./parts";
import { ProposalCard } from "./ProposalCard";

/** What the analysis can and can't tell, shown above the results. */
function Limits() {
  return (
    <p role="note" className="flex items-start gap-2 text-[12px] text-pretty text-silkscreen-3">
      <Info className="mt-0.5 size-3.5 flex-none" aria-hidden />
      <span>
        A starting point, not the exact gear: it is estimated from a separated stem of a mixed, mastered song. Doubled or multitracked guitars, several
        guitar parts and the mix's own EQ, compression and reverb all end up in the estimate, and the separation leaves some bleed from other instruments.
      </span>
    </p>
  );
}

/** No stems yet: explain, and split (or send the user to the Stems tab to load a song). */
function NeedStems() {
  const source = useSong((s) => s.source);
  const status = useSong((s) => s.status);
  const working = status.kind === "decoding" || status.kind === "model" || status.kind === "splitting";
  // Before any pedal was connected the proposal can be for either model.
  const pedal = usePedalNameOrBoth();
  return (
    <div className="grid flex-1 place-items-center p-6">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Guitar />
          </EmptyMedia>
          <EmptyTitle>Tone match needs the guitar stem</EmptyTitle>
          <EmptyDescription>
            {source
              ? `Split the song into stems first. Tone Studio then listens to the guitar alone: its gain, echo, reverb and tone, and proposes a ${pedal} preset and a matching cabinet IR.`
              : `Open a song in the Stems tab and split it. Tone Studio then listens to the guitar alone and proposes a ${pedal} preset and a matching cabinet IR.`}
          </EmptyDescription>
        </EmptyHeader>
        {source && (
          <EmptyContent className="flex-row justify-center gap-2">
            <Button disabled={working} onClick={() => void useSong.getState().split()}>
              {working ? <Spinner data-icon="inline-start" /> : <AudioLines data-icon="inline-start" />}
              {working ? "Splitting…" : "Split into stems"}
            </Button>
          </EmptyContent>
        )}
      </Empty>
    </div>
  );
}

/** The proposal picks models from the GP-5 family's catalogs; the GP-200 family's aren't mapped to them yet. */
function NotForThisPedal({ device }: { device: DeviceKey }) {
  const pedal = pedalName(device);
  return (
    <div className="grid flex-1 place-items-center p-6">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Guitar />
          </EmptyMedia>
          <EmptyTitle>Tone match isn't available for the {pedal} yet</EmptyTitle>
          <EmptyDescription>
            It proposes presets from the {listNames(familyKeys("gp5"), "and")} effect lists, and the {pedal}'s effects aren't matched to them yet. Splitting a song into stems works with any pedal.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

export function ToneMatchPanel() {
  const stems = useSong((s) => s.stems);
  const status = useToneMatch((s) => s.status);
  const analysis = useToneMatch((s) => s.analysis);
  const proposal = useToneMatch((s) => s.proposal);
  const device = useDevice(targetDevice);

  if (!isGp5Family(device)) return <NotForThisPedal device={device} />;
  if (!stems) return <NeedStems />;

  if (status.kind === "error")
    return (
      <div className="grid flex-1 place-items-center p-6">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTitle>The guitar stem couldn't be analysed</AlertTitle>
          <AlertDescription>
            <p>{status.message}</p>
            <div className="mt-3">
              <Button size="sm" onClick={() => void useToneMatch.getState().analyse()}>
                <RotateCcw data-icon="inline-start" />
                Try again
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );

  if (!analysis || !proposal) {
    const percent = status.kind === "running" ? Math.round(status.fraction * 100) : 0;
    return (
      <div className="grid flex-1 place-items-center p-6">
        <div role="status" className={cn(PANEL, "flex w-full max-w-md flex-col gap-3 px-5 py-4")}>
          <div className="flex items-center gap-2.5 text-[13px]">
            <Spinner />
            <b className="font-semibold">Listening to the guitar stem</b>
            <span className="ml-auto text-silkscreen-2 tabular-nums">{percent}%</span>
          </div>
          <Progress value={percent} aria-label="Analysing the guitar stem" />
          <p className="text-[12px] text-pretty text-silkscreen-3">Gain, echo, reverb and tone, measured on this computer.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[860px] flex-col gap-3.5 pb-6">
        <Limits />
        <ProposalCard proposal={proposal} />
        <AnalysisCard analysis={analysis} />
        <IrMatchCard />
      </div>
    </div>
  );
}
