import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/ui/settings-card";
import { host } from "@/host";
import type { Rc10rBackupSummary, Rc10rLoopFile, Rc10rLoopLibrary } from "@shared/host/rc10r";
import { hasLoops } from "@shared/rc10r-memory-map";
import { loopSeconds, megabytes, memoryUsers, useRc10rPedalReading } from "@/song/band/rc10r-pedal-state";

interface LibrarySongLike {
  id: string;
  title: string;
  settings: Record<string, string>;
}

/** WAV bytes from the newest pedal backup as a file the song's track import accepts. */
export function loopFile(loop: Rc10rLoopFile, bytes: Uint8Array): File {
  const name = `RC-10R memory ${loop.memory} track ${loop.track}.wav`;
  return new File([bytes as Uint8Array<ArrayBuffer>], name, { type: "audio/wav" });
}

/**
 * The pedal as last read: every memory with its rhythm, tempo, loops and songs (spec 177), the loop library from the newest backup
 * (spec 178) and the size of the app's pedal backups (spec 175). Reading and listing never write to the pedal.
 */
export function Rc10rPedalPanel({
  songs,
  onRead,
  onAddLoop,
  locked,
}: {
  songs: readonly LibrarySongLike[];
  onRead(): void;
  /** Adds a loop to the current song as a track. Absent when no song is loaded. */
  onAddLoop?(file: File): Promise<void>;
  locked: boolean;
}) {
  const saved = useRc10rPedalReading((state) => state.saved);
  const [onlyUsed, setOnlyUsed] = useState(true);
  const [library, setLibrary] = useState<Rc10rLoopLibrary | null>(null);
  const [backups, setBackups] = useState<Rc10rBackupSummary | null>(null);
  const [confirmPrune, setConfirmPrune] = useState(false);
  const [message, setMessage] = useState("");
  const playing = useRef<{ context: AudioContext; source: AudioBufferSourceNode } | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const users = useMemo(() => memoryUsers(songs), [songs]);
  const refresh = () => {
    if (!host.rc10r) return;
    void host.rc10r.loops().then(setLibrary, () => setLibrary({ loops: [] }));
    void host.rc10r.backups().then(setBackups, () => setBackups(null));
  };
  useEffect(refresh, [saved?.readAt]);
  useEffect(() => () => void playing.current?.context.close().catch(() => {}), []);
  const stop = () => {
    void playing.current?.context.close().catch(() => {});
    playing.current = null;
    setPreviewing(null);
  };
  const preview = async (loop: Rc10rLoopFile) => {
    stop();
    if (!host.rc10r || !library?.backup) return;
    try {
      const bytes = await host.rc10r.loopAudio(library.backup.id, loop.path);
      const context = new AudioContext();
      const buffer = await context.decodeAudioData(bytes.slice().buffer);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = stop;
      source.start();
      playing.current = { context, source };
      setPreviewing(loop.path);
    } catch (problem) {
      setMessage(problem instanceof Error ? problem.message : String(problem));
    }
  };
  const add = async (loop: Rc10rLoopFile) => {
    if (!host.rc10r || !library?.backup || !onAddLoop) return;
    try {
      await onAddLoop(loopFile(loop, await host.rc10r.loopAudio(library.backup.id, loop.path)));
      setMessage(`Added memory ${loop.memory} track ${loop.track} to this song.`);
    } catch (problem) {
      setMessage(problem instanceof Error ? problem.message : String(problem));
    }
  };
  const prune = async () => {
    if (!host.rc10r) return;
    setConfirmPrune(false);
    try {
      setBackups(await host.rc10r.pruneBackups());
      setMessage("Older pedal backups removed. The five newest and any from an interrupted send are kept.");
    } catch (problem) {
      setMessage(problem instanceof Error ? problem.message : String(problem));
    }
  };
  const memories = saved?.reading.memories ?? [];
  const shown = onlyUsed ? memories.filter((m) => hasLoops(m) || users.has(m.memory) || m.userRhythm !== null) : memories;
  const summary = saved ? `Read ${new Date(saved.readAt).toLocaleDateString()}` : "Not read yet";
  return (
    <SettingsCard title="RC-10R pedal" summary={summary} storageKey="rc10r-pedal" defaultOpen={false}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={locked || !host.rc10r} onClick={onRead}>
            Read the RC-10R…
          </Button>
          {saved && (
            <span className="text-silkscreen-3">
              {megabytes(saved.reading.storageBytes)} on the pedal, loops {megabytes(saved.reading.loopBytes)}.
            </span>
          )}
          {!host.rc10r && <span className="text-silkscreen-3">Reading the pedal needs the macOS desktop app.</span>}
        </div>

        {memories.length > 0 && (
          <details>
            <summary className="cursor-pointer font-medium">Memories</summary>
            <label className="my-2 flex items-center gap-2">
              <input type="checkbox" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} />
              Only memories with loops, User rhythms or songs
            </label>
            <table aria-label="RC-10R memories" className="w-full text-left">
              <thead>
                <tr>
                  <th className="p-1">Memory</th>
                  <th className="p-1">Rhythm</th>
                  <th className="p-1">Tempo</th>
                  <th className="p-1">Loops</th>
                  <th className="p-1">Songs</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.memory} data-memory={m.memory}>
                    <td className="p-1">{m.memory}</td>
                    <td className="p-1">{m.userRhythm !== null ? `User ${m.userRhythm}` : `Built-in ${m.genre}-${m.pattern + 1}`}</td>
                    <td className="p-1">{m.tempo}</td>
                    <td className="p-1">
                      {m.tracks
                        .map((t, i) => (t.recorded ? `T${i + 1} ${Math.round(t.seconds)} s` : ""))
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </td>
                    <td className="p-1">{(users.get(m.memory) ?? []).map((u) => u.title).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}

        {library && library.loops.length > 0 && (
          <details>
            <summary className="cursor-pointer font-medium">
              Loops ({library.loops.length}, from the backup of {new Date(library.backup!.date).toLocaleDateString()})
            </summary>
            <ul aria-label="RC-10R loops" className="space-y-1 py-2">
              {library.loops.map((loop) => (
                <li key={loop.path} className="flex flex-wrap items-center gap-2">
                  <span>
                    Memory {loop.memory}, track {loop.track} · {Math.round(loopSeconds(loop.bytes))} s
                  </span>
                  <Button size="sm" variant="outline" onClick={() => (previewing === loop.path ? stop() : void preview(loop))}>
                    {previewing === loop.path ? "Stop" : "Play"}
                  </Button>
                  {onAddLoop && (
                    <Button size="sm" variant="outline" disabled={locked} onClick={() => void add(loop)}>
                      Add to this song
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        {backups && backups.count > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Pedal backups: {backups.count}, {megabytes(backups.bytes)} on this computer.
            </span>
            {backups.removable > 0 &&
              (confirmPrune ? (
                <>
                  <span>Remove {backups.removable} older backups? This can't be undone.</span>
                  <Button size="sm" variant="destructive" onClick={() => void prune()}>
                    Remove
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirmPrune(false)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" disabled={locked} onClick={() => setConfirmPrune(true)}>
                  Remove older backups…
                </Button>
              ))}
          </div>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </SettingsCard>
  );
}
