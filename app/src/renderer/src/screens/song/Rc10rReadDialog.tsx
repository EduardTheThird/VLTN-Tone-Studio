import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { host } from "@/host";
import { Rc10rConnection } from "@/song/band/rc10r-connection";
import { friendlyRc10rError, megabytes, useRc10rPedalReading } from "@/song/band/rc10r-pedal-state";
import { sessionLog } from "@/state/session-log";

/** Shown while the pedal drive is mounted but macOS hasn't let the app read it yet (spec 179). */
export const WAITING_HINT_MS = 5000;

type Phase = "idle" | "connecting" | "closing" | "done" | "error";

/**
 * Reads the RC-10R's settings, memories and storage sizes in one storage session and writes nothing (specs 174, 177). The session takes
 * the pedal out of performance mode while it runs, so the same preparation as sending applies.
 */
export function Rc10rReadDialog({ onClose }: { onClose(): void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const connection = useRef<Rc10rConnection | undefined>(undefined);
  const save = useRc10rPedalReading((state) => state.save);
  const saved = useRc10rPedalReading((state) => state.saved);
  const busy = phase === "connecting" || phase === "closing";
  useEffect(() => {
    if (phase !== "connecting") {
      setWaiting(false);
      return;
    }
    const timer = setTimeout(() => setWaiting(true), WAITING_HINT_MS);
    return () => clearTimeout(timer);
  }, [phase]);
  useEffect(
    () => () => {
      const current = connection.current;
      if (current?.active) void current.cancel().catch(() => {}).then(() => current.close().catch(() => {}));
    },
    [],
  );
  const fail = (problem: unknown) => {
    setError(friendlyRc10rError(problem instanceof Error ? problem.message : String(problem)));
    setPhase("error");
  };
  const read = async () => {
    setError("");
    setPhase("connecting");
    try {
      if (!host.rc10r) throw new Error("Reading the RC-10R requires the macOS desktop app.");
      const next = new Rc10rConnection({
        api: host.rc10r,
        access: () => navigator.requestMIDIAccess({ sysex: true }),
        log: (line) => sessionLog("RC10R", line),
      });
      connection.current = next;
      const view = await next.open();
      if (view.reading) save(view.reading);
      setPhase("closing");
      await next.close();
      setPhase(view.reading ? "done" : "error");
      if (!view.reading) setError(view.problem ?? "The pedal was read, but its settings could not be summarised.");
    } catch (problem) {
      fail(problem);
    }
  };
  const disconnect = async () => {
    setPhase("closing");
    try {
      await connection.current?.close();
      onClose();
    } catch (problem) {
      fail(problem);
    }
  };
  const reading = saved?.reading;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !connection.current?.active) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg" onEscapeKeyDown={(e) => busy && e.preventDefault()} onInteractOutside={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Read the RC-10R</DialogTitle>
          <DialogDescription>Reads the pedal's MIDI settings and memories. Nothing is written to the pedal.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {phase === "idle" && (
            <p>
              Connect the RC-10R with USB, stop its rhythm and looper, and save any unsaved phrase. While the app reads, the pedal leaves performance mode
              for a few seconds.
            </p>
          )}
          {phase === "connecting" && <p role="status">Connecting and reading…</p>}
          {waiting && (
            <p role="status">Waiting for macOS. If a prompt asks to allow access to files on a removable volume, choose Allow.</p>
          )}
          {phase === "closing" && <p role="status">Ejecting the pedal's drive and returning it to performance mode…</p>}
          {phase === "done" && reading && (
            <div role="status" className="space-y-1">
              <p>Read. The RC-10R card now checks the pedal's settings against each song.</p>
              <p>
                Pedal storage {megabytes(reading.storageBytes)}, of which loops {megabytes(reading.loopBytes)}. The next send backs up about{" "}
                {megabytes(reading.backupCopyBytes)}.
              </p>
              {reading.systemProblem && <p role="alert">Settings: {reading.systemProblem}</p>}
              {reading.memoryProblem && <p role="alert">Memories: {reading.memoryProblem}</p>}
            </div>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          {phase === "error" && connection.current?.active ? (
            <Button variant="outline" onClick={() => void disconnect()}>
              Disconnect and close
            </Button>
          ) : (
            <Button variant="outline" disabled={busy} onClick={onClose}>
              Close
            </Button>
          )}
          {(phase === "idle" || (phase === "error" && !connection.current?.active)) && <Button onClick={() => void read()}>Read the RC-10R</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
