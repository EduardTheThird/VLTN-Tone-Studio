// The lyrics part of the Analyse songs dialog: the model and quality (the same pickers as the lyrics panel), which songs' lyrics to replace,
// whether the performer's own lines are timed again, and what the run will roughly take and download.

import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { saveLyricsChoice, type LyricsChoice } from "@/song/performance/lyrics-options";
import { downloadMegabytes, findLyricsModel, lyricsMinutes } from "@/song/performance/lyrics-models";
import type { LyricsWhich } from "@/song/analysis/batch";
import { LyricsModelPicker, useWebGpu } from "./LyricsModelPicker";

/** The song length the estimate assumes. The dialog does not read each song's length. */
const ASSUMED_SONG_MINUTES = 4;

const WHICH_LABELS: { id: LyricsWhich; label: string }[] = [
  { id: "empty", label: "Songs with no lyrics" },
  { id: "transcribed", label: "Songs with transcribed lyrics (transcribe again)" },
  { id: "older", label: "Songs whose lyrics were made with another model" },
];

export function LyricsBatchSettings({
  choice,
  onChoice,
  which,
  onWhich,
  retime,
  onRetime,
  disabled,
  songs,
}: {
  choice: LyricsChoice;
  onChoice(next: LyricsChoice): void;
  which: LyricsWhich;
  onWhich(next: LyricsWhich): void;
  retime: boolean;
  onRetime(next: boolean): void;
  disabled: boolean;
  /** How many songs the lyrics step will run for. */
  songs: number;
}) {
  const webgpu = useWebGpu();
  const model = findLyricsModel(choice.model);
  const minutes = Math.round(lyricsMinutes(choice.model, choice.quality, ASSUMED_SONG_MINUTES) * songs);
  return (
    <div className="space-y-3 rounded-lg border border-seam p-3 text-sm">
      <LyricsModelPicker
        choice={choice}
        disabled={disabled}
        onChange={(next) => {
          onChoice(next);
          saveLyricsChoice(next);
        }}
      />
      <RadioGroup aria-label="Which lyrics to replace" value={which} onValueChange={(v) => onWhich(v as LyricsWhich)} disabled={disabled} className="gap-1">
        {WHICH_LABELS.map((item) => (
          <label key={item.id} className="flex items-center gap-2">
            <RadioGroupItem value={item.id} />
            <span>{item.label}</span>
          </label>
        ))}
      </RadioGroup>
      <label className="flex items-center gap-2">
        <Checkbox checked={retime} disabled={disabled} onCheckedChange={(value) => onRetime(value === true)} />
        <span>Time my pasted lyrics again (their text is kept)</span>
      </label>
      <p className="text-[12px] text-silkscreen-3">
        Your own charts are never replaced. About {minutes > 0 ? `${minutes} min` : "under a minute"} for {songs} song{songs === 1 ? "" : "s"} of about{" "}
        {ASSUMED_SONG_MINUTES} minutes each. A rough guess until measured on this computer.
      </p>
      {model && (
        <p className="text-[12px] text-silkscreen-3">
          Downloads about {downloadMegabytes(model, webgpu)} MB once, the first time this model is used on this computer.
        </p>
      )}
    </div>
  );
}
