import { useEffect, useRef, useState } from "react";
import { snapToneLabel } from "@shared/devices";
import type { NamCheck } from "@shared/host/tones";
import { prepareNam } from "@shared/nam";
import { firstEmptySlot, isEmptySlot, proposeSlotName, sanitizeSlotName } from "@shared/tone3000";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { host } from "@/host";
import { notifySuccess } from "@/app/notify";
import { convertToSnapTone } from "@/snaptone/convert";
import { useTestSignal } from "@/snaptone/signal";
import { useDevice, usePedalName } from "@/state/device";
import { DEFAULT_DEVICE, pedalName, writesLocked } from "@/state/device-model";
import type { OpenFile } from "@/state/ui";
import { CabIrPicker, noCabIrReason } from "./CabIrPicker";
import { SnapToneSlotPicker, TestSignalNotice } from "./SnapToneSteps";
import { readSlots, type CabIrChoice } from "./store";

/** Picked .nam files are read whole; real captures are a few hundred KB (the capture editor's limit). */
const MAX_NAM_FILE = 64 * 1024 * 1024;

/** A checked capture: the converter's input, what it is, and what its own metadata says. */
interface LocalNam {
  json: string;
  check: NamCheck;
  title: string;
  gearType: string | null;
}

async function readNam(file: OpenFile): Promise<string> {
  if (file.file) {
    if (file.file.size > MAX_NAM_FILE) throw new Error(`${file.name} is too large to be a NAM capture.`);
    return file.file.text();
  }
  if (file.path) return host.tones.readLocalNam(file.path);
  throw new Error(`Couldn't read ${file.name}.`);
}

/** A string field of the capture's `metadata` object, or null. */
function metaString(model: unknown, key: "name" | "gear_type"): string | null {
  if (!model || typeof model !== "object" || !("metadata" in model)) return null;
  const meta = model.metadata;
  if (!meta || typeof meta !== "object" || !(key in meta)) return null;
  const value: unknown = Reflect.get(meta, key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Check the capture (A1 is reshaped to the 0.5.x layout, A2 kept) and read its name and gear type. */
function examine(fileName: string, text: string): LocalNam {
  const { json, check } = prepareNam(text);
  const model: unknown = JSON.parse(text);
  return { json, check, title: metaString(model, "name") ?? fileName.replace(/\.nam$/i, ""), gearType: metaString(model, "gear_type") };
}

/** "NAM A2, standard size, file version 0.7.0" */
const describe = (c: NamCheck) => `NAM ${c.arch}, ${c.size} size, file version ${c.version}`;

type Phase = "idle" | "converting" | "writing";

/**
 * A .nam from disk (picked in Tones, or opened or dropped while Tones is showing): Tone Studio makes a SnapTone from it
 * and writes the user slot the user picks. Not a TONE3000 tone, so nothing is linked. The Write button is the
 * confirmation; an occupied slot says what it replaces.
 */
export function LocalNamDialog({ file, onClose }: { file: OpenFile | null; onClose: () => void }) {
  const [nam, setNam] = useState<LocalNam | null>(null);
  const [name, setName] = useState("");
  const [slot, setSlot] = useState<number | null>(null);
  const [cabIr, setCabIr] = useState<CabIrChoice | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const connected = useDevice((s) => s.status === "connected");
  const snapTones = useDevice((s) => s.snapTones);
  const device = useDevice((s) => s.device);
  const busy = useDevice((s) => s.busy);
  const locked = useDevice((s) => writesLocked(s.device, s.mode));
  const hasSignal = useTestSignal((s) => s.has);
  const pedal = usePedalName();

  useEffect(() => {
    if (!file) return;
    let current = true;
    setNam(null);
    setName("");
    setSlot(null);
    setCabIr(null);
    setError(null);
    setProgress(0);
    readNam(file)
      .then((text) => {
        if (!current) return;
        const checked = examine(file.name, text);
        setNam(checked);
        setName(proposeSlotName(checked.title));
      })
      .catch((e) => current && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      current = false;
    };
  }, [file]);

  // The slot list comes from the pedal; propose the first empty user slot once it is known.
  useEffect(() => {
    if (file && connected && !snapTones && !busy) void readSlots();
  }, [file, connected, snapTones, busy]);
  useEffect(() => {
    if (file && slot === null && snapTones) setSlot(firstEmptySlot("snaptone", snapTones, device));
  }, [file, slot, snapTones, device]);
  useEffect(() => () => abort.current?.abort(), []);

  const noCabIr = noCabIrReason(device, nam?.gearType);
  const occupant = slot === null ? null : snapTones?.find((s) => s.slot === slot);
  const replacing = occupant && !isEmptySlot(occupant) ? occupant.name : null;
  const slotText = slot === null ? "a SnapTone slot" : snapToneLabel(device ?? DEFAULT_DEVICE, slot);
  const working = phase !== "idle";

  let blocker: string | null = null;
  if (!connected) blocker = `Connect the ${pedal} to write it.`;
  else if (locked) blocker = `Tone Studio doesn't write to the ${pedal}'s memory yet: it hasn't been tested on one.`;
  else if (busy) blocker = `Wait until the pedal is free (${busy.label.toLowerCase()}).`;
  else if (!snapTones) blocker = "Reading the pedal's SnapTone slots…";
  else if (slot === null) blocker = "Choose a slot.";

  const close = () => {
    if (phase === "writing") return;
    abort.current?.abort();
    onClose();
  };

  const write = async () => {
    if (!file || !nam || slot === null) return;
    abort.current = new AbortController();
    const signal = abort.current.signal;
    setError(null);
    setProgress(0);
    setPhase("converting");
    try {
      const wav = noCabIr === null && cabIr ? (cabIr.kind === "file" ? cabIr.wav : await host.tones.readIr(cabIr.toneId)) : undefined;
      const snapTone = await convertToSnapTone(nam.json, setProgress, signal, wav);
      setPhase("writing");
      setProgress(0);
      const stored = await useDevice.getState().uploadSnapTone(slot, name, snapTone, { onProgress: setProgress });
      notifySuccess(`Wrote ${snapToneLabel(useDevice.getState().device ?? DEFAULT_DEVICE, slot)} on your ${pedalName(useDevice.getState().device)}`, `${file.name} is in the slot as ${stored}.`);
      onClose();
    } catch (e) {
      if (!signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("idle");
    }
  };

  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Write {file?.name} to a SnapTone slot</DialogTitle>
          <DialogDescription>
            Tone Studio turns the capture into a SnapTone (about 10 seconds) and writes it over USB. Nothing changes on the pedal until you press Write.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-[12px]">
          {nam ? <p className="text-pretty text-silkscreen-3">{describe(nam.check)}.</p> : !error && <Spinner aria-label="Checking the file" />}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-silkscreen-2">
              Name on the pedal
              <Input value={name} maxLength={10} disabled={working || !nam} onChange={(e) => setName(sanitizeSlotName(e.target.value.toUpperCase()))} className="h-8 w-36" />
            </label>
            <span className="text-[11px] text-silkscreen-3">{name.length}/10</span>
            <SnapToneSlotPicker value={slot} onChange={setSlot} disabled={working} />
          </div>
          {nam && (noCabIr === null ? <CabIrPicker value={cabIr} onChange={setCabIr} disabled={working} /> : <p className="text-pretty text-silkscreen-3">{noCabIr}</p>)}
          {replacing && !working && <p className="text-pretty text-silkscreen-2">Replaces {replacing}. A SnapTone can't be read back from the pedal.</p>}
          {working && <Progress value={progress * 100} className="w-56" aria-label={phase === "converting" ? "SnapTone conversion progress" : "SnapTone write progress"} />}
          {working && <p className="text-silkscreen-3">{phase === "converting" ? "Making the SnapTone…" : `Writing ${slotText}…`}</p>}
          <TestSignalNotice />
          {error && (
            <p role="alert" className="text-pretty text-led-fault">
              {error}
            </p>
          )}
          {blocker && !working && <p className="text-[11px] text-silkscreen-3">{blocker}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={phase === "writing"} onClick={close}>
            Cancel
          </Button>
          <Button disabled={!nam || !name || working || blocker !== null || hasSignal === false} onClick={() => void write()}>
            {working && <Spinner data-icon="inline-start" />}
            {replacing ? `Replace ${replacing} in ${slotText}` : `Write to ${slotText}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
