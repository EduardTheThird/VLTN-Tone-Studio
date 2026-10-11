import { useEffect } from "react";
import { FileSearch, FolderOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { host, isElectron } from "@/host";
import { useGp200Catalog } from "@/gp200/app/catalog-store";
import { ALGORITHM_XML, XML_IN_EDITOR } from "@shared/host/gp200-catalog";

const BLOCK_NAMES: Readonly<Record<string, string>> = {
  PRE: "pre effects",
  WAH: "wahs",
  DST: "drives",
  AMP: "amps",
  NR: "noise gates",
  CAB: "cabinets",
  EQ: "EQs",
  MOD: "modulations",
  DLY: "delays",
  RVB: "reverbs",
  VOL: "volume pedals",
};

/**
 * GP-200 effect names and knob ranges: Tone Studio may not ship Valeton's list, so it reads the user's own copy from
 * the GP-200 editor (algorithm.xml). Find it automatically (desktop), choose the file, or remove the imported list.
 */
export function Gp200CatalogPanel() {
  const { status, counts, source, savedAt, error, loaded } = useGp200Catalog();
  const busy = status === "loading";
  const where = host.platform === "web" ? XML_IN_EDITOR.win32 : XML_IN_EDITOR[host.platform];

  useEffect(() => {
    if (!useGp200Catalog.getState().loaded) void useGp200Catalog.getState().load();
  }, []);

  // Failures land in `error`, which this panel shows; the rejected promise only repeats them.
  const act = (action: "findAutomatically" | "chooseFile" | "remove") => () => void useGp200Catalog.getState()[action]().catch(() => {});

  return (
    <section aria-labelledby="g2c-title" className="flex min-w-0 flex-col gap-4 rounded-lg bg-card px-5 pt-4 pb-5 shadow-[0_0_0_1px_var(--seam)]">
      <div>
        <h2 id="g2c-title" className="text-[15px] font-[650] text-balance">
          GP-200 effect list
        </h2>
        <p className="mt-0.5 text-sm text-pretty text-silkscreen-3">
          Effect names and knob ranges for the GP-200 come from Valeton's own GP-200 editor, which Tone Studio is not allowed to ship. Tone Studio reads the
          editor's {ALGORITHM_XML} once and keeps the list on this computer. Nothing is uploaded.
        </p>
      </div>

      <div className="flex items-end gap-4 border-b pt-1 pb-4" aria-live="polite">
        <div className="min-w-0">
          {!loaded || (busy && !counts) ? (
            <div className="flex items-center gap-2 text-sm text-silkscreen-2">
              <Spinner aria-hidden />
              Reading the effect list…
            </div>
          ) : counts && savedAt ? (
            <>
              <div className="text-lg leading-tight font-semibold">{counts.uniqueModels} effects ready</div>
              <div className="text-sm text-silkscreen-3">
                {counts.controls} knobs and switches, imported{" "}
                {new Date(savedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
              </div>
              {source && <div className="mt-0.5 truncate text-xs text-silkscreen-3" title={source}>From {source}</div>}
            </>
          ) : (
            <>
              <div className="text-lg leading-tight font-semibold">No effect list yet</div>
              <div className="text-sm text-pretty text-silkscreen-3">Without it, GP-200 effects show as numbers and their knobs can't be edited.</div>
            </>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {isElectron && (
            <Button variant={counts ? "secondary" : "default"} disabled={busy} onClick={act("findAutomatically")}>
              <FileSearch aria-hidden />
              Find automatically
            </Button>
          )}
          <Button variant={counts || isElectron ? "secondary" : "default"} disabled={busy} onClick={act("chooseFile")}>
            <FolderOpen aria-hidden />
            Choose file…
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-pretty text-destructive">
          {error}
        </p>
      )}

      {counts && (
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-4 gap-y-1 text-sm">
          {Object.entries(counts.perBlock).map(([code, n]) => (
            <div key={code} className="flex justify-between gap-2">
              <dt className="text-silkscreen-3">{BLOCK_NAMES[code] ?? code}</dt>
              <dd className="font-[550] tabular-nums">{n}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-pretty text-silkscreen-3">Where the editor keeps it: {where}.</p>
        {counts && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={act("remove")}>
            <Trash2 aria-hidden />
            Remove
          </Button>
        )}
      </div>
    </section>
  );
}
