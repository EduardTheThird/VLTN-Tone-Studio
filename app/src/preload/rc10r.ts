import type { Rc10rApi } from "@shared/host/rc10r";
import { invoke } from "./invoke";

export const rc10rApi: Rc10rApi = {
  reserve: () => invoke("rc10r:reserve"),
  inspect: (id) => invoke("rc10r:inspect", id),
  plan: (id, record, slot, memory) => invoke("rc10r:plan", id, record, slot, memory),
  write: (id) => invoke("rc10r:write", id),
  cancel: (id) => invoke("rc10r:cancel", id),
  recover: (id, backup) => invoke("rc10r:recover", id, backup),
  eject: (id) => invoke("rc10r:eject", id),
  release: (id) => invoke("rc10r:release", id),
  loops: () => invoke("rc10r:loops"),
  loopAudio: (backupId, path) => invoke("rc10r:loopAudio", backupId, path),
  backups: () => invoke("rc10r:backups"),
  pruneBackups: () => invoke("rc10r:pruneBackups"),
};
