import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSongLibrary } from "@/song/library";
import type { Playlist } from "@shared/song-library";
import { SetEditor } from "./SetEditor";
import { SmartPlaylistEditor } from "./SmartPlaylistEditor";

const field = "rounded border border-seam bg-transparent p-2";

/** Playlists: regular playlists as headed sets, and smart playlists defined by rules. Creating, renaming and deleting are here too. */
export function PlaylistsPanel() {
  const library = useSongLibrary();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"static" | "smart">("static");
  const [selected, setSelected] = useState("");
  const [confirm, setConfirm] = useState("");
  const playlist = library.index.playlists.find((p) => p.id === selected);
  const songs = library.index.songs;
  const create = () => {
    const id = crypto.randomUUID();
    const next: Playlist =
      kind === "smart"
        ? { id, name: name.trim(), songs: [], smart: { match: "all", rules: [], sort: "title" } }
        : { id, name: name.trim(), songs: [], sets: [] };
    void library.addPlaylist(next).then(() => setSelected(id));
    setName("");
  };
  return (
    <section aria-label="Playlists" className="space-y-3 rounded border border-seam p-4">
      <h2 className="font-semibold">Playlists / live sets</h2>
      <div className="flex flex-wrap gap-2">
        <input aria-label="New playlist name" placeholder="New playlist name" className={field} value={name} onChange={(e) => setName(e.target.value)} />
        <select aria-label="New playlist kind" className={field} value={kind} onChange={(e) => setKind(e.target.value as "static" | "smart")}>
          <option value="static">Playlist</option>
          <option value="smart">Smart playlist (by rules)</option>
        </select>
        <Button disabled={!name.trim() || library.busy} onClick={create}>
          Create playlist
        </Button>
      </div>
      <select
        aria-label="Playlist"
        className={field + " w-full"}
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
          setConfirm("");
        }}
      >
        <option value="">Select a playlist…</option>
        {library.index.playlists.map((p) => (
          <option value={p.id} key={p.id}>
            {p.name} ({p.smart ? "smart" : p.songs.length})
          </option>
        ))}
      </select>
      {playlist && (
        <>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="Playlist name"
              key={playlist.id + playlist.name}
              defaultValue={playlist.name}
              className={field}
              disabled={library.busy}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== playlist.name) void library.updatePlaylist(playlist.id, { name: next });
              }}
            />
            <Button variant="outline" disabled={library.busy} onClick={() => setConfirm("playlist:" + playlist.id)}>
              Delete playlist…
            </Button>
          </div>
          {confirm === "playlist:" + playlist.id && (
            <div>
              Keep the songs and delete this playlist?{" "}
              <Button
                disabled={library.busy}
                onClick={() => {
                  void library.deletePlaylist(playlist.id);
                  setSelected("");
                  setConfirm("");
                }}
              >
                Confirm delete playlist
              </Button>
              <Button variant="outline" onClick={() => setConfirm("")}>
                Keep playlist
              </Button>
            </div>
          )}
          {playlist.smart ? <SmartPlaylistEditor key={playlist.id} playlist={playlist} /> : <SetEditor key={playlist.id} playlist={playlist} songs={songs} />}
        </>
      )}
    </section>
  );
}
