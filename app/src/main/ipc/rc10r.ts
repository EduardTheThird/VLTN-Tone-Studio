import { app, type BrowserWindow } from "electron";
import { join } from "node:path";
import { HostError } from "@shared/ipc";
import { RC10R_RECORD_BYTES } from "@shared/rc10r-bank";
import { handle, shellPaths } from "./handle";
import { Rc10rStore } from "./rc10r-store";
import { ejectRc10rVolume, findRc10rVolumes } from "./rc10r-volume";

let store: Rc10rStore | undefined;
/** Includes preparation and disconnect, so quit/update guards cover the complete storage session. */
export const isRc10rBusy = () => store?.busy ?? false;

export function registerRc10rIpc(getWindow: () => BrowserWindow | null): void {
  const backupRoot = join(app.getPath("userData"), "rc10r-backups");
  store = new Rc10rStore({ backupRoot, discover: findRc10rVolumes, eject: ejectRc10rVolume });
  const service = store;
  shellPaths.allow(backupRoot);
  const idOf = (id: unknown): string => {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new HostError("invalid", "Invalid RC-10R connection.");
    return id;
  };
  const watched = new Set<number>();
  handle("rc10r:reserve", (event) => {
    if (event.sender !== getWindow()?.webContents) throw new HostError("unauthorized", "Open native transfer in the main window.");
    if (process.platform !== "darwin") throw new HostError("unsupported", "Native RC-10R sending currently requires macOS.");
    if (!watched.has(event.sender.id)) {
      const owner = event.sender.id;
      watched.add(owner);
      event.sender.on("render-process-gone", () => {
        void service.abandon(owner);
      });
      event.sender.once("destroyed", () => {
        watched.delete(owner);
        void service.abandon(owner);
      });
    }
    return service.reserve(event.sender.id);
  });
  handle("rc10r:inspect", (e, id: unknown) => service.inspect(idOf(id), e.sender.id));
  handle("rc10r:plan", (e, id: unknown, record: unknown, slot: unknown, memory: unknown) => {
    if (!(record instanceof Uint8Array) || record.length !== RC10R_RECORD_BYTES || typeof slot !== "number" || (memory !== null && typeof memory !== "number"))
      throw new HostError("invalid", "Invalid RC-10R transfer plan.");
    return service.plan(idOf(id), e.sender.id, record, slot, memory);
  });
  handle("rc10r:write", (e, id: unknown) => service.write(idOf(id), e.sender.id));
  handle("rc10r:cancel", (e, id: unknown) => service.cancel(idOf(id), e.sender.id));
  handle("rc10r:recover", (e, id: unknown, backup: unknown) => service.recover(idOf(id), e.sender.id, idOf(backup)));
  handle("rc10r:eject", (e, id: unknown) => service.eject(idOf(id), e.sender.id));
  handle("rc10r:release", (e, id: unknown) => service.release(idOf(id), e.sender.id));
}
