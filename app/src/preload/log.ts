import type { SessionLogApi } from "@shared/host/log";
import { invoke } from "./invoke";

export const logApi: SessionLogApi = {
  append: (lines) => invoke("log:append", lines),
  tail: (count) => invoke("log:tail", count),
  save: (fileName) => invoke("log:save", fileName),
  folder: () => invoke("log:folder"),
};
