import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { host } from "@/host";
import { useRc10rTransfer, type Rc10rTransferProps } from "./use-rc10r-transfer";

/** Explicitly separates shared user rhythms from per-phrase-memory settings. */
export function Rc10rTransferDialog(props: Rc10rTransferProps) {
  const {
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
  } = useRc10rTransfer(props);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-xl"
        onEscapeKeyDown={(event) => {
          if (busy || connection.current?.active) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy || connection.current?.active) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Send to RC-10R — beta</DialogTitle>
          <DialogDescription>Keep every other User rhythm. Back up the whole pedal, review one replacement, then send and disconnect.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-3 overflow-y-auto text-sm">
          <p>
            Pedal and listening checks are pending. Stop the pedal’s rhythm and looper, save any unsaved phrase, and close other editors before connecting. A
            storage session temporarily takes the pedal out of performance mode.
          </p>
          {!view && !connection.current?.active && (
            <label className="flex items-center gap-2">
              <Checkbox checked={beta} onCheckedChange={(checked) => setBeta(checked === true)} disabled={busy} />I understand this is a beta transfer and will
              check the pedal afterward.
            </label>
          )}
          {view?.problem && <p role="alert">{view.problem} Sending is blocked. Restore a matching transfer backup or disconnect and check the pedal.</p>}
          {view && (
            <>
              <p>
                {view.patterns.length} shared User rhythms. Slot names: {view.patterns.map((p) => `${p.slot}: ${p.name}`).join(" · ") || "none"}.
              </p>
              <fieldset disabled={phase !== "ready" || !!view.problem} className="space-y-3">
                <label className="block">
                  User rhythm (1–50)
                  <Input
                    aria-label="Native User rhythm"
                    type="number"
                    min={1}
                    max={Math.min(50, view.patterns.length + 1)}
                    value={Number.isFinite(slot) ? slot : ""}
                    onChange={(e) => {
                      setSlot(e.target.valueAsNumber);
                      setReplace(false);
                    }}
                  />
                </label>
                <p>Choose an existing slot or the next empty slot. Other records keep their exact bytes.</p>
                {previous && (
                  <label className="flex items-center gap-2">
                    <Checkbox checked={replace} onCheckedChange={(checked) => setReplace(checked === true)} />
                    Replace User {slot}: {previous.name}
                  </label>
                )}
                <label className="flex items-center gap-2">
                  <Checkbox checked={settings} onCheckedChange={(checked) => setSettings(checked === true)} />
                  Also set this rhythm’s kit and tempo in one phrase memory
                </label>
                {settings && (
                  <label className="block">
                    Phrase memory (1–99)
                    <Input
                      aria-label="Native phrase memory"
                      type="number"
                      min={1}
                      max={99}
                      value={Number.isFinite(memory) ? memory : ""}
                      onChange={(e) => setMemory(e.target.valueAsNumber)}
                    />
                  </label>
                )}
              </fieldset>
              <p>Sending does not select the rhythm in a phrase memory. Select User {slot} and save the desired phrase memory on the pedal afterward.</p>
            </>
          )}
          {plan && (
            <div className="rounded border border-seam p-3 space-y-2">
              <p>
                {plan.previous ? `Replace User ${plan.slot}: ${plan.previous}` : `Add User ${plan.slot}`} with {plan.name}.
              </p>
              <p>
                {plan.memory === null
                  ? "Phrase-memory settings stay unchanged."
                  : `Set kit and tempo for this User rhythm in phrase memory ${plan.memory}. Other settings stay unchanged.`}
              </p>
              <p className="break-all">Verified full backup: {plan.backupPath}</p>
              <Button variant="outline" onClick={() => void host.app.showItemInFolder(plan.backupPath)}>
                Show backup
              </Button>
            </div>
          )}
          {phase === "backing-up" && (
            <p role="status">
              Backing up and checking the complete ROLAND folder. Large recordings can take several minutes. No pedal files have been written.
            </p>
          )}
          {phase === "writing" && <p role="status">Writing and checking files, then ejecting storage and leaving editor mode. Keep USB connected.</p>}
          {phase === "done" && (
            <p role="status">
              Files checked and storage disconnected. On the pedal, select the User rhythm, save its phrase memory and check all six parts. Confirm the transfer
              after your check.
            </p>
          )}
          {phase === "restored" && (
            <p role="status">The operation’s files were restored from the verified backup and disconnected. Check the pedal before using it.</p>
          )}
          {error && <p role="alert">{error}</p>}
          {connection.current?.active && view && phase !== "done" && (phase === "error" || view.recoveries.length > 0) && (
            <div className="space-y-2 rounded border border-seam p-3">
              {view.recoveries.length > 0 && (
                <label className="block">
                  Recovery backup
                  <Select value={recovery} onValueChange={setRecovery} disabled={busy}>
                    <SelectTrigger aria-label="Recovery backup">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {view.recoveries.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.date} — {item.state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              )}
              {(recovery || plan) && (
                <>
                  <label className="flex items-center gap-2">
                    <Checkbox checked={restore} onCheckedChange={(checked) => setRestore(checked === true)} disabled={busy} />
                    Restore the files this operation changed, discarding their current contents
                  </label>
                  <Button variant="outline" disabled={!restore || busy} onClick={restoreBackup}>
                    Restore from transfer backup
                  </Button>
                </>
              )}
            </div>
          )}
          {phase === "error" && connection.current?.active && (
            <div className="space-y-2">
              <p>If USB is gone, eject the RC-10R drive in Finder and press EXIT on the pedal before releasing the connection.</p>
              <label className="flex items-center gap-2">
                <Checkbox checked={manual} onCheckedChange={(checked) => setManual(checked === true)} />
                USB is disconnected and I pressed EXIT on the pedal
              </label>
              <Button
                variant="outline"
                disabled={!manual}
                onClick={() =>
                  run("closing", async () => {
                    await connection.current!.releaseDisconnected();
                    props.onClose();
                  })
                }
              >
                Release disconnected pedal
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {busy && phase !== "closing" && (
            <Button variant="outline" onClick={() => void connection.current?.cancel().catch(() => {})}>
              Cancel after current file
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={close}>
            {connection.current?.active ? "Disconnect and close" : "Close transfer"}
          </Button>
          {!view && !connection.current?.active && phase !== "done" && (
            <Button disabled={!beta || busy} onClick={connect}>
              Connect RC-10R
            </Button>
          )}
          {phase === "ready" && (
            <Button disabled={!canPlan} onClick={prepare}>
              Back up and review…
            </Button>
          )}
          {phase === "review" && <Button onClick={send}>Send User {plan?.slot}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
