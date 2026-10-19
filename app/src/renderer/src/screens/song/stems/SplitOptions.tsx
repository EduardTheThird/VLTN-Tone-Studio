import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { notifyError, notifySuccess } from "@/app/notify";
import { host } from "@/host";
import { cn } from "@/lib/utils";
import { useSong } from "@/song/store";
import { findQuality, relativeTime, SPLIT_QUALITIES, type QualityId } from "@/song/stems/options";
import { missingBytes, modelBytes, modelFiles, SEPARATION_MODELS, type SeparationModel, type SeparationModelId } from "@shared/host/song";

/** Megabytes, as download sizes are shown. */
export const megabytes = (bytes: number) => Math.round(bytes / 1e6);

/** Model files downloaded already (null while asking the host); `refresh` asks again. */
export function useDownloadedFiles(): { downloaded: ReadonlySet<string> | null; refresh: () => void } {
  const status = useSong((s) => s.status.kind);
  const [downloaded, setDownloaded] = useState<ReadonlySet<string> | null>(null);
  const [asked, setAsked] = useState(0);
  // A finished, failed or cancelled split may have downloaded files.
  useEffect(() => {
    let live = true;
    host.song.downloadedFiles().then(
      (files) => live && setDownloaded(new Set(files)),
      () => live && setDownloaded(new Set()),
    );
    return () => {
      live = false;
    };
  }, [status, asked]);
  return { downloaded, refresh: () => setAsked((n) => n + 1) };
}

function downloadLabel(model: SeparationModel, downloaded: ReadonlySet<string> | null): string {
  const total = megabytes(modelBytes(model));
  if (!downloaded) return `${total} MB`;
  const missing = megabytes(missingBytes(model, downloaded));
  if (missing === 0) return `${total} MB, downloaded`;
  return missing === total ? `${total} MB to download` : `${missing} of ${total} MB still to download`;
}

/** Model picker (size, stems, downloaded or not, delete) and quality picker for the next split. */
export function SplitOptions({ className }: { className?: string }) {
  const choice = useSong((s) => s.choice);
  const busy = useSong((s) => s.status.kind === "decoding" || s.status.kind === "model" || s.status.kind === "splitting");
  const { downloaded, refresh } = useDownloadedFiles();
  const quality = findQuality(choice.quality) ?? SPLIT_QUALITIES[0];
  const factor = relativeTime(quality);

  async function remove(model: SeparationModel) {
    try {
      const freed = modelFiles(model).filter((f) => downloaded?.has(f.file)).reduce((sum, f) => sum + f.bytes, 0);
      await host.song.deleteModel(model.id);
      notifySuccess(`${model.label} model deleted`, `${megabytes(freed)} MB freed. The next split with it downloads it again.`);
    } catch (e) {
      notifyError("Couldn't delete the model", e);
    } finally {
      refresh();
    }
  }

  return (
    <div className={cn("flex flex-col gap-3 text-left", className)}>
      <RadioGroup
        aria-label="Separation model"
        value={choice.model}
        onValueChange={(v) => useSong.getState().setChoice({ model: v as SeparationModelId })}
        disabled={busy}
        className="gap-0 rounded-lg border border-seam"
      >
        {SEPARATION_MODELS.map((m) => {
          const id = `split-model-${m.id}`;
          const stored = downloaded !== null && missingBytes(m, downloaded) < modelBytes(m);
          return (
            <div key={m.id} className={cn("flex items-start gap-3 px-3 py-2.5 [&+&]:border-t [&+&]:border-seam", choice.model === m.id && "bg-faceplate")}>
              <RadioGroupItem id={id} value={m.id} className="mt-0.5" />
              <label htmlFor={id} className="flex min-w-0 grow cursor-pointer flex-col gap-0.5">
                <span className="flex items-baseline gap-2 text-[13px] font-semibold text-silkscreen">
                  {m.label}
                  <span className="text-[12px] font-normal text-silkscreen-3">{m.stems.length} stems</span>
                </span>
                <span className="text-[12px] text-pretty text-silkscreen-3">{m.description}</span>
                <span className="text-[11px] text-silkscreen-2 tabular-nums">{downloadLabel(m, downloaded)}</span>
              </label>
              {stored && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete the ${m.label} model's files`} disabled={busy} onClick={() => void remove(m)}>
                      <Trash2 />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">Delete its downloaded files to free disk space. Files it shares with another model go too.</TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        })}
      </RadioGroup>
      <div className="flex flex-wrap items-center gap-3">
        <span id="split-quality" className="text-[12px] font-semibold text-silkscreen-2">
          Quality
        </span>
        <ToggleGroup
          type="single"
          value={choice.quality}
          onValueChange={(v) => v && useSong.getState().setChoice({ quality: v as QualityId })}
          aria-labelledby="split-quality"
          disabled={busy}
          className="gap-1"
        >
          {SPLIT_QUALITIES.map((q) => (
            <ToggleGroupItem key={q.id} value={q.id}>
              {q.label}
              {relativeTime(q) > 1 && <span className="text-silkscreen-3 tabular-nums">×{relativeTime(q)}</span>}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <p className="text-[12px] text-pretty text-silkscreen-3">
        {quality.description} {factor > 1 ? `Takes about ${factor}× as long as Fast.` : "The quickest split."}
      </p>
    </div>
  );
}
