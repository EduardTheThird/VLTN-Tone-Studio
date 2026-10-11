import type { Gp200CatalogApi } from "@shared/host/gp200-catalog";
import { invoke } from "./invoke";

export const gp200CatalogApi: Gp200CatalogApi = {
  load: () => invoke("gp200Catalog:load"),
  findXml: () => invoke("gp200Catalog:findXml"),
  chooseXml: () => invoke("gp200Catalog:chooseXml"),
  save: (catalog, source) => invoke("gp200Catalog:save", catalog, source),
  remove: () => invoke("gp200Catalog:remove"),
};
