import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { host } from "@/host";
import { useStageActivity } from "@/state/stage-activity";
import { useSongLibrary } from "@/song/library";
import { useSong } from "@/song/store";
import { flushSettings } from "@/song/performance/settings";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { usePedalLibrary } from "@/song/performance/pedal-library";
import { DEFAULT_SET_UPGRADE, planSetUpgrade, setUpgradeReminders, type SetUpgradeOptions } from "@/song/performance/set-upgrade";
import { runSetUpgrade, upgradeSavedSong, type UpgradeRow } from "@/song/performance/run-set-upgrade";
import { useKnownPresetNames } from "./use-preset-names";
import { PlaylistPreflight } from "./PlaylistPreflight";
import { useBandPanel, type BandTab } from "./band-panel-state";

export function SetUpgradeDialog({ ids, name, onClose }: { ids: string[]; name: string; onClose(): void }) {
  const library = useSongLibrary();
  const stageBusy = useStageActivity((state) => state.busy);
  const presetNames = useKnownPresetNames();
  const [options, setOptions] = useState<SetUpgradeOptions>(DEFAULT_SET_UPGRADE);
  const [backup, setBackup] = useState("");
  const [hasBackup, setHasBackup] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Record<number, UpgradeRow>>({});
  const cancelled = useRef(false);
  const lock = useRef(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [snapshot] = useState(() => [...ids]);
  const blocked = stageBusy || library.playlistPlaying;
  const songs = snapshot.map((id) => library.index.songs.find((song) => song.id === id));
  const backupFirst = async () => {
    if (blocked || lock.current) return;
    lock.current = true;
    setBackingUp(true);
    setError("");
    try {
      await library.saveBeforePlayback();
      await flushSettings();
      const result = await host.song.library!.exportBackup();
      if (result) {
        setBackup(result.filePath ?? result.fileName);
        setHasBackup(true);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      lock.current = false;
      setBackingUp(false);
    }
  };
  const start = async () => {
    if (blocked || lock.current || !hasBackup || finished) return;
    lock.current = true;
    cancelled.current = false;
    setRunning(true);
    setError("");
    try {
      await library.saveBeforePlayback();
      await flushSettings();
      if (useStageActivity.getState().busy || useSongLibrary.getState().playlistPlaying) throw new Error("Stop playback to update the set");
      const index = await host.song.library!.index();
      const entries = snapshot.map(
        (id) =>
          index.songs.find((song) => song.id === id) ?? {
            id,
            title: "Missing song",
            artist: "",
            sourceName: "",
            duration: 0,
            audio: [],
            settings: {},
            updated: "",
          },
      );
      const config = useMidiConfiguration.getState();
      const channels = usePedalLibrary.getState().channels;
      const known = presetNames?.model ? [{ names: presetNames, channel: channels[`valeton-${presetNames.model}`] ?? 1 }] : [];
      useSongLibrary.setState({ busy: true });
      await runSetUpgrade(entries, options, {
        cancelled: () => cancelled.current,
        upgrade: async (song, selected) => {
          const current = (await host.song.library!.index()).songs.find((entry) => entry.id === song.id);
          if (!current) throw new Error("Song is missing from the library. Restore it from a backup.");
          return upgradeSavedSong(current, selected, known, config.macros);
        },
        onRow: (row, index) => setRows((previous) => ({ ...previous, [index]: row })),
      });
      useSongLibrary.setState({ index: await host.song.library!.index() });
      setFinished(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      useSongLibrary.setState({ busy: false });
      lock.current = false;
      setRunning(false);
    }
  };
  const cancel = () => {
    if (backingUp) return;
    if (!running) return onClose();
    cancelled.current = true;
    setCancelRequested(true);
  };
  const openBand = async (id: string, tab: BandTab) => {
    if (blocked || running) return;
    try {
      await library.load(id);
      if (useSong.getState().source?.libraryId !== id || useSongLibrary.getState().error)
        throw new Error("The song could not be opened. Check the library message.");
      useBandPanel.getState().setTab(tab);
      useBandPanel.getState().show(true);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const choose = (key: keyof SetUpgradeOptions, checked: boolean) => setOptions((current) => ({ ...current, [key]: checked }));
  const frozen = running || backingUp || finished;
  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-auto sm:max-w-5xl" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Bring this set up to date…</DialogTitle>
          <DialogDescription>
            {name} · {snapshot.length} songs. Back up first. Your rendered parts, hand-set bass notes and bar marks are kept.
          </DialogDescription>
        </DialogHeader>
        {blocked && <p role="alert">Stop playback to update the set</p>}
        <fieldset disabled={frozen || blocked} className="space-y-2">
          <Choice
            label="Update the band to the newest patterns (songs on an older engine)"
            checked={options.updateBand}
            onChange={(value) => choose("updateBand", value)}
          />
          <Choice label="Use the Warm bass tone where the bass is clean" checked={options.warmBass} onChange={(value) => choose("warmBass", value)} />
          <Choice label="Name GP-150/GP-180 preset cues" checked={options.nameCues} onChange={(value) => choose("nameCues", value)} />
          <p className="text-xs text-silkscreen-3">
            {presetNames
              ? `Preset names: ${presetNames.source === "live" ? "connected pedal" : "cached from the last connection"}. Only labels change; MIDI bytes stay identical.`
              : "Connect the pedal in the editor to read its names, or use cached names from the last connection."}
          </p>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={frozen || blocked || library.busy} onClick={() => void backupFirst()}>
            {backingUp ? "Backing up…" : "Back up the library first"}
          </Button>
          <Choice label="I have a backup" checked={hasBackup} disabled={frozen} onChange={setHasBackup} />
          {backup && <p role="status">Backup saved to {backup}</p>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {["Song", "Band", "Bass tone", "Cue names", "Save"].map((label) => (
                  <th key={label} className="p-2">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshot.map((id, index) => {
                const song = songs[index];
                let initial = { band: "To do", bass: "To do" };
                try {
                  if (song) initial = planSetUpgrade(song, options);
                } catch {
                  /* Reported by the runner without changing this song. */
                }
                const untouched = finished ? (cancelRequested ? "Skipped: Cancelled before this song" : "Skipped: Update stopped before this song") : undefined;
                const row = rows[index] ?? {
                  id,
                  title: song?.title ?? "Missing song",
                  band: untouched ?? initial.band,
                  bass: untouched ?? initial.bass,
                  cues: untouched ?? (options.nameCues ? "To do" : "Skipped: Not selected"),
                  save: untouched ?? "To do",
                };
                return (
                  <tr key={`${id}:${index}`} className="border-t border-seam">
                    {[row.title, row.band, row.bass, row.cues, row.save].map((value, cell) => (
                      <td key={cell} className="p-2 align-top">
                        {value}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {error && <p role="alert">{error}</p>}
        {cancelRequested && (
          <p role="status">{running ? "Stopping after the current song is fully saved or left unchanged…" : "Stopped. Later songs were left unchanged."}</p>
        )}
        <div className="flex gap-2">
          <Button
            disabled={!hasBackup || frozen || blocked || library.busy || !snapshot.length || !Object.values(options).some(Boolean)}
            onClick={() => void start()}
          >
            {running ? "Updating set…" : "Start"}
          </Button>
          <Button variant="outline" disabled={backingUp || (running && cancelRequested)} onClick={cancel}>
            {finished ? "Close" : "Cancel"}
          </Button>
        </div>
        {finished && (
          <>
            <PlaylistPreflight ids={snapshot} songs={library.index.songs} disabled={blocked} revision={null} autoStart compact />
            <section aria-label="Still yours to choose, per song" className="space-y-3">
              <h3 className="font-semibold">Still yours to choose, per song</h3>
              {songs.map((song, index) => {
                if (!song) return null;
                let reminders: ReturnType<typeof setUpgradeReminders>;
                try {
                  reminders = setUpgradeReminders(song, index === 0);
                } catch {
                  return <p key={index}>{song.title}: Open the song to check its saved settings.</p>;
                }
                return (
                  <div key={`${song.id}:${index}`} className="rounded border border-seam p-3">
                    <h4>{song.title}</h4>
                    <ul>
                      {reminders.map(({ text, tab }) => (
                        <li key={text} className="flex items-center justify-between gap-3 py-1">
                          <span>{text}</span>
                          <Button
                            variant="outline"
                            disabled={blocked}
                            aria-label={`Open Band: ${song.title}, ${text}`}
                            onClick={() => void openBand(song.id, tab)}
                          >
                            Open Band
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Choice({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange(value: boolean): void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </label>
  );
}
