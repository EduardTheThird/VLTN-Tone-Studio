import { SESSION_LOG_MAX_LINE, sessionLogLine, type SessionLogApi } from "@shared/host/log";
import { webDevice } from "./device";

/** Browser build: the log lives in memory for this tab, newest LINE_CAP lines. */
const LINE_CAP = 20_000;
const lines: string[] = [sessionLogLine("Start", `VLTN Tone Studio in the browser, ${navigator.userAgent}`)];

export const webLog: SessionLogApi = {
  append: async (batch) => {
    for (const l of batch) lines.push(l.slice(0, SESSION_LOG_MAX_LINE));
    if (lines.length > LINE_CAP) lines.splice(0, lines.length - LINE_CAP);
  },
  tail: async (count) => lines.slice(-count),
  save: (fileName) => webDevice.saveReport(lines.join("\n") + "\n", fileName),
  folder: async () => null,
};
