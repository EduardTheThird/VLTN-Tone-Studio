import { gpReceiveChannel, ownedPedalChannels, rigChannelIssues, type RigChannelIssue } from "@/song/performance/my-rig";
import { manualPresetProfiles } from "@/song/performance/pedal-preset-names";
import { withToneWarnings } from "@/song/performance/tone-preflight";
import { knownPresetNames } from "./use-preset-names";
import { ArrangementAdvice } from "./ArrangementAdvice";
import { PlaylistPreflightIssues } from "./PlaylistPreflightIssues";
import { PreparationSequenceDetails, preparationSeconds } from "./PreparationSequenceDetails";
import { usePreparationDefaults } from "@/song/performance/start-preparation";
import { readLeadInDefaults, songCountIn } from "@/song/performance/lead-in";
import { useEffect, useRef, useState } from "react";
import { isRenderedAhead, useSongLibrary } from "@/song/library";
import { host } from "@/host";
import { Button } from "@/components/ui/button";
import { useNav } from "@/state/nav";
import { useBluetooth } from "@/bluetooth/connection";
import { useOutputSettings } from "@/song/audio/output-settings";
import { separateClickPair } from "@/song/audio/outputs";
import { sharedPlaybackEngine } from "@/song/audio/playback-engine";
import { isMetronomeMode, readGlobalMetronome } from "@/song/performance/rhythm";
import { rememberedPort, useMidiConfiguration } from "@/song/performance/midi-configuration";
import { configuredPedals, usePedalLibrary } from "@/song/performance/pedal-library";
import { currentRigFacts } from "@/song/performance/rig-facts";
import { playlistPreflight, type PlaylistCheck } from "@/song/performance/playlist-preflight";
import { songEntries } from "@/song/performance/song-triggers";
import type { LibrarySong } from "@shared/song-library";
import { rhythmControlOverrides } from "@/song/performance/rhythm-automation";
import { flushSettings, onSettingsChange, LIBRARY_PREFIX } from "@/song/performance/settings";
interface VerifiedRoutes {
  audio: string;
  midi: string;
  warnings: string[];
  errors: string[];
}

async function verifyRoutes(snapshot: Awaited<ReturnType<NonNullable<typeof host.song.library>["preflight"]>>): Promise<VerifiedRoutes> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const outputs = useOutputSettings.getState().config;
  let audio = "Audio route is unverified.";
  try {
    const { router } = sharedPlaybackEngine();
    await router.apply(outputs);
    const route = router.activeRoute;
    if (!route) throw new Error("No active audio route.");
    audio = `Main: ${route.main} · Click: ${route.click}`;
    if (route.mainFallback || route.main === "Unverified") {
      const [mainProblem, ...otherWarnings] = route.warnings;
      if (mainProblem) errors.push(mainProblem);
      warnings.push(...otherWarnings);
    } else warnings.push(...route.warnings);
    const globalClick = readGlobalMetronome();
    const defaults = readLeadInDefaults();
    const usesClick = snapshot.some(({ song }) => {
      if (!song) return false;
      let mode: unknown;
      try {
        mode = JSON.parse(song.settings[":options"] || "{}")?.metronomeMode;
      } catch {
        // Preflight also checks the saved settings separately.
      }
      return (isMetronomeMode(mode) ? mode : globalClick) !== "off" || songCountIn(song.settings, defaults).countInBars > 0;
    });
    if (usesClick && !outputs.clickDevice && !separateClickPair(outputs)) warnings.push("Click or count-in shares Main and will reach the PA if Main feeds it.");
  } catch {
    warnings.push("Audio outputs could not be checked. Open Audio outputs and test the main and click routes.");
  }
  let midi = "No MIDI output configured.";
  const selected = useMidiConfiguration.getState().output;
  if (selected) {
    try {
      const port = selected.transport === "bluetooth"
        ? useBluetooth.getState().connection
        : rememberedPort([...(await navigator.requestMIDIAccess()).outputs.values()], selected);
      if (port?.state !== "connected") throw new Error("Port disconnected.");
      midi = `MIDI: ${selected.name} is connected. Check cue arming and pedal response at rehearsal.`;
    } catch {
      midi = `MIDI: ${selected.name} could not be verified.`;
      warnings.push("Connect the selected MIDI output or choose an available port in the MIDI setup.");
    }
  }
  return { audio, midi, warnings, errors };
}

export function PlaylistPreflight({
  ids,
  disabled,
  revision,
  songs,
  autoStart = false,
  compact = false,
}: {
  ids: string[];
  disabled: boolean;
  revision: unknown;
  songs: readonly LibrarySong[];
  autoStart?: boolean;
  compact?: boolean;
}) {
  const preparationDefaults = usePreparationDefaults((state) => state.settings);
  const config = useMidiConfiguration(),
    pedals = usePedalLibrary();
  const [report, setReport] = useState<PlaylistCheck[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  const checked = useRef(autoStart);
  const [verified, setVerified] = useState<VerifiedRoutes | null>(null);
  const outputConfig = useOutputSettings((state) => state.config);
  const [rigWarnings, setRigWarnings] = useState<RigChannelIssue[]>([]);
  const [fullReport, setFullReport] = useState(!compact);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const order = JSON.stringify(ids);
  useEffect(
    () =>
      onSettingsChange((key) => {
        if (key === "vltn.performance.leadin.v1" || ids.some((id) => key === LIBRARY_PREFIX + id)) setSettingsVersion((version) => version + 1);
      }),
    [order],
  );
  useEffect(() => {
    generation.current++;
    setReport(null);
    setVerified(null);
    setError("");
    setBusy(false);
    if (checked.current) void check();
    return () => {
      generation.current++;
    };
  }, [
    order,
    revision,
    settingsVersion,
    outputConfig,
    preparationDefaults,
    config.tempoOnStart,
    config.tempoChannel,
    config.output,
    config.macros,
    config.bindings,
    pedals.channels,
    pedals.assignments,
    pedals.profiles,
    pedals.owned,
    pedals.presets,
  ]);
  const check = async (verify = false) => {
    checked.current = true;
    const request = ++generation.current;
    setBusy(true);
    setReport(null);
    setVerified(null);
    setError("");
    try {
      await flushSettings();
      const service = host.song.library!;
      const snapshot = await (verify ? service.preflight(ids, true) : service.preflight(ids));
      if (request !== generation.current) return;
      const rig = currentRigFacts(false);
      const checks = playlistPreflight(ids, snapshot, {
        preparationDefaults,
        leadInDefaults: readLeadInDefaults(),
        tempoOnStart: config.tempoOnStart,
        tempoChannel: config.tempoChannel,
        outputName: config.output?.name,
        renderReady: isRenderedAhead,
        macros: config.macros,
        songs: songEntries(songs),
        bindings: config.bindings,
        pedals: configuredPedals(pedals),
        presetNames: knownPresetNames(),
        manualPresets: manualPresetProfiles(pedals),
        rig,
        rigLibrary: pedals,
        rhythmControls: rhythmControlOverrides(pedals),
        cuesArmed: useSongLibrary.getState().midiSession?.armed,
      });
      // Reading the tone files is asynchronous, so the song's own checks are done first and the tone warnings are added to them.
      const [withTones, routes] = await Promise.all([
        withToneWarnings(checks, ids, snapshot, host.tones),
        verify ? verifyRoutes(snapshot) : null,
      ]);
      if (request !== generation.current) return;
      setRigWarnings(rigChannelIssues(ownedPedalChannels(pedals), gpReceiveChannel(rig)));
      setVerified(routes);
      if (verify) setFullReport(true);
      setReport(withTones);
    } catch (e) {
      if (request === generation.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  return (
    <section aria-label="Playlist preflight" className="my-3 space-y-2 rounded border border-seam p-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={disabled || busy || !ids.length} onClick={() => void check()}>
          {busy ? "Checking playlist…" : "Check playlist"}
        </Button>
        <Button variant="outline" disabled={disabled || busy || !ids.length} onClick={() => void check(true)}>
          Verify for show
        </Button>
      </div>
      <p className="text-xs text-silkscreen-3">
        Check playlist compares saved audio file sizes and checks charts, MIDI cues, tempo and preparation. Verify for show also compares file checksums
        and checks the current audio and MIDI routes. Both run without playback or MIDI messages.
      </p>
      {busy && <p role="status">Checking saved files without loading audio into memory…</p>}
      {error && <p role="alert">{error}</p>}
      {report && rigWarnings.length > 0 && (
        <section aria-label="Rig channel warnings" className="space-y-1 text-amber-400">
          <h3 className="font-medium">Rig channel warnings</h3>
          <ul className="list-disc pl-5">
            {rigWarnings.map((issue) => <li key={issue.code + issue.text}>{issue.text}</li>)}
          </ul>
        </section>
      )}
      {report && (
        <>
          {verified && (
            <section aria-label="Verified show routes" className="space-y-2 rounded border border-seam p-3">
              <p>{verified.audio}</p>
              <p>{verified.midi}</p>
              {verified.errors.map((error) => <p key={error} className="text-red-400">{error}</p>)}
              {verified.warnings.map((warning) => <p key={warning} className="text-amber-400">{warning}</p>)}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => useNav.getState().go("song", "performance-setup")}>Open Audio outputs</Button>
                <Button size="sm" variant="outline" onClick={() => useNav.getState().go("song", "performance-midi")}>Open MIDI and My rig</Button>
              </div>
            </section>
          )}
          <p role="status">
            {report.length} entries checked · {report.reduce((n, r) => n + r.errors.length, verified?.errors.length ?? 0)} errors · {report.reduce((n, r) => n + r.warnings.length, rigWarnings.length + (verified?.warnings.length ?? 0))}{" "}
            performance warnings · {report.reduce((n, r) => n + r.advice.length, 0)} arrangement notes
          </p>
          {!fullReport && (
            <Button variant="outline" onClick={() => setFullReport(true)}>
              Open full report
            </Button>
          )}
          {fullReport && (
            <>
              <p className="text-xs">
                {verified
                  ? "Show verification records saved file checksums and a snapshot of the current routes. Recheck after cable, output or file changes. Confirm PA, headphones and pedal response in rehearsal."
                  : "Quick check records file presence, size and current MIDI preferences. Use Verify for show to check checksums and live routes."}
              </p>
              <PlaylistPreflightIssues report={report} onDownloaded={() => void check(!!verified)} />
              <p aria-label="Playlist preparation total">
                Configured preparation waits: {preparationSeconds(report.reduce((total, result) => total + (result.preparation?.totalWaitMs ?? 0), 0))} s across{" "}
                {report.filter((result) => result.preparation).length} entries. Fresh song loads with Send cues enabled are assumed. Audio loading, MIDI
                delivery, start delay and count-in can add time; entries with errors need fixing first.
              </p>
              <ol className="max-h-80 space-y-2 overflow-auto">
                {report.map((r) => (
                  <li key={r.entry} className="rounded border border-seam p-2">
                    <strong>
                      {r.entry}. {r.title}
                    </strong>
                    {r.preparation && (
                      <details className="my-2 rounded border border-seam p-2">
                        <summary className="cursor-pointer">
                          Before song: {preparationSeconds(r.preparation.totalWaitMs)} s · {r.preparation.steps.filter((step) => step.kind === "send").length}{" "}
                          command group{r.preparation.steps.filter((step) => step.kind === "send").length === 1 ? "" : "s"}
                        </summary>
                        <p className="my-2 text-xs">From the saved playable beginning, with fresh once-command history. Opening this preview sends nothing.</p>
                        <PreparationSequenceDetails plan={r.preparation} label={`Preparation steps for entry ${r.entry}`} />
                      </details>
                    )}
                    <p>
                      {r.errors.length} errors · {r.warnings.length} performance warnings
                    </p>
                    <ArrangementAdvice items={r.advice} />
                    {r.notes.length > 0 && (
                      <ul>
                        {r.notes.map((text, index) => (
                          <li key={index} className="text-silkscreen-3">
                            Note: {text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}
