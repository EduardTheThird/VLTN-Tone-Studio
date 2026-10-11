import { ALGORITHM_XML, decodeXmlText, parseStoredCatalog, storedCatalogFile, type Gp200CatalogApi } from "@shared/host/gp200-catalog";
import { HostError } from "@shared/ipc";

// Browser build: no install folders to search; the user picks algorithm.xml and the built catalog is kept in this
// browser's localStorage (about 190 KB).
const KEY = "gp200.catalog";

function chooseXmlFile(): Promise<File | null> {
  const { promise, resolve } = Promise.withResolvers<File | null>();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".xml,text/xml,application/xml";
  input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
  input.addEventListener("cancel", () => resolve(null), { once: true });
  input.click();
  return promise;
}

export const webGp200Catalog: Gp200CatalogApi = {
  async load() {
    const text = localStorage.getItem(KEY);
    return text === null ? null : parseStoredCatalog(text);
  },
  findXml: async () => null,
  async chooseXml() {
    const file = await chooseXmlFile();
    if (!file) return null;
    try {
      return { path: file.name, text: decodeXmlText(new Uint8Array(await file.arrayBuffer())) };
    } catch (e) {
      throw new HostError("invalid", e instanceof Error ? e.message : String(e));
    }
  },
  async save(catalog, source) {
    const { kept, text } = storedCatalogFile(catalog, source, new Date());
    try {
      localStorage.setItem(KEY, text);
    } catch {
      throw new HostError("io", `This browser has no room to keep the effect list from ${ALGORITHM_XML}.`);
    }
    return kept;
  },
  remove: async () => localStorage.removeItem(KEY),
};
