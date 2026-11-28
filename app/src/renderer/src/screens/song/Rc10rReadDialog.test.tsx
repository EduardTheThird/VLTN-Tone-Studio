import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Rc10rStorageView } from "@shared/host/rc10r";
import { Rc10rReadDialog, WAITING_HINT_MS } from "./Rc10rReadDialog";
import { useRc10rPedalReading } from "@/song/band/rc10r-pedal-state";

const mocks = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn(), cancel: vi.fn() }));
vi.mock("@/host", () => ({ host: { rc10r: {} } }));
vi.mock("@/song/band/rc10r-connection", () => ({
  Rc10rConnection: class {
    active = false;
    async open() {
      this.active = true;
      return mocks.open();
    }
    async close() {
      await mocks.close();
      this.active = false;
    }
    cancel = mocks.cancel;
  },
}));
const reading = { storageBytes: 650e6, loopBytes: 640e6, backupCopyBytes: 3e6, systemProblem: undefined };
const view = (extra: Partial<Rc10rStorageView> = {}): Rc10rStorageView => ({ id: "s", patterns: [], recoveries: [], reading, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.close.mockResolvedValue(undefined);
  mocks.cancel.mockResolvedValue(undefined);
  localStorage.clear();
  useRc10rPedalReading.setState({ saved: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("reads, saves the reading and ejects without writing (spec 174)", async () => {
  mocks.open.mockResolvedValue(view());
  render(<Rc10rReadDialog onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Read the RC-10R" }));
  expect(await screen.findByText(/Pedal storage 650 MB, of which loops 640 MB. The next send backs up about 3 MB/)).toBeTruthy();
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(useRc10rPedalReading.getState().saved?.reading.loopBytes).toBe(640e6);
});

it("shows the macOS hint when reading takes longer than five seconds (spec 179)", async () => {
  vi.useFakeTimers();
  let finish!: (value: Rc10rStorageView) => void;
  mocks.open.mockReturnValue(new Promise((done) => (finish = done)));
  render(<Rc10rReadDialog onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Read the RC-10R" }));
  expect(screen.queryByText(/Waiting for macOS/)).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(WAITING_HINT_MS + 10);
  });
  expect(screen.getByText(/choose Allow/)).toBeTruthy();
  await act(async () => finish(view()));
  vi.useRealTimers();
  await waitFor(() => expect(screen.queryByText(/Waiting for macOS/)).toBeNull());
});

it("explains a busy drive in plain words", async () => {
  mocks.open.mockResolvedValue(view());
  mocks.close.mockRejectedValueOnce(new Error("Unmount of disk8 failed: at least one volume could not be unmounted"));
  render(<Rc10rReadDialog onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Read the RC-10R" }));
  expect(await screen.findByText(/Eject BOSS RC-10R in Finder/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Disconnect and close" })).toBeTruthy();
});
