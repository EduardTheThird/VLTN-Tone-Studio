import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyLibrary, type LibrarySong, type Playlist } from "@shared/song-library";
import { useSongLibrary } from "@/song/library";
import { SetEditor } from "./SetEditor";

const api = vi.hoisted(() => ({ playlists: vi.fn(), index: vi.fn(), organise: vi.fn(), onTransferProgress: vi.fn() }));
vi.mock("@/host", () => ({ host: { song: { library: api } } }));

const ids = ["s1", "s2", "s3", "s4"];
const song = (id: string, duration: number): LibrarySong => ({
  id,
  title: `Song ${id}`,
  artist: "",
  sourceName: "",
  duration,
  audio: [],
  settings: {},
  updated: "",
});
const songs = [song("s1", 100), song("s2", 200), song("s3", 300), song("s4", 50)];
const playlist = (extra: Partial<Playlist> = {}): Playlist => ({ id: "11111111-1111-1111-1111-111111111111", name: "Gig", songs: ids, sets: [], ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  api.playlists.mockResolvedValue(undefined);
  api.index.mockResolvedValue({ ...emptyLibrary(), songs });
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs }, busy: false, error: "", notice: "", queue: [], position: -1, playlistPlaying: false });
});
afterEach(cleanup);

it("shows each set with its song count and running time, and plays only that set", async () => {
  const playPlaylist = vi.fn(async () => {});
  useSongLibrary.setState({ playPlaylist: playPlaylist as never });
  const sets = [
    { id: "22222222-2222-2222-2222-222222222222", name: "Set 1", start: 0 },
    { id: "33333333-3333-3333-3333-333333333333", name: "Encore", start: 2 },
  ];
  render(<SetEditor playlist={playlist({ sets })} songs={songs} />);
  expect(screen.getByLabelText("Set Encore").textContent).toContain("2 songs · 5:50");
  await act(async () => {
    fireEvent.click(screen.getAllByText("Play set")[1]);
  });
  expect(playPlaylist).toHaveBeenCalledWith(["s3", "s4"], 0, "33333333-3333-3333-3333-333333333333", [null, null]);
});

it("starts a set at an entry, and the set heading goes with the entries when one is removed", async () => {
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs, playlists: [playlist()] } });
  render(<SetEditor playlist={playlist()} songs={songs} />);
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Start a set at entry 3"));
  });
  const [saved] = api.playlists.mock.calls.at(-1) as [Playlist[]];
  expect(saved[0].sets).toEqual([expect.objectContaining({ name: "Set 1", start: 2 })]);
  cleanup();
  const sets = [{ id: "44444444-4444-4444-4444-444444444444", name: "Encore", start: 2 }];
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs, playlists: [playlist({ sets })] } });
  render(<SetEditor playlist={playlist({ sets })} songs={songs} />);
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Remove entry 1"));
  });
  const [after] = api.playlists.mock.calls.at(-1) as [Playlist[]];
  expect(after[0].songs).toEqual(["s2", "s3", "s4"]);
  expect(after[0].sets).toEqual([expect.objectContaining({ name: "Encore", start: 1 })]);
});

it("queues from a point in the playlist through the queue, not by changing the playlist", async () => {
  useSongLibrary.setState({ queue: ["s1"], position: 0, playlistPlaying: true });
  render(<SetEditor playlist={playlist()} songs={songs} />);
  await act(async () => {
    fireEvent.click(screen.getAllByText("Queue from here")[2]);
  });
  expect(useSongLibrary.getState().queue).toEqual(["s1", "s3", "s4"]);
  expect(api.playlists).not.toHaveBeenCalled();
});

it("saves each entry's end behaviour and whether it starts by itself with the playlist", async () => {
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs, playlists: [playlist()] } });
  render(<SetEditor playlist={playlist()} songs={songs} />);
  fireEvent.change(screen.getByLabelText("Entry 2 end"), { target: { value: "loop" } });
  await act(async () => {});
  const [saved] = api.playlists.mock.calls.at(-1) as [Playlist[]];
  expect(saved[0].overrides).toEqual([null, { endBehaviour: "loop" }, null, null]);
  // The entry keeps its loop when its autoplay is switched off as well.
  cleanup();
  const looped = playlist({ overrides: [null, { endBehaviour: "loop" }, null, null] });
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs, playlists: [looped] } });
  render(<SetEditor playlist={looped} songs={songs} />);
  fireEvent.click(screen.getByLabelText("Entry 2 starts by itself"));
  await act(async () => {});
  const [after] = api.playlists.mock.calls.at(-1) as [Playlist[]];
  expect(after[0].overrides).toEqual([null, { endBehaviour: "loop", autoplay: false }, null, null]);
});
