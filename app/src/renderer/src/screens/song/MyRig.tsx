import { supportsRigTempo } from "@/song/performance/rig-tempo";
import { useEffect, useMemo, useRef, useState } from "react";
import { host } from "@/host";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSongLibrary } from "@/song/library";
import { midiCommand } from "@/song/performance/chart";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { actionCommands } from "@/song/performance/pedal-profiles";
import { usePedalLibrary } from "@/song/performance/pedal-library";
import { gpReceiveChannel, myRig, pedalGroups, rigChannelIssues, rigCheckedAt, rigToggle, type RigCard, type RigSetup } from "@/song/performance/my-rig";
import { pedalTempoMessages } from "@/song/performance/pedal-tempo";
import { rigFacts } from "@/song/performance/rig-facts";
import { selectArmed, selectOutput, useSession, type PerformanceSession } from "@/song/performance/session";
import { savedSongSettings } from "@/song/performance/settings";
import { useDevice } from "@/state/device";
import { useKnownPresetNames } from "./use-preset-names";
import "./my-rig-print.css";

const CHECKS_KEY = "vltn.my-rig.checks.v1";
const RECALL_MS = 2000;

type CardMarks = { lines: Record<string, { text: string; at: string }>; testedAt?: string };
type Marks = Record<string, CardMarks>;

function readMarks(): Marks {
  try {
    const saved = JSON.parse(localStorage.getItem(CHECKS_KEY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function localDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function SetupSheet({ setup, onClose }: { setup: RigSetup; onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined} data-rig-sheet className="max-h-[85vh] overflow-y-auto p-5 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Rig setup sheet</DialogTitle>
        </DialogHeader>
        <ul className="list-disc pl-5">
          {setup.chain.map((instruction) => (
            <li key={instruction}>{instruction}</li>
          ))}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          {setup.cards.map(({ profile, lines }) => (
            <section key={profile.id} className="space-y-1 rounded border border-seam p-2">
              <h3 className="font-semibold">{profile.name}</h3>
              <ul className="list-disc pl-5">
                {lines.map(({ id, text }) => (
                  <li key={id}>{text}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <Button data-rig-sheet-control variant="outline" onClick={() => window.print()}>
          Print setup sheet
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function MyRig({ session }: { session: PerformanceSession }) {
  const library = usePedalLibrary();
  const songs = useSongLibrary((state) => state.index.songs);
  const config = useMidiConfiguration();
  const device = useDevice((state) => state.device);
  const status = useDevice((state) => state.status);
  const globals = useDevice((state) => state.globals);
  const names = useKnownPresetNames();
  const armed = useSession(session, selectArmed);
  const output = useSession(session, selectOutput);
  const playing = useSession(session, (state) => state.playing);
  const starting = useSession(session, (state) => state.starting);
  const [marks, setMarks] = useState(readMarks);
  const [sheet, setSheet] = useState(false);
  const [test, setTest] = useState<{ id: string; waiting: boolean } | null>(null);
  const [feedback, setFeedback] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const state = useSongLibrary.getState();
    if (host.song?.library && !state.index.songs.length && !state.busy) void state.refresh();
  }, []);
  const available = armed && output?.state === "connected" && !playing && !starting && !test;
  const setup = useMemo(
    () =>
      myRig(
        library,
        songs.map((song) => ({ ...song, settings: savedSongSettings(song.id, song.settings) })),
        config.macros,
        names,
      ),
    [library.owned, library.profiles, library.channels, library.assignments, library.presets, songs, config.macros, names],
  );
  const groups = pedalGroups(library);
  const facts = rigFacts({ device, status, globals }, library, config, false);
  const warnings = rigChannelIssues(setup.cards, gpReceiveChannel(facts));

  const writeMarks = (id: string, next: CardMarks) => {
    try {
      const saved = { ...marks, [id]: next };
      localStorage.setItem(CHECKS_KEY, JSON.stringify(saved));
      setMarks(saved);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const run = (card: RigCard, messages: number[][], back?: number[][]) => {
    if (!available || !output) return;
    setFeedback("");
    const id = card.profile.id;
    const canSend = () => selectOutput(session.state) === output && selectArmed(session.state) && !session.state.playing && !session.state.starting;
    const send = (commands: number[][]) => {
      for (const bytes of commands) {
        if (!canSend()) return false;
        session.sendPerformance(bytes);
      }
      return canSend();
    };
    const interrupt = () => {
      setTest(null);
      setFeedback("Test interrupted. Stop playback and reconnect or rearm the MIDI output to try again.");
    };
    if (!send(messages)) {
      interrupt();
      return;
    }
    setTest({ id, waiting: !!back });
    if (back)
      timer.current = setTimeout(() => {
        if (send(back)) setTest({ id, waiting: false });
        else interrupt();
      }, RECALL_MS);
  };

  return (
    <section className="space-y-3" aria-label="My rig">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">My rig</h3>
        <Button variant="outline" onClick={() => setSheet(true)}>
          Setup sheet
        </Button>
      </div>
      {!library.owned.length && <p className="text-sm text-silkscreen-3">Choose the pedals you own to set up your rig and check its MIDI channels.</p>}
      <details open={!library.owned.length || undefined}>
        <summary className="cursor-pointer">My pedals</summary>
        <div className="flex flex-wrap gap-3 py-2">
          {[...groups.owned, ...groups.other].map((profile) => (
            <label key={profile.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={library.owned.includes(profile.id)}
                disabled={playing || starting || !!test}
                onChange={(event) => library.setOwned(profile.id, event.target.checked)}
              />
              {profile.name}
            </label>
          ))}
        </div>
      </details>
      {warnings.length > 0 && (
        <ul className="list-disc pl-5 text-amber-400">
          {warnings.map(({ code, text }) => (
            <li key={code + text}>{text}</li>
          ))}
        </ul>
      )}
      <ul className="list-disc pl-5">
        {setup.chain.map((instruction) => (
          <li key={instruction}>{instruction}</li>
        ))}
      </ul>
      {setup.skippedSongs.length > 0 && <p>Check the MIDI charts for {setup.skippedSongs.join(", ")} to include their pedal requirements.</p>}
      {!armed && <p>Select a connected MIDI output and enable Send cues to test your pedals.</p>}
      {setup.cards.map((card) => {
        const { profile, lines, recall } = card;
        const id = profile.id;
        const stored = { ...marks[id], lines: marks[id]?.lines ?? {} };
        const dates = lines.map((line) => rigCheckedAt(line, stored.lines));
        const ready = dates.every((date) => !!date);
        const toggle = rigToggle(card, library);
        return (
          <section key={id} className="space-y-2 rounded border border-seam p-3" aria-label={profile.name}>
            <h4 className="font-semibold">
              {profile.name}
              {ready && (
                <span>
                  {" "}
                  · ✓ Checked{" "}
                  {localDate(
                    dates
                      .filter((date): date is string => !!date)
                      .sort()
                      .at(-1)!,
                  )}
                </span>
              )}
            </h4>
            <div className="space-y-1">
              {lines.map((line, i) => (
                <label key={line.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={!!dates[i]}
                    disabled={playing || starting}
                    onChange={(event) => {
                      const checked = { ...stored.lines };
                      if (event.target.checked) checked[line.id] = { text: line.text, at: new Date().toISOString() };
                      else delete checked[line.id];
                      writeMarks(id, { ...stored, lines: checked });
                    }}
                  />
                  {line.text}
                </label>
              ))}
            </div>
            {supportsRigTempo(id) && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" aria-label={`${profile.name} follows the song’s tempo`} disabled={playing || starting}
                  checked={library.tempoFollow?.[id] !== false} onChange={(event) => library.setTempoFollow(id, event.target.checked)} />
                Follows the song’s tempo
              </label>
            )}
            {id === "valeton-gp180" && (
              <a className="underline" href="#gp-rig-settings">
                Open GP-180 rig check
              </a>
            )}
            {id === "boss-rc10r" && (
              <a className="underline" href="#rc10r-rig-settings">
                Open RC-10R drums setup
              </a>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {recall.length === 2 && (
                <Button
                  variant="outline"
                  disabled={!available}
                  title={`${recall[0].label} → ${recall[1].label}`}
                  onClick={() => {
                    const payloads = recall.map(({ action }) => actionCommands(action, card.channel).map(midiCommand));
                    run(card, payloads[0], payloads[1]);
                  }}
                >
                  Recall a preset and back
                </Button>
              )}
              {(toggle || id === "boss-sy200") && (
                <Button
                  variant="outline"
                  disabled={!available || !toggle}
                  title={toggle ? undefined : "Assign ON/OFF SW CC to test the switch."}
                  onClick={() => {
                    if (toggle) run(card, toggle[0], toggle[1]);
                  }}
                >
                  Toggle on/off
                </Button>
              )}
              {(id === "valeton-gp180" || id === "valeton-gp150") && (
                <Button
                  variant="outline"
                  disabled={!available}
                  onClick={() => {
                    try {
                      run(card, pedalTempoMessages(session.state.bpm, card.channel));
                    } catch (error) {
                      setFeedback(error instanceof Error ? error.message : String(error));
                    }
                  }}
                >
                  Send tempo
                </Button>
              )}
            </div>
            {test?.id === id &&
              (test.waiting ? (
                <p role="status">Testing {profile.name}…</p>
              ) : (
                <div className="flex items-center gap-2" role="group" aria-label="Did it change?">
                  Did it change?
                  <Button
                    variant="outline"
                    onClick={() => {
                      writeMarks(id, { ...stored, testedAt: new Date().toISOString() });
                      setTest(null);
                    }}
                  >
                    Yes
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setTest(null);
                      const settings = lines.filter((line) => ["channel", "pc", "cc", "cable"].includes(line.id));
                      setFeedback(`Check ${profile.name}. ${settings.map((line) => line.text).join(" ")} If using a GP-180, check FS jack MIDI OUT.`);
                    }}
                  >
                    No
                  </Button>
                </div>
              ))}
            {stored.testedAt && <p>Last successful test confirmed {localDate(stored.testedAt)}.</p>}
          </section>
        );
      })}
      {(feedback || library.saveError) && <p role="status">{feedback || library.saveError}</p>}
      {sheet && <SetupSheet setup={setup} onClose={() => setSheet(false)} />}
    </section>
  );
}
