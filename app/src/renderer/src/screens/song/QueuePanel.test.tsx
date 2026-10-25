import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyLibrary, type LibrarySong } from "@shared/song-library";
import { useSongLibrary } from "@/song/library";
import { QueuePanel } from "./QueuePanel";

vi.mock("@/host", () => ({ host: { song: { library: undefined } } }));

const song = (id: string, title: string): LibrarySong => ({ id, title, artist: "", sourceName: "", duration: 60, audio: [], settings: {}, updated: "" });
const songs = [song("a", "Alpha"), song("b", "Bravo"), song("c", "Charlie"), song("d", "Delta")];
const set = (queue: string[], position: number, playlistPlaying = true) =>
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs }, queue, position, playlistPlaying, busy: false, error: "", notice: "" });

beforeEach(() => set([], -1, false));
afterEach(cleanup);

it("shows the song playing as locked, and the songs to come", () => {
  set(["a", "b", "c"], 0);
  render(<QueuePanel />);
  expect(screen.getByLabelText("Playing now").textContent).toContain("Playing: Alpha");
  expect(screen.getByText(/2 to come/)).toBeTruthy();
  expect(screen.queryByLabelText("Remove queue entry 1")).not.toBeNull();
});

it("asks for a song to be loaded when nothing is loaded", () => {
  render(<QueuePanel />);
  expect(screen.getByText("Load a song to start the queue. Songs you add then play after it.")).toBeTruthy();
});

it("moves and removes upcoming songs without touching the playing one", () => {
  set(["a", "b", "c", "d"], 0);
  render(<QueuePanel />);
  fireEvent.click(screen.getByLabelText("Move queue entry 2 to top"));
  expect(useSongLibrary.getState().queue).toEqual(["a", "c", "b", "d"]);
  fireEvent.click(screen.getByLabelText("Remove queue entry 3"));
  expect(useSongLibrary.getState().queue).toEqual(["a", "c", "b"]);
  expect(useSongLibrary.getState().position).toBe(0);
  expect((screen.getByLabelText("Move queue entry 1 up") as HTMLButtonElement).disabled).toBe(true);
});

it("drags an upcoming song to a new place", () => {
  set(["a", "b", "c", "d"], 0);
  render(<QueuePanel />);
  const items = screen.getAllByRole("listitem");
  fireEvent.dragStart(items[2]);
  fireEvent.drop(items[0]);
  expect(useSongLibrary.getState().queue).toEqual(["a", "d", "b", "c"]);
});

it("offers no controls on the song that is playing", () => {
  set(["a", "b"], 0);
  render(<QueuePanel />);
  expect(screen.getByLabelText("Playing now").querySelectorAll("button")).toHaveLength(0);
  expect(screen.queryByLabelText("Remove queue entry 0")).toBeNull();
});
