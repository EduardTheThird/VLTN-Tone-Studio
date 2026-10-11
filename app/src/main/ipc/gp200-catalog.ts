import { app, type BrowserWindow, type OpenDialogOptions } from "electron";
import { homedir } from "node:os";
import { ALGORITHM_XML } from "@shared/host/gp200-catalog";
import { Gp200CatalogStore, algorithmXmlCandidates, findAlgorithmXml, readAlgorithmXml } from "./gp200-catalog-store";
import { handle, showOpenDialog } from "./handle";

// IPC of the GP-200 effect catalog import (logic and file layout: ./gp200-catalog-store.ts).
export function registerGp200CatalogIpc(getWindow: () => BrowserWindow | null): void {
  const store = new Gp200CatalogStore(app.getPath("userData"));
  handle("gp200Catalog:load", () => store.load());
  handle("gp200Catalog:findXml", async () => {
    const candidates = await algorithmXmlCandidates({ platform: process.platform, env: process.env, home: homedir() });
    const path = await findAlgorithmXml(candidates);
    return path ? readAlgorithmXml(path) : null;
  });
  handle("gp200Catalog:chooseXml", async () => {
    const opts: OpenDialogOptions = {
      title: `Choose the GP-200 editor's ${ALGORITHM_XML}`,
      properties: ["openFile"],
      filters: [{ name: "GP-200 effect list", extensions: ["xml"] }],
    };
    const res = await showOpenDialog(getWindow(), opts);
    const path = res.canceled ? null : res.filePaths[0];
    return path ? readAlgorithmXml(path) : null;
  });
  handle("gp200Catalog:save", (_e, catalog: unknown, source: string) => store.save(catalog, source));
  handle("gp200Catalog:remove", () => store.remove());
}
