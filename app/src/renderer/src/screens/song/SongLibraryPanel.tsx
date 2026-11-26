import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { selectWholeSongStems, useSong } from "@/song/store";
import { audioUnsaved } from "@/song/library";
import { saveIndicator } from "./SaveIndicator";
import { useSongLibrary } from "@/song/library";
import { isRunning, jobLine, useAnalysisJob, useJobClock } from "@/song/analysis/analysis-job";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { LibraryBackupPreview, RestoreMode } from "@shared/song-library";
import { host } from "@/host";
import { LibraryBrowser } from "./LibraryBrowser";
import { QueuePanel } from "./QueuePanel";
import { PlayHistory } from "./PlayHistory";
import { planMacroRestore } from "@/song/performance/restore-macros";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { PlaylistsPanel } from "./PlaylistsPanel";

const field = "rounded border border-seam bg-transparent p-2";
export function SongLibraryPanel({ onPick }: { onPick(): void }) {
  const library = useSongLibrary(),
    source = useSong((s) => s.source),
    status = useSong((s) => s.status);
  const saved = library.index.songs.find((s) => s.id === source?.libraryId);
  const stems = useSong(selectWholeSongStems);
  // The save bar is for a song that is open and not safe yet; the header shows the save state, and Save there does the same.
  const state = saveIndicator({
    hasSong: !!source,
    inLibrary: !!source?.libraryId,
    audioUnsaved: audioUnsaved(source, stems, saved),
    saveStep: library.saveStep,
    saveError: library.saveError,
  });
  const unsaved = state?.kind === "unsaved" || state?.kind === "failed";
  const [title, setTitle] = useState(saved?.title ?? source?.name.replace(/\.[^.]+$/, "") ?? "");
  const [artist, setArtist] = useState(saved?.artist ?? "");
  const [destination, setDestination] = useState("");
  const [setName, setSetName] = useState("");
  const editable = !!source && title.trim() !== "" && !library.busy && !["splitting", "model", "decoding"].includes(status.kind);
  // A batch analysis (spec 77) keeps going on any screen; this line shows it here too, with a way back to its dialog.
  const job = useAnalysisJob();
  const jobNow = useJobClock(isRunning(job.phase));
  useEffect(() => {
    if (host.song.library) void library.refresh();
  }, []);
  useEffect(() => {
    setTitle(saved?.title ?? source?.name.replace(/\.[^.]+$/, "") ?? "");
    setArtist(saved?.artist ?? "");
  }, [source, saved?.title, saved?.artist]);
  if (!host.song.library)
    return <div className="space-y-2 p-2"><Button onClick={onPick}>Open a song…</Button><p>Use the desktop app to save songs and audio for offline performances.</p></div>;
  return (
    <section aria-label="Saved songs and playlists" className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-2">
      {unsaved && (
        <div aria-label="Save the current song" className="flex flex-wrap items-center gap-3 rounded border border-seam px-3 py-2">
          <input id="save-current-song-title" aria-label="Song title" placeholder="Song title" className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
          <input aria-label="Song artist" placeholder="Artist" className={field} value={artist} onChange={(e) => setArtist(e.target.value)} />
          {!saved && (
            <select aria-label="Add to set" className={field} value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="">Save to library only</option>
              <option value="new">Create a new set</option>
              {library.index.playlists.filter((set) => !set.smart).map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
            </select>
          )}
          {!saved && destination === "new" && <input aria-label="New set name" placeholder="New set name" className={field} value={setName} onChange={(e) => setSetName(e.target.value)} />}
          <Button disabled={!editable || (!saved && destination === "new" && !setName.trim())} onClick={() => {
            if (!saved && destination) void library.saveForSet(title, artist, destination === "new" ? { name: setName.trim() } : { id: destination });
            else void library.save(title, artist);
          }}>
            {saved ? "Save song changes" : destination ? "Save and add to set" : "Save song to library"}
          </Button>
        </div>
      )}
      {library.backupPreview && <RestoreSetDialog preview={library.backupPreview} finish={library.finishRestore} />}
      {library.busy && <p role="status">{library.saveStep ? `Saving… ${library.saveStep}` : library.transfer || "Working with saved songs…"}</p>}
      {isRunning(job.phase) && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status">{jobLine(job, jobNow)}</p>
          <Button variant="outline" size="sm" onClick={() => job.requestOpen()}>
            Show
          </Button>
        </div>
      )}
      {library.busy && library.playlistPlaying && library.queue.length > 1 && (
        <Button variant="outline" onClick={() => library.pausePlaylist()}>
          Stop playlist
        </Button>
      )}
      {library.notice && <p role="status">{library.notice}</p>}
      {library.error && (
        <p role="alert" className="text-red-400">
          {library.error}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <LibraryBrowser onImport={onPick} />
        <div className="space-y-5">
          <QueuePanel />
          <PlaylistsPanel />
          <PlayHistory />
        </div>
      </div>
    </section>
  );
}

function RestoreSetDialog({ preview, finish }: {
  preview: LibraryBackupPreview;
  finish: (mode: RestoreMode | null, pedals?: boolean, macros?: boolean) => Promise<void>;
}) {
  const [pedals, setPedals] = useState(false);
  const [macros, setMacros] = useState(false);
  const localMacros = useMidiConfiguration((state) => state.macros);
  const plan = planMacroRestore(localMacros, preview.macros ?? []);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) void finish(null); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review backup before restoring</DialogTitle>
          <DialogDescription>{preview.fileName} holds {preview.songs} songs and {preview.playlists} playlists. Existing songs are kept.</DialogDescription>
        </DialogHeader>
        {!!preview.duplicates && <p>{preview.duplicates} identical arrangements can be reused.</p>}
        {!!preview.variants?.length && <div>
          <p>These arrangements will be imported separately.</p>
          <ul className="list-disc pl-5">
            {preview.variants.map(({ title, differences }, index) => <li key={index}>{title} · {differences.join(", ")}</li>)}
          </ul>
        </div>}
        {preview.pedalSettings && <fieldset className="space-y-1">
          <legend>Pedal settings</legend>
          <p>Current rig: {preview.pedalSettings.current.join(", ") || "No saved pedals"}</p>
          <p>Backup rig: {preview.pedalSettings.incoming?.join(", ") || (preview.pedalSettings.incoming ? "No named pedals" : "Settings in an older archive")}</p>
          <label className="flex gap-2"><input type="checkbox" checked={pedals} onChange={(e) => setPedals(e.target.checked)} /> Add missing pedal settings</label>
          <p className="text-sm text-silkscreen-3">Your current pedal channels, assignments and named presets take precedence.</p>
        </fieldset>}
        {!!plan.conflicts.length && <p>Keeping local definitions for {plan.conflicts.map((code) => "$" + code).join(", ")}.</p>}
        {!!plan.errors.length && <p role="alert">Macro import needs attention. {plan.errors[0]}</p>}
        {!!plan.added.length && <label className="flex gap-2">
          <input type="checkbox" checked={macros} disabled={!!plan.errors.length} onChange={(e) => setMacros(e.target.checked)} />
          Import missing MIDI macros ({plan.added.map(({ code }) => "$" + code).join(", ")})
        </label>}
        {!!preview.toneNames?.length && <p>To regenerate parts, check these tone files on this computer: {preview.toneNames.join(", ")}.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => void finish(null)}>Cancel</Button>
          {!!preview.duplicates && <Button variant="outline" onClick={() => void finish("copy", pedals, macros)}>Import all as copies</Button>}
          <Button onClick={() => void finish(preview.duplicates ? "skip" : "copy", pedals, macros)}>
            {preview.duplicates ? "Restore and reuse identical songs" : "Restore backup"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
