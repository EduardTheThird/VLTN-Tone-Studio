import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Rc10rTransferDialog } from "./Rc10rTransferDialog";
import type { Rc10rStorageView } from "@shared/host/rc10r";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  plan: vi.fn(),
  write: vi.fn(),
  close: vi.fn(),
  cancel: vi.fn(),
  recover: vi.fn(),
  sent: vi.fn(),
  show: vi.fn(),
}));
vi.mock("@/host", () => ({ host: { rc10r: {}, app: { showItemInFolder: mocks.show } } }));
vi.mock("@/song/band/rc10r-connection", () => ({
  Rc10rConnection: class {
    active = false;
    inspection?: Rc10rStorageView;
    planned?: unknown;
    async open() {
      this.active = true;
      return (this.inspection = await mocks.open());
    }
    async plan(...args: unknown[]) {
      return (this.planned = await mocks.plan(...args));
    }
    write = mocks.write;
    cancel = mocks.cancel;
    recover = mocks.recover;
    async close() {
      await mocks.close();
      this.active = false;
    }
    async releaseDisconnected() {
      this.active = false;
    }
  },
}));
const view: Rc10rStorageView = { id: "session", patterns: [{ slot: 1, name: "Existing", kit: 0, bpm: 120 }], recoveries: [] };
const plan = { slot: 2, memory: null, name: "New", previous: null, backupPath: "/checked/full-backup" };
function open() {
  return render(<Rc10rTransferDialog record={new Uint8Array([1, 2, 3])} onSent={mocks.sent} onClose={vi.fn()} />);
}
async function connect() {
  fireEvent.click(screen.getByRole("checkbox", { name: /I understand/ }));
  fireEvent.click(screen.getByRole("button", { name: "Connect RC-10R" }));
  await screen.findByRole("button", { name: "Back up and review…" });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.open.mockResolvedValue(view);
  mocks.plan.mockResolvedValue(plan);
  mocks.write.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.cancel.mockResolvedValue(undefined);
  mocks.recover.mockResolvedValue(undefined);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  cleanup();
  await new Promise((done) => setTimeout(done, 0));
  vi.unstubAllGlobals();
});

it("requires beta acknowledgement, a verified full backup and review before sending", async () => {
  open();
  expect((screen.getByRole("button", { name: "Connect RC-10R" }) as HTMLButtonElement).disabled).toBe(true);
  await connect();
  expect(mocks.write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back up and review…" }));
  await screen.findByText("Verified full backup: /checked/full-backup");
  expect(mocks.plan).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 2, null);
  expect(mocks.write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send User 2" }));
  await waitFor(() => expect(mocks.sent).toHaveBeenCalledOnce());
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.write.mock.invocationCallOrder[0]).toBeLessThan(mocks.close.mock.invocationCallOrder[0]);
  expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(mocks.sent.mock.invocationCallOrder[0]);
  expect(screen.getByText(/Confirm the transfer after your check/)).toBeTruthy();
});

it("requires acknowledgement for an occupied slot and validates optional phrase memory separately", async () => {
  open();
  await connect();
  const prepare = screen.getByRole("button", { name: "Back up and review…" }) as HTMLButtonElement;
  fireEvent.change(screen.getByLabelText("Native User rhythm"), { target: { value: "1" } });
  expect(prepare.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Replace User 1: Existing" }));
  expect(prepare.disabled).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", { name: /Also set this rhythm/ }));
  fireEvent.change(screen.getByLabelText("Native phrase memory"), { target: { value: "100" } });
  expect(prepare.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Native phrase memory"), { target: { value: "99" } });
  fireEvent.click(prepare);
  await waitFor(() => expect(mocks.plan).toHaveBeenCalledWith(expect.any(Uint8Array), 1, 99));
});

it("keeps recovery available for damaged memory copies while blocking new writes", async () => {
  mocks.open.mockResolvedValue({ ...view, problem: "Memory copies disagree", recoveries: [{ id: "old", date: "2026-11-15", state: "partial" }] });
  open();
  await connect();
  expect((screen.getByRole("button", { name: "Back up and review…" }) as HTMLButtonElement).disabled).toBe(true);
  const restore = screen.getByRole("button", { name: "Restore from transfer backup" }) as HTMLButtonElement;
  expect(restore.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: /Restore the files this operation changed/ }));
  fireEvent.click(restore);
  await waitFor(() => expect(mocks.recover).toHaveBeenCalledWith("old"));
  await screen.findByText(/files were restored from the verified backup/);
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.sent).not.toHaveBeenCalled();
});

it("does not mark a transfer successful when readback or disconnect fails", async () => {
  mocks.write.mockRejectedValueOnce(new Error("Readback failed. Backup: /checked/full-backup"));
  open();
  await connect();
  fireEvent.click(screen.getByRole("button", { name: "Back up and review…" }));
  fireEvent.click(await screen.findByRole("button", { name: "Send User 2" }));
  await screen.findByText(/Readback failed/);
  expect(mocks.sent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect and close" }));
  await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
});

it("offers cancellation during backup and retains the error and disconnect controls", async () => {
  let reject!: (error: Error) => void;
  mocks.plan.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  open();
  await connect();
  fireEvent.click(screen.getByRole("button", { name: "Back up and review…" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel after current file" }));
  expect(mocks.cancel).toHaveBeenCalledOnce();
  reject(new Error("Transfer cancelled"));
  await screen.findByText("Transfer cancelled");
  expect(screen.getByRole("button", { name: "Disconnect and close" })).toBeTruthy();
  expect(mocks.write).not.toHaveBeenCalled();
});
