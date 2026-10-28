import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSongLibrary } from "@/song/library";
import { runningSeconds } from "@/song/performance/running-time";
import { formatTime } from "@/song/stems/mix";
import { addSet, blockSummaries, deleteSet, moveEntry, removeEntry, renameSet } from "@shared/playlist-sets";
import type { LibrarySong, Playlist } from "@shared/song-library";
import { PlaylistPreflight } from "./PlaylistPreflight";
import { EntryOverrideControls } from "./EntryOverrideControls";
import { overridesFor, withOverride, type EntryOverride } from "@shared/entry-overrides";

const field = "rounded border border-seam bg-transparent p-2";
const row = "flex flex-wrap items-center gap-2 rounded border border-seam p-2";

/**
 * A static playlist as headed sets. A set heading is a block of entries with its own count and running time; "Play set" stops at the end
 * of the block. Entries can be moved, removed, queued from here or started as a new set. Editing never changes the song that is playing.
 */
export function SetEditor({ playlist, songs }: { playlist: Playlist; songs: LibrarySong[] }) {
  const library = useSongLibrary();
  const [hint, setHint] = useState("");
  const byId = new Map(songs.map((song) => [song.id, song]));
  const blocks = blockSummaries(playlist, songs, runningSeconds);
  const duration = blocks.reduce((sum, block) => sum + block.seconds, 0);
  // Editing the playlist never changes the queue that is playing, so only a save in progress holds the editor.
  const busy = library.busy;
  const overrides = overridesFor(playlist.songs.length, playlist.overrides);
  const save = (change: Partial<Pick<Playlist, "songs" | "sets" | "overrides">>) => {
    setHint("");
    void library.updatePlaylist(playlist.id, change);
  };
  const title = (id: string) => byId.get(id)?.title ?? "Missing song";
  const queueIds = (ids: string[], entryOverrides: (EntryOverride | null)[]) => {
    const reason = library.addToQueue(ids, entryOverrides);
    setHint(reason ?? (ids.length ? `Queued ${ids.length} song${ids.length === 1 ? "" : "s"}.` : ""));
  };
  const entries = (start: number, end: number) => playlist.songs.slice(start, end);
  const startSet = (at: number) => {
    const name = `Set ${(playlist.sets?.length ?? 0) + 1}`;
    const result = addSet(playlist, name, at, crypto.randomUUID());
    if (!result.ok) return setHint(result.reason);
    save({ sets: result.sets });
  };
  const removeAt = (i: number) => save(removeEntry(playlist, i));
  const moveTo = (from: number, to: number) => save(moveEntry(playlist, from, to));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!playlist.songs.length || busy} onClick={() => void library.playPlaylist([...playlist.songs], 0, undefined, overrides)}>
          Play playlist
        </Button>
        <Button
          variant="outline"
          disabled={!playlist.songs.length || busy}
          onClick={() => void library.load(playlist.songs[0], [...playlist.songs], 0, overrides)}
        >
          Load set paused
        </Button>
        <Button variant="outline" disabled={!playlist.songs.length || busy} onClick={() => queueIds(playlist.songs, overrides)}>
          Queue all
        </Button>
      </div>
      <p className="text-sm">
        {playlist.songs.length} entries · {formatTime(duration)} · Automatically advances during playback
      </p>
      <PlaylistPreflight key={playlist.id} ids={playlist.songs} disabled={busy} revision={library.index} songs={songs} />
      <ol className="space-y-2">
        {blocks.map((block, b) => (
          <li key={`${block.start}-${block.set?.id ?? "lead"}`} className="space-y-2">
            {block.set ? (
              <div className={row} aria-label={`Set ${block.name}`}>
                <input
                  aria-label="Set name"
                  key={block.set.id + block.set.name}
                  defaultValue={block.set.name}
                  className={field}
                  disabled={busy}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next && next !== block.set!.name) save({ sets: renameSet(playlist.sets ?? [], block.set!.id, next) });
                  }}
                />
                <span className="flex-1 text-sm text-silkscreen-3">
                  {block.count} songs · {formatTime(block.seconds)}
                </span>
                <Button
                  variant="outline"
                  disabled={!block.count || busy}
                  onClick={() => void library.playPlaylist(entries(block.start, block.end), 0, block.set!.id, overrides.slice(block.start, block.end))}
                >
                  Play set
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => save({ sets: deleteSet(playlist.sets ?? [], block.set!.id) })}>
                  Remove set heading
                </Button>
              </div>
            ) : (
              b === 0 && blocks.length > 1 && <p className="text-sm text-silkscreen-3">Before the first set</p>
            )}
            {entries(block.start, block.end).map((id, offset) => {
              const i = block.start + offset;
              return (
                <div key={i} className={row}>
                  <span className="flex-1">
                    {i + 1}. {title(id)}
                  </span>
                  <Button variant="outline" disabled={busy} onClick={() => void library.playPlaylist([...playlist.songs], i, undefined, overrides)}>
                    Play from here
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => void library.load(id, [...playlist.songs], i, overrides)}>
                    Load paused
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => queueIds(playlist.songs.slice(i), overrides.slice(i))}>
                    Queue from here
                  </Button>
                  {!playlist.sets?.some((set) => set.start === i) && i > 0 && (
                    <Button variant="outline" aria-label={`Start a set at entry ${i + 1}`} disabled={busy} onClick={() => startSet(i)}>
                      Start a set here
                    </Button>
                  )}
                  <EntryOverrideControls
                    label={`Entry ${i + 1}`}
                    value={overrides[i]}
                    disabled={busy}
                    onChange={(next) => save({ overrides: withOverride(overrides, i, next) })}
                  />
                  <Button aria-label={`Move entry ${i + 1} up`} variant="outline" disabled={i === 0 || busy} onClick={() => moveTo(i, i - 1)}>
                    ↑
                  </Button>
                  <Button
                    aria-label={`Move entry ${i + 1} down`}
                    variant="outline"
                    disabled={i === playlist.songs.length - 1 || busy}
                    onClick={() => moveTo(i, i + 1)}
                  >
                    ↓
                  </Button>
                  <Button aria-label={`Remove entry ${i + 1}`} variant="outline" disabled={busy} onClick={() => removeAt(i)}>
                    Remove
                  </Button>
                </div>
              );
            })}
          </li>
        ))}
      </ol>
      {hint && (
        <p role="status" className="text-sm">
          {hint}
        </p>
      )}
    </div>
  );
}
