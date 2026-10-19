import { useEffect, useState } from "react";
import { AudioWaveform, Download, Globe, ListOrdered, RotateCcw, Send, SlidersHorizontal, Wand2, X } from "lucide-react";
import { ARCH_LABEL, gearLabel } from "@shared/tone3000";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { notifyError, notifySuccess } from "@/app/notify";
import { host, isElectron } from "@/host";
import { cn } from "@/lib/utils";
import { noCabIrReason } from "@/screens/tones/CabIrPicker";
import { SnapToneSteps, TestSignalNotice } from "@/screens/tones/SnapToneSteps";
import { useTones } from "@/screens/tones/store";
import { FlowDialog, LocalIrDialog, SplashDialog } from "@/screens/tones/T3kDialogs";
import { checkTestSignal, useTestSignal } from "@/snaptone/signal";
import type { GuitarAnalysis } from "@/song/tonematch/analyse";
import type { CaptureFit } from "@/song/tonematch/capture-match";
import { matchedIrWav, rankedCaptures, useCaptureMatch, type Capture, type CaptureResult } from "@/song/tonematch/capture-store";
import { useSong } from "@/song/store";
import { EQ_CENTERS_HZ } from "@/song/tonematch/refine-offline";
import { targetDevice, useToneMatch } from "@/song/tonematch/store";
import { useDevice } from "@/state/device";
import { isGp5Family, pedalName } from "@/state/device-model";
import { useNav } from "@/state/nav";
import type { OpenFile } from "@/state/ui";
import { GAIN_TEXT } from "./AnalysisCard";
import { CurvePlot } from "./CurvePlot";
import { resultSeries } from "./IrMatchCard";
import { fmtDb, Section } from "./parts";

const TONE_BANDS = [
  ["bassDb", "bass"],
  ["lowMidDb", "low mids"],
  ["midDb", "mids"],
  ["trebleDb", "treble"],
  ["presenceDb", "presence"],
] as const;

/** Why a capture ranks where it does: its gain against the song's, then the two bands furthest from the song. */
function why(fit: CaptureFit, song: GuitarAnalysis): string {
  const gain = `${GAIN_TEXT[fit.gain.gainClass]} ${fit.gain.score.toFixed(2)} (song: ${GAIN_TEXT[song.gain.gainClass].toLowerCase()} ${song.gain.score.toFixed(2)})`;
  const deltas = TONE_BANDS.map(([k, label]) => ({ label, db: fit.tone[k] - song.tone[k] }))
    .filter((d) => Math.abs(d.db) >= 1.5)
    .sort((a, b) => Math.abs(b.db) - Math.abs(a.db))
    .slice(0, 2);
  const tone = deltas.length ? `${deltas.map((d) => `${d.label} ${fmtDb(d.db)}`).join(", ")} against the song` : "tone close to the song";
  const cab = fit.includesCab ? "includes its cab" : "through a cab IR matched to the song";
  return `${gain}; ${tone} (${fit.residualDb.toFixed(1)} dB overall); ${cab}.`;
}

function ResultLine({ result, song }: { result: CaptureResult | undefined; song: GuitarAnalysis }) {
  if (!result) return <span className="text-silkscreen-3">Not ranked yet</span>;
  if (result.kind === "running") return <Progress value={result.fraction * 100} className="mt-1 w-48" aria-label="Rendering the capture" />;
  if (result.kind === "failed") return <span className="text-led-fault">{result.message}</span>;
  return <span className="text-silkscreen-3">{why(result.fit, song)}</span>;
}

function CaptureList({ captures, song, disabled }: { captures: Capture[]; song: GuitarAnalysis; disabled: boolean }) {
  const results = useCaptureMatch((s) => s.results);
  const selected = useCaptureMatch((s) => s.selected);
  return (
    <RadioGroup aria-label="Capture to build the SnapTone from" value={selected ?? ""} onValueChange={(v) => useCaptureMatch.getState().select(v)} disabled={disabled} className="gap-0 border-y border-seam">
      {rankedCaptures(captures, results).map((c) => {
        const r = results[c.key];
        const id = `capture-${c.key}`;
        return (
          <label key={c.key} htmlFor={id} className={cn("flex cursor-pointer items-start gap-3 px-3 py-2 text-[12px] [&+&]:border-t [&+&]:border-seam", selected === c.key && "bg-faceplate")}>
            <RadioGroupItem id={id} value={c.key} className="mt-0.5" />
            <span className="flex min-w-0 grow flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <b className="font-semibold">{c.title}</b>
                {c.modelName !== c.title && <span className="text-silkscreen-2">{c.modelName}</span>}
                <Badge variant="outline">{gearLabel(c.gear)}</Badge>
                <Badge variant="outline">{ARCH_LABEL({ architecture_version: c.architecture, size: c.size })}</Badge>
              </span>
              <ResultLine result={r} song={song} />
            </span>
            {r?.kind === "done" && (
              <span className="text-[13px] font-semibold tabular-nums" title="Match score: 100 is identical gain and tone">
                {r.fit.score}
              </span>
            )}
          </label>
        );
      })}
    </RadioGroup>
  );
}

/** The selected capture: its matched IR, the build, and then the Tones send steps for the built SnapTone. */
function Build({ capture, fit }: { capture: Capture; fit: CaptureFit }) {
  const build = useCaptureMatch((s) => s.build);
  const ranking = useCaptureMatch((s) => s.status.kind === "running");
  const hasSignal = useTestSignal((s) => s.has);
  const device = useDevice(targetDevice);
  const songName = useSong((s) => s.source?.name);
  const send = useTones((s) => (build.kind === "built" && build.key === capture.key ? s.send[build.toneId] : undefined));
  const [irFile, setIrFile] = useState<OpenFile | null>(null);
  const pedal = pedalName(device);
  const ir = fit.ir;
  const irName = `${(songName ?? "Song").replace(/\.[^.]+$/, "")} - ${capture.title} IR.wav`;
  const mine = build.kind !== "idle" && build.key === capture.key;

  const saveIr = async () => {
    if (!ir) return;
    try {
      const where = await host.song.saveFiles([{ name: irName, bytes: matchedIrWav(ir) }], "Save the matched IR");
      if (where) notifySuccess("Saved the matched IR", where);
    } catch (e) {
      notifyError("Couldn't save the IR", e);
    }
  };
  const writeIr = () => ir && setIrFile({ name: irName, path: null, file: new File([matchedIrWav(ir) as BlobPart], irName, { type: "audio/wav" }) });

  const plan = !ir
    ? `${capture.title} includes its cab, so the SnapTone is the capture as it is.`
    : isGp5Family(device)
      ? `The SnapTone gets the cab IR designed for this capture inside it: an engaged SnapTone replaces AMP and CAB on the ${pedal}.`
      : `CAB plays after the SnapTone on the ${pedal}, so the SnapTone is the capture alone. Put the matched IR in a User IR slot and pick that slot in CAB.`;

  return (
    <div className="flex flex-col gap-3 border-t border-seam pt-3">
      {ir && <CurvePlot title={`Correction between ${capture.title} and the song, and the matched IR's response`} series={resultSeries(ir, "this capture")} />}
      <p className="text-[12px] text-pretty text-silkscreen-3">{plan}</p>
      {!(mine && build.kind === "built" && send) && (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={ranking || build.kind === "building" || hasSignal === false} onClick={() => void useCaptureMatch.getState().buildSnapTone()}>
            {mine && build.kind === "building" ? <Spinner data-icon="inline-start" /> : <Wand2 data-icon="inline-start" />}
            Build the SnapTone
          </Button>
          {ir && (
            <>
              <Button variant="outline" onClick={() => void saveIr()}>
                <Download data-icon="inline-start" />
                Save the IR…
              </Button>
              <Button variant="outline" onClick={writeIr}>
                <Send data-icon="inline-start" />
                Write the IR to a User IR slot…
              </Button>
            </>
          )}
        </div>
      )}
      {mine && build.kind === "building" && (
        <div role="status" className="flex items-center gap-3 text-[12px] text-silkscreen-2">
          <span>Making the SnapTone, like Valeton Suite does (about 10 s)</span>
          <Progress value={build.fraction * 100} className="w-48" aria-label="SnapTone conversion progress" />
          <Button size="sm" variant="ghost" onClick={() => useCaptureMatch.getState().cancelBuild()}>
            <X data-icon="inline-start" />
            Cancel
          </Button>
        </div>
      )}
      {mine && build.kind === "error" && (
        <p role="alert" className="text-[12px] text-pretty text-led-fault">
          {build.message}
        </p>
      )}
      {mine && build.kind === "built" && send && (
        <SnapToneSteps
          send={send}
          model={{ id: capture.modelId, name: capture.modelName, size: capture.size, tone_id: capture.toneId, architecture_version: capture.architecture, model_url: "", updated_at: "" }}
          noCabIr={noCabIrReason(device, capture.gear)}
        />
      )}
      <LocalIrDialog file={irFile} onClose={() => setIrFile(null)} />
    </div>
  );
}

const bandLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);

/** Search the drive and EQ that bring a ranked capture closer to the song; the EQ can go into the proposal, the drive is only shown. */
function Refine({ capture }: { capture: Capture }) {
  const r = useCaptureMatch((s) => s.refined[capture.key]);
  const busy = useCaptureMatch((s) => s.status.kind === "running" || Object.values(s.refined).some((x) => x.kind === "running"));
  const hasProposal = useToneMatch((s) => s.proposal !== null);
  const useEq = () => {
    if (useCaptureMatch.getState().applyRefinedEq(capture.key)) notifySuccess("EQ set in the proposal", "The Guitar EQ of the proposal now has the refined bands.");
  };
  return (
    <div className="flex flex-col gap-2 border-t border-seam pt-3">
      <p className="text-[12px] text-pretty text-silkscreen-3">
        Refine: tries input drive and a five-band EQ on this capture and keeps what brings its sound closest to the song's guitar. It plays the test signal through the
        capture many times, so it takes minutes.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void useCaptureMatch.getState().refine(capture.key)}>
          {r?.kind === "running" ? <Spinner data-icon="inline-start" /> : <SlidersHorizontal data-icon="inline-start" />}
          {r?.kind === "done" ? "Refine again" : "Refine against the song"}
        </Button>
        {r?.kind === "running" && (
          <>
            <Progress value={r.fraction * 100} className="w-48" aria-label="Refinement progress" />
            <Button size="sm" variant="ghost" onClick={() => useCaptureMatch.getState().cancel()}>
              <X data-icon="inline-start" />
              Cancel
            </Button>
          </>
        )}
      </div>
      {r?.kind === "failed" && (
        <p role="alert" className="text-[12px] text-pretty text-led-fault">
          {r.message}
        </p>
      )}
      {r?.kind === "done" && (
        <div className="flex flex-col gap-2 text-[12px] text-silkscreen-2">
          <p className="text-pretty">
            Distance from the song {r.refined.initial.toFixed(1)} → {r.refined.distance.toFixed(1)}.{" "}
            <span className="tabular-nums">EQ {EQ_CENTERS_HZ.map((hz, i) => `${bandLabel(hz)} ${fmtDb(r.refined.settings.eqDb[i])}`).join(" · ")}.</span>
          </p>
          <p className="text-pretty text-silkscreen-3">
            Drive {fmtDb(r.refined.settings.driveDb)}: how much harder the capture sounded closest to the song when pushed. For information only; the SnapTone and the proposal
            don't use it.
          </p>
          <div>
            <Button variant="outline" size="sm" disabled={!hasProposal} onClick={useEq}>
              Use the EQ in the proposal
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RankControls({ total }: { total: number }) {
  const status = useCaptureMatch((s) => s.status);
  const unranked = useCaptureMatch((s) => (s.captures ?? []).filter((c) => s.results[c.key]?.kind !== "done").length);
  const refining = useCaptureMatch((s) => Object.values(s.refined).some((x) => x.kind === "running"));
  const rank = () => void useCaptureMatch.getState().rank();
  if (status.kind === "running")
    return (
      <div role="status" className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[12px]">
          <b className="font-semibold">Playing the test signal through capture {Math.min(status.done + 1, status.total)} of {status.total}</b>
          <Button size="sm" variant="ghost" onClick={() => useCaptureMatch.getState().cancel()}>
            <X data-icon="inline-start" />
            Cancel
          </Button>
        </div>
        <Progress value={(status.done / status.total) * 100} aria-label="Ranking progress" />
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      {status.kind === "error" && (
        <p role="alert" className="text-[12px] text-pretty text-led-fault">
          {status.message}
        </p>
      )}
      <TestSignalNotice />
      {unranked > 0 && (
        <div>
          <Button disabled={refining} onClick={rank}>
            {status.kind === "idle" ? <ListOrdered data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
            {status.kind === "error" ? "Try again" : unranked === total ? `Rank ${total} capture${total === 1 ? "" : "s"}` : `Rank the remaining ${unranked}`}
          </Button>
        </div>
      )}
    </div>
  );
}

function PickButton() {
  const pick = useCaptureMatch((s) => s.pick);
  if (!isElectron) return null;
  return (
    <span className="flex flex-col items-start gap-1">
      <Button variant="outline" size="sm" disabled={pick.kind === "adding"} onClick={() => void useCaptureMatch.getState().pickOnTone3000()}>
        {pick.kind === "adding" ? <Spinner data-icon="inline-start" /> : <Globe data-icon="inline-start" />}
        {pick.kind === "adding" ? "Downloading the capture…" : "Pick a capture on TONE3000…"}
      </Button>
      {pick.kind === "error" && (
        <span role="alert" className="text-[11px] text-pretty text-led-fault">
          {pick.message}
        </span>
      )}
    </span>
  );
}

/** Rank the user's downloaded NAM captures against the guitar stem and build a SnapTone from the closest. */
export function SnapToneMatchCard({ analysis }: { analysis: GuitarAnalysis }) {
  const captures = useCaptureMatch((s) => s.captures);
  const selected = useCaptureMatch((s) => s.selected);
  const result = useCaptureMatch((s) => (s.selected ? s.results[s.selected] : undefined));
  const building = useCaptureMatch((s) => s.build.kind === "building");

  // The Tones screen may have downloaded more since the last visit.
  useEffect(() => {
    void useCaptureMatch.getState().load();
    void checkTestSignal();
  }, []);

  const capture = captures?.find((c) => c.key === selected);
  return (
    <Section title="Build a SnapTone from your captures" aside={captures && captures.length > 0 && <PickButton />}>
      <p className="text-[12px] text-pretty text-silkscreen-3">
        Tone Studio plays the guitar part of Valeton's test signal through each NAM capture you have downloaded, puts a capture without a cab through a cab IR designed
        for this song, and ranks them by gain first, then tone, against the guitar stem. The capture you choose becomes a SnapTone. Nothing goes to the pedal until you
        press Write.
      </p>
      {captures === null && <Spinner aria-label="Reading your captures" />}
      {captures?.length === 0 && (
        <div className="flex flex-col items-start gap-2 text-[12px] text-pretty text-silkscreen-2">
          <p>
            You have no amp or pedal captures downloaded yet. In Tones, send captures from your TONE3000 favorites or the trending list; each one you download is ranked
            here. Or pick one on TONE3000 now.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => useNav.getState().go("tones")}>
              <AudioWaveform data-icon="inline-start" />
              Open Tones
            </Button>
            <PickButton />
          </div>
        </div>
      )}
      {captures && captures.length > 0 && (
        <>
          <RankControls total={captures.length} />
          <CaptureList captures={captures} song={analysis} disabled={building} />
          {capture && result?.kind === "done" && <Build capture={capture} fit={result.fit} />}
          {capture && result?.kind === "done" && <Refine capture={capture} />}
        </>
      )}
      <SplashDialog />
      <FlowDialog />
    </Section>
  );
}
