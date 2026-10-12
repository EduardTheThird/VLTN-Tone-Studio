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
 * GP-200 effect names and knob ranges: Tone Studio ships a list (from GP200 Studio). Importing the user's own copy from
 * the GP-200 editor (algorithm.xml) adds units, Auto CAB Match and exact menu values. Find it automatically (desktop),
 * choose the file, or remove the import to go back to the built-in list.
 */
export function Gp200CatalogPanel() {
  const { loading, counts, source, savedAt, error, loaded } = useGp200Catalog();
  const where = host.platform === "web" ? XML_IN_EDITOR.win32 : XML_IN_EDITOR[host.platform];
  const imported = savedAt !== null;

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
          Tone Studio comes with the GP-200's effect names and knob ranges, taken from GP200 Studio. For units, Auto CAB Match and exact menu values, import
          the {ALGORITHM_XML} from Valeton's GP-200 editor. Tone Studio keeps it on this computer; nothing is uploaded.
        </p>
      </div>

      <div className="flex items-end gap-4 border-b pt-1 pb-4" aria-live="polite">
        <div className="min-w-0">
          {!loaded || loading ? (
            <div className="flex items-center gap-2 text-sm text-silkscreen-2">
              <Spinner aria-hidden />
              Reading the effect list…
            </div>
          ) : (
            <>
              <div className="text-lg leading-tight font-semibold">{counts.uniqueModels} effects ready</div>
              <div className="text-sm text-silkscreen-3">
                {counts.controls} knobs and switches,{" "}
                {imported ? `imported ${new Date(savedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : "built in"}
              </div>
              {source && <div className="mt-0.5 truncate text-xs text-silkscreen-3" title={source}>From {source}</div>}
            </>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {isElectron && (
            <Button variant="secondary" disabled={loading} onClick={act("findAutomatically")}>
              <FileSearch aria-hidden />
              Find automatically
            </Button>
          )}
          <Button variant="secondary" disabled={loading} onClick={act("chooseFile")}>
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

      <dl className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-4 gap-y-1 text-sm">
        {Object.entries(counts.perBlock).map(([code, n]) => (
          <div key={code} className="flex justify-between gap-2">
            <dt className="text-silkscreen-3">{BLOCK_NAMES[code] ?? code}</dt>
            <dd className="font-[550] tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>

      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-pretty text-silkscreen-3">Where the editor keeps it: {where}.</p>
        {imported && (
          <Button variant="ghost" size="sm" disabled={loading} onClick={act("remove")}>
            <Trash2 aria-hidden />
            Use the built-in list
          </Button>
        )}
      </div>
    </section>
  );
}
