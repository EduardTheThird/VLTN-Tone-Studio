import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import { HostError, type Result } from "@shared/ipc";

/** Register an invoke handler that always resolves to a Result (Electron only serializes Error.message). */
export function handle<A extends unknown[], T>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: A) => Promise<T> | T): void {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(event, ...(args as A)) };
    } catch (e) {
      if (e instanceof HostError) return { ok: false, error: { code: e.code, message: e.message } };
      const err = e as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") return { ok: false, error: { code: "not-found", message: err.message } };
      return { ok: false, error: { code: "internal", message: err?.message ?? String(e) } };
    }
  });
}

/** Open dialog, modal to the window when there is one. */
export function showOpenDialog(win: BrowserWindow | null, options: OpenDialogOptions) {
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
}

/** Save dialog, modal to the window when there is one. */
export function showSaveDialog(win: BrowserWindow | null, options: SaveDialogOptions) {
  return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options);
}
