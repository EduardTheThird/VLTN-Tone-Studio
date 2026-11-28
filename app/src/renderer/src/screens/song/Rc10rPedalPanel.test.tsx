import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Rc10rMemorySummary } from "@shared/rc10r-memory-map";
import { Rc10rPedalPanel } from "./Rc10rPedalPanel";
import { useRc10rPedalReading } from "@/song/band/rc10r-pedal-state";

const api = vi.hoisted(() => ({
  loops: vi.fn(),
  loopAudio: vi.fn(),
  backups: vi.fn(),
  pruneBackups: vi.fn(),
}));
vi.mock("@/host", () => ({ host: { rc10r: api } }));
const memory = (n: number, user: number | null, loop = 0): Rc10rMemorySummary => ({
  memory: n,
  genre: user ? 20 : 6,
  pattern: user ? user - 1 : 0,
  userRhythm: user,
  kit: 0,
  tempo: 120,
  intro: true,
  stopMode: 3,
  playMode: 0,
  tracks: [
    { recorded: loop > 0, seconds: loop, tempo: 120 },
    { recorded: false, seconds: 0, tempo: 120 },
  ],
});
const songs = [{ id: "a", title: "Insomnia", settings: { ":options": JSON.stringify({ rhythmAutomation: { memory: 1 } }) } }];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("vltn.card.rc10r-pedal", "open");
  api.loops.mockResolvedValue({ backup: { id: "b".repeat(8) + "-0000-0000-0000-000000000000", date: "2026-11-28T10:00:00Z" }, loops: [{ memory: 20, track: 1, path: "ROLAND/WAVE/020_1/020_1.WAV", bytes: 44 + 44100 * 8 * 16 }] });
  api.loopAudio.mockResolvedValue(new Uint8Array([1, 2, 3]));
  api.backups.mockResolvedValue({ count: 8, bytes: 5.1e9, removable: 3 });
  api.pruneBackups.mockResolvedValue({ count: 5, bytes: 1e9, removable: 0 });
  useRc10rPedalReading.setState({
    saved: {
      readAt: "2026-11-28T10:00:00Z",
      reading: { storageBytes: 650e6, loopBytes: 640e6, backupCopyBytes: 3e6, memories: [memory(1, 1), memory(7, null), memory(20, null, 16)] },
    },
  });
});
afterEach(cleanup);

const openCard = async () => {
  await waitFor(() => expect(document.querySelectorAll("details").length).toBe(2));
  document.querySelectorAll("details").forEach((d) => (d.open = true));
};

it("maps memories with their rhythm, loops and songs (spec 177)", async () => {
  render(<Rc10rPedalPanel songs={songs} onRead={vi.fn()} locked={false} />);
  await openCard();
  const table = await screen.findByRole("table", { name: "RC-10R memories" });
  expect(within(table).getByText("User 1")).toBeTruthy();
  expect(within(table).getByText("Insomnia")).toBeTruthy();
  expect(within(table).getByText("T1 16 s")).toBeTruthy();
  expect(table.querySelector('[data-memory="7"]')).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: /Only memories/ }));
  expect(table.querySelector('[data-memory="7"]')).toBeTruthy();
});

it("adds a loop from the newest backup to the song as a track (spec 178)", async () => {
  const onAddLoop = vi.fn(async () => {});
  render(<Rc10rPedalPanel songs={songs} onRead={vi.fn()} onAddLoop={onAddLoop} locked={false} />);
  await openCard();
  fireEvent.click(await screen.findByRole("button", { name: "Add to this song" }));
  await waitFor(() => expect(onAddLoop).toHaveBeenCalledOnce());
  const file = (onAddLoop.mock.calls[0] as unknown as [File])[0];
  expect(file.name).toBe("RC-10R memory 20 track 1.wav");
  expect(screen.getByText(/Memory 20, track 1 · 16 s/)).toBeTruthy();
});

it("removes older backups only after a confirmation (spec 175)", async () => {
  render(<Rc10rPedalPanel songs={songs} onRead={vi.fn()} locked={false} />);
  await openCard();
  fireEvent.click(await screen.findByRole("button", { name: "Remove older backups…" }));
  expect(api.pruneBackups).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(api.pruneBackups).toHaveBeenCalledOnce());
  expect(await screen.findByText(/Pedal backups: 5/)).toBeTruthy();
});
