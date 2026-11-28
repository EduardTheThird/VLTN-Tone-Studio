import { useEffect, useRef, useState } from "react";
import { host } from "@/host";
import type { Rc10rStorageView, Rc10rWritePlan } from "@shared/host/rc10r";
import { Rc10rConnection } from "@/song/band/rc10r-connection";
import { sessionLog } from "@/state/session-log";
import { friendlyRc10rError, useRc10rPedalReading } from "@/song/band/rc10r-pedal-state";

/** Shown while the drive is mounted but macOS hasn't let the app read it yet (spec 179). */
export const RC10R_WAITING_HINT_MS = 5000;

// A failed disconnect remains reachable when the song screen is reopened.
let retainedConnection: Rc10rConnection | undefined;
/** Failed cleanup stays accessible even after the cable has been unplugged. */
export const hasRetainedRc10rConnection = () => retainedConnection?.active ?? false;
export interface Rc10rTransferProps {
  record: Uint8Array;
  onSent(): void;
  onClose(): void;
}

/** Retains ownership until storage and MIDI cleanup both finish, including across unmounts. */
export function useRc10rTransfer({ record, onSent, onClose }: Rc10rTransferProps) {
  const connection = useRef(retainedConnection?.active ? retainedConnection : undefined);
  const [phase, setPhase] = useState(connection.current ? "error" : "idle");
  const [view, setView] = useState<Rc10rStorageView | undefined>(connection.current?.inspection);
  const [plan, setPlan] = useState<Rc10rWritePlan | undefined>(connection.current?.planned);
  const [error, setError] = useState(connection.current ? "A previous connection needs to be closed. Retry disconnecting before another transfer." : "");
  const [beta, setBeta] = useState(false);
  const [slot, setSlot] = useState(1);
  const [memory, setMemory] = useState(1);
  const [settings, setSettings] = useState(false);
  const [replace, setReplace] = useState(false);
  const [restore, setRestore] = useState(false);
  const [recovery, setRecovery] = useState(connection.current?.inspection?.recoveries[0]?.id ?? "");
  const [manual, setManual] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const alive = useRef(true);
  const operation = useRef<Promise<void> | undefined>(undefined);
  const busy = ["connecting", "backing-up", "writing", "closing", "restoring"].includes(phase);
  const previous = view?.patterns.find((p) => p.slot === slot);
  useEffect(() => {
    if (phase !== "connecting") {
      setWaiting(false);
      return;
    }
    const timer = setTimeout(() => setWaiting(true), RC10R_WAITING_HINT_MS);
    return () => clearTimeout(timer);
  }, [phase]);
  const run = (next: string, action: () => Promise<void>) => {
    setPhase(next);
    setError("");
    const promise = action().catch((problem) => {
      if (alive.current) {
        setError(friendlyRc10rError(problem instanceof Error ? problem.message : String(problem)));
        setPhase("error");
      }
    });
    operation.current = promise;
    void promise;
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const current = connection.current;
      if (!current?.active) return;
      void current
        .cancel()
        .catch(() => {})
        .then(async () => {
          await operation.current;
          await current.close().catch(() => {
            /* Retained for an explicit disconnect retry when the dialog reopens. */
          });
        });
    };
  }, []);
  const close = () =>
    run("closing", async () => {
      await connection.current?.close();
      if (alive.current) onClose();
    });
  const connect = () =>
    run("connecting", async () => {
      if (!host.rc10r) throw new Error("Native transfer requires the macOS desktop app.");
      const next = new Rc10rConnection({
        api: host.rc10r,
        access: () => navigator.requestMIDIAccess({ sysex: true }),
        log: (line) => sessionLog("RC10R", line),
      });
      connection.current = retainedConnection = next;
      const result = await next.open();
      if (result.reading) useRc10rPedalReading.getState().save(result.reading);
      if (alive.current) {
        setView(result);
        setSlot(Math.min(50, result.patterns.length + 1));
        setRecovery(result.recoveries[0]?.id ?? "");
        setPhase("ready");
      }
    });
  const prepare = () =>
    run("backing-up", async () => {
      const result = await connection.current!.plan(record, slot, settings ? memory : null);
      if (alive.current) {
        setPlan(result);
        setPhase("review");
      }
    });
  // The record is saved as soon as the pedal's files are written and checked, so a failed eject can't lose it (spec 175).
  const send = () =>
    run("writing", async () => {
      await connection.current!.write();
      onSent();
      await connection.current!.close();
      if (alive.current) setPhase("done");
    });
  const restoreBackup = () =>
    run("restoring", async () => {
      await connection.current!.recover(recovery || view!.id);
      await connection.current!.close();
      if (alive.current) {
        setPhase("restored");
        setPlan(undefined);
      }
    });
  const canPlan =
    phase === "ready" &&
    !view?.problem &&
    Number.isInteger(slot) &&
    slot >= 1 &&
    slot <= Math.min(50, (view?.patterns.length ?? 0) + 1) &&
    (!previous || replace) &&
    (!settings || (Number.isInteger(memory) && memory >= 1 && memory <= 99));
  return {
    phase,
    view,
    plan,
    error,
    beta,
    setBeta,
    slot,
    setSlot,
    memory,
    setMemory,
    settings,
    setSettings,
    replace,
    setReplace,
    restore,
    setRestore,
    recovery,
    setRecovery,
    manual,
    setManual,
    waiting,
    busy,
    previous,
    connection,
    run,
    close,
    connect,
    prepare,
    send,
    restoreBackup,
    canPlan,
  };
}
