import { useRef } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notifyError } from "@/app/notify";
import { useFileHandler, type OpenFile } from "@/state/ui";
import { host } from "@/host";
import { AUDIO_ACCEPT } from "@/song/decode";
import { confirmLeave, useSongLibrary } from "@/song/library";
import { useNav } from "@/state/nav";
import { useSong } from "@/song/store";
import type { SongSource } from "@/song/types";
import type { LibrarySong } from "@shared/song-library";
import { StemsPanel } from "./stems/StemsPanel";
import { ToneMatchPanel } from "./tonematch/ToneMatchPanel";
import { SongLibraryPanel } from "./SongLibraryPanel";
import { PerformancePanel } from "./PerformancePanel";
import { SaveBeforeLeaving, SaveIndicator } from "./SaveIndicator";
import { useSongTab, type SongTab } from "./tab";
import { ScreenBoundary } from "@/components/ScreenBoundary";

/** Decode a song and let the performer choose what to do with it. */
export async function openSong(file: File): Promise<void> {
  if (useSongLibrary.getState().busy) return;
  if (!(await confirmLeave())) return;
  useSongLibrary.getState().pausePlaylist();
  const nav = useNav.getState();
  const explicitlySplitting = nav.screen === "song" && nav.param === "stems";
  nav.go("song", explicitlySplitting ? "stems" : "songs");
  await useSong.getState().load(file);
}

/** Audio files dropped on the window or opened while this screen is showing. */
function openSongFiles(files: OpenFile[]) {
  const f = files[0];
  if (!f) return;
  if (f.file) void openSong(f.file);
  else notifyError(`Couldn't open ${f.name}`, new Error("Drop the file onto the Song screen, or choose it with Open a song."));
}

/**
 * The line under the Song heading. A saved song shows its title, then its artist when it has one. An unsaved file shows its file name.
 * With no song open, `hint` says what the screen is for.
 */
export function songHeadline(source: SongSource | null, saved: Pick<LibrarySong, "title" | "artist"> | undefined, hint: string): string {
  if (!source) return hint;
  if (!source.libraryId || !saved) return source.name;
  return saved.artist.trim() ? `${saved.title} · ${saved.artist.trim()}` : saved.title;
}

/** Song (Stem Splitter + Tone Match): split a song into stems on this computer, then match its guitar tone. */
export function SongScreen() {
  const [tab, setTab] = useSongTab();
  const source = useSong((s) => s.source);
  const libraryId = source?.libraryId;
  const saved = useSongLibrary((s) => (libraryId ? s.index.songs.find((song) => song.id === libraryId) : undefined));
  const fileInput = useRef<HTMLInputElement>(null);
  const param = useNav((state) => state.param);
  const status = useSong((s) => s.status);
  const requestedView = param === "performance-setup" ? "setup" : param === "performance-midi" ? "midi" : param === "performance-play" ? "play" : undefined;
  useFileHandler("audio", openSongFiles);
  useFileHandler("wav", openSongFiles);
  const pick = () => fileInput.current?.click();

  return (
    <div className="flex h-full min-h-0 flex-col px-6 pb-4">
      <input
        ref={fileInput}
        type="file"
        accept={AUDIO_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void openSong(file);
        }}
      />
      <SaveBeforeLeaving />
      <Tabs value={tab} onValueChange={(v) => setTab(v as SongTab)} className="flex min-h-0 flex-1 flex-col gap-3.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-6 pt-5 pb-1">
          <h1 className="col-start-1 row-start-1 text-[32px] leading-[1.1] font-bold tracking-[-0.02em] text-balance">Songs &amp; sets</h1>
          <div className="col-start-1 row-start-2 mt-1.5 flex min-w-0 items-center gap-3">
            <p className="truncate text-[12px] text-silkscreen-3">
              {songHeadline(source, saved, "Play backing tracks, prepare sets or split songs into stems.")}
            </p>
            <SaveIndicator />
          </div>
          <div className="col-start-2 row-span-2 row-start-1 flex items-center gap-3">
            <TabsList aria-label="Song">
              <TabsTrigger value="songs">Songs & sets</TabsTrigger>
              <TabsTrigger value="stems">Stems</TabsTrigger>
              <TabsTrigger value="tone">Tone match</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
            </TabsList>
            {source && (
              <Button variant="outline" onClick={pick}>
                <FileUp data-icon="inline-start" />
                Open another song…
              </Button>
            )}
          </div>
        </div>
        <TabsContent value="songs" className="flex min-h-0 flex-col">
          <ScreenBoundary name="Songs and playlists" title="This tab hit a problem.">
            {status.kind === "decoding" && <p role="status" className="p-2">Opening audio…</p>}
            {status.kind === "error" && !source && <p role="alert" className="p-2">{status.message}</p>}
            {source && !source.libraryId && (
              <div className="flex flex-wrap items-center gap-2 rounded border border-seam p-3" aria-label="Imported song actions">
                <Button onClick={() => useNav.getState().go("song", "performance-play")}>Open player</Button>
                {host.song.library && (
                  <Button variant="outline" onClick={() => document.getElementById("save-current-song-title")?.focus()}>Prepare for a set</Button>
                )}
                <Button variant="outline" onClick={() => setTab("stems")}>Split stems</Button>
              </div>
            )}
            <SongLibraryPanel onPick={pick} />
          </ScreenBoundary>
        </TabsContent>
        <TabsContent value="stems" className="flex min-h-0 flex-col">
          <ScreenBoundary name="Stems" title="This tab hit a problem.">
            <StemsPanel onPick={pick} />
          </ScreenBoundary>
        </TabsContent>
        <TabsContent value="tone" className="flex min-h-0 flex-col">
          <ScreenBoundary name="Tone match" title="This tab hit a problem.">
            <ToneMatchPanel />
          </ScreenBoundary>
        </TabsContent>
        {/* Kept mounted on the other tabs: a set or song playing on Performance keeps playing (and can be edited) while hidden. */}
        <TabsContent value="performance" forceMount hidden={tab !== "performance"} className="flex min-h-0 flex-col">
          <ScreenBoundary name="Performance" title="This tab hit a problem.">
            <PerformancePanel shown={tab === "performance"} requestedView={requestedView} />
          </ScreenBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );
}
