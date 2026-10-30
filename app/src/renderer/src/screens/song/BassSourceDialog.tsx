// Choosing a bass tone's capture or cab IR: the TONE3000 browser's own search bar and tone grid, started on a bass preset, or a file on this
// computer. The browser's filters are put back when the dialog closes, so the Tones screen shows what it showed before.
import { useState } from "react";
import type { T3kTone } from "@shared/host/tones";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { host } from "@/host";
import type { BassToneFile } from "@/song/band/arrangement";
import { SearchBar } from "@/screens/tones/SearchBar";
import { ToneGrid } from "@/screens/tones/TonesScreen";
import { loadAccount, loadRecords, useTones, type SearchFilters } from "@/screens/tones/store";

export type BassSourceKind = "nam" | "ir";

/**
 * The search a bass capture or cab IR starts from. TONE3000's metadata has no instrument field, so "bass" in the search and the amp and
 * pedal gears (captures) or the cab gear (IRs) are the closest the API can get. The user can change any of it.
 */
const BASS_PRESET: Record<BassSourceKind, { format: "nam" | "ir"; search: SearchFilters }> = {
  nam: { format: "nam", search: { query: "bass", sort: "trending", gears: ["amp", "amp-cab", "pedal"], architecture: null } },
  ir: { format: "ir", search: { query: "bass", sort: "trending", gears: ["cab"], architecture: null } },
};
const TITLE: Record<BassSourceKind, string> = { nam: "Choose a bass capture", ir: "Choose a cab IR" };
const FILE_BUTTON: Record<BassSourceKind, string> = { nam: "Open a .nam file…", ir: "Open a .wav file…" };
const KIND_NAME: Record<BassSourceKind, string> = { nam: "capture", ir: "cab IR" };

let savedSearch: { format: "all" | "nam" | "ir"; search: SearchFilters } | null = null;

/** Starts the browser on the bass preset, keeping what it had to put back on close. Call before the dialog opens, so its search is the first. */
export function presetBassSearch(kind: BassSourceKind): void {
  const before = useTones.getState();
  savedSearch ??= { format: before.format, search: before.search };
  useTones.setState({ format: BASS_PRESET[kind].format, search: BASS_PRESET[kind].search });
  if (before.account === null) void loadAccount();
}

/** Puts back the browser's filters from before presetBassSearch. */
export function restoreBassSearch(): void {
  if (savedSearch) useTones.setState(savedSearch);
  savedSearch = null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The model a capture uses: A2 first, then A1, as the capture editor opens a tone. An IR has one model. */
function modelFor(kind: BassSourceKind, models: { id: number; architecture_version: string | null }[]) {
  if (kind === "ir") return models[0];
  return models.find((m) => m.architecture_version === "2") ?? models.find((m) => m.architecture_version === "1");
}

export interface BassSourceDialogProps {
  kind: BassSourceKind;
  open: boolean;
  onClose(): void;
  /** The chosen capture or cab IR. The dialog is closed by the caller. */
  onPick(file: BassToneFile): void;
}

export function BassSourceDialog({ kind, open, onClose, onPick }: BassSourceDialogProps) {
  const account = useTones((s) => s.account);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signedIn = account?.status === "signed-in";

  /** Downloads the tone's model into the tone folder, then hands it to the picker. */
  const pickTone = async (toneId: number, tone: T3kTone) => {
    setError(null);
    const wanted = kind === "nam" ? "nam" : "ir";
    if (tone.format !== wanted) {
      setError(`${tone.title} is ${tone.format === "ir" ? "an IR" : "a NAM capture"}, not a bass ${KIND_NAME[kind]}.`);
      return;
    }
    setBusy(`Downloading ${tone.title}…`);
    try {
      const model = modelFor(kind, await host.tones.models(toneId));
      if (!model) throw new Error(`${tone.title} has no model that can be used.`);
      const { record } = await host.tones.downloadModel(toneId, model.id);
      void loadRecords();
      onPick({ source: "tone3000", toneId, modelId: model.id, name: record.title });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const chooseFile = async () => {
    setError(null);
    try {
      const picked = await host.tones.chooseLocalFile(kind);
      if (picked) onPick({ source: "file", path: picked.path, name: picked.name });
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] min-w-0 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{TITLE[kind]}</DialogTitle>
          <DialogDescription>
            Search TONE3000 for one, or open a file from this computer. The choice is used the next time you press Generate.
          </DialogDescription>
        </DialogHeader>
        {signedIn ? (
          <div className="flex h-[50vh] min-h-64 flex-col gap-3 [&>div:last-child]:min-h-0 [&>div:last-child]:flex-1">
            <SearchBar />
            <ToneGrid kind="search" onOpen={(toneId, tone) => void pickTone(toneId, tone)} />
          </div>
        ) : (
          <p className="text-silkscreen-2">Sign in to TONE3000 on the Tones screen to search its {KIND_NAME[kind]}s here.</p>
        )}
        {busy && <p role="status">{busy}</p>}
        {error && (
          <p role="alert" className="text-led-fault">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-seam pt-3">
          <Button variant="outline" onClick={() => void chooseFile()} disabled={busy !== null}>
            {FILE_BUTTON[kind]}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
