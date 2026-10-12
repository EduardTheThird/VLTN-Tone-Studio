import { app, type BrowserWindow } from "electron";
import { arch, release } from "node:os";
import { join } from "node:path";
import { SESSION_LOG_MAX_BATCH, SESSION_LOG_MAX_LINE, sessionLogLine } from "@shared/host/log";
import { HostError } from "@shared/ipc";
import { handle, showSaveDialog } from "./handle";
import { SessionLogStore } from "./session-log-store";

let store: SessionLogStore | null = null;

/** Log a main-process line ("Error", "[update] check failed …"); before registerLogIpc it goes nowhere. */
export function logMain(kind: string, text: string): void {
  void store?.append([sessionLogLine(kind, text)]).catch((e) => console.error("[log]", e));
}

export function registerLogIpc(getWindow: () => BrowserWindow | null): void {
  store = new SessionLogStore(join(app.getPath("userData"), "logs"));
  const s = store;
  logMain("Start", `VLTN Tone Studio ${app.getVersion()}, Electron ${process.versions.electron}, ${process.platform} ${release()} ${arch()}`);

  handle("log:append", (_e, lines: unknown) => {
    if (!Array.isArray(lines) || lines.length > SESSION_LOG_MAX_BATCH || !lines.every((l) => typeof l === "string"))
      throw new HostError("invalid", `Log lines must be up to ${SESSION_LOG_MAX_BATCH} strings`);
    // One line per entry: a stray newline would start a line without a timestamp.
    return s.append((lines as string[]).map((l) => l.slice(0, SESSION_LOG_MAX_LINE).replace(/[\r\n]+/g, " ")));
  });

  handle("log:tail", (_e, count: unknown) => {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > SESSION_LOG_MAX_BATCH) throw new HostError("invalid", "Bad line count");
    return s.tail(count);
  });

  handle("log:save", async (_e, fileName: unknown) => {
    const name = typeof fileName === "string" && /^[\w.-]+\.txt$/.test(fileName) ? fileName : "tone-studio-log.txt";
    const res = await showSaveDialog(getWindow(), { defaultPath: join(app.getPath("documents"), name), filters: [{ name: "Text", extensions: ["txt"] }] });
    if (res.canceled || !res.filePath) return null;
    await s.saveTo(res.filePath);
    return res.filePath;
  });

  handle("log:folder", () => s.dir);
}
