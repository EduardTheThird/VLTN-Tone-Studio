import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSong } from "@/song/store";
import { AUDIO_ACCEPT, isAudioFileName } from "@/song/decode";

/**
 * Adds the user's own audio files to the song as tracks: several files, or a whole folder (the folder's other files are skipped
 * without a word). Files can also be dropped on the panel. Each file that is refused or padded is listed below.
 */
export function TrackImport() {
  const status = useSong((s) => s.status.kind);
  const [notices, setNotices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Set as an attribute, since React does not know the non-standard folder picker property.
    folder.current?.setAttribute("webkitdirectory", "");
  }, []);
  const add = async (list: FileList | null, fromFolder: boolean) => {
    if (!list?.length) return;
    const picked = Array.from(list).filter((file) => !fromFolder || isAudioFileName(file.name));
    setBusy(true);
    setNotices([]);
    try {
      setNotices(await useSong.getState().addTracks(picked));
    } catch (error) {
      setNotices([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(false);
    }
  };
  const working = busy || ["decoding", "model", "splitting"].includes(status);
  return (
    <section
      aria-label="Import tracks"
      className="flex flex-col gap-2 rounded-lg border border-dashed border-seam px-3 py-2 text-sm"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void add(e.dataTransfer.files, false);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={working} onClick={() => files.current?.click()}>
          Add tracks…
        </Button>
        <Button size="sm" variant="outline" disabled={working} onClick={() => folder.current?.click()}>
          Add folder…
        </Button>
        <span className="opacity-70">Drop audio files here. Imported tracks are saved with the song.</span>
        <input
          ref={files}
          type="file"
          multiple
          accept={AUDIO_ACCEPT}
          hidden
          onChange={(e) => void add(e.target.files, false).then(() => (e.target.value = ""))}
        />
        <input ref={folder} type="file" multiple hidden onChange={(e) => void add(e.target.files, true).then(() => (e.target.value = ""))} />
      </div>
      {notices.length > 0 && (
        <ul role="status" className="flex list-disc flex-col gap-1 pl-5 text-led-warn">
          {notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
