import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { PcmAudio } from "@/song/types";
import { cancelLyrics, generateLyrics, useLyricsJobs } from "@/song/performance/lyrics-jobs";
import { chartSourceOf, lrcTexts, markLyricsEdited, previousChartOf, restoreLyricsChart } from "@/song/performance/lyrics-chart";
import { hasSignal } from "@/song/performance/sources";
import {
  loadLyricsChoice,
  loadLyricsOnAnalysis,
  LYRIC_LANGUAGES,
  lyricsOptions,
  saveLyricsChoice,
  saveLyricsOnAnalysis,
  type LyricsChoice,
  type LyricsLanguage,
} from "@/song/performance/lyrics-options";
import { getSetting, readOptions, setSetting } from "@/song/performance/settings";
import { host } from "@/host";
import { useActiveIndex } from "@/song/performance/playback-clock";
import { LyricsModelPicker } from "./LyricsModelPicker";

/** What the chart's source means to the performer, shown under its title. */
const SOURCE_NOTE = {
  transcribed: "Made by the transcriber from the vocals. Edit it and it becomes yours.",
  aligned: "Your words, timed by the transcriber. Edit it and it becomes yours.",
  user: "Yours: typed, imported or edited by hand. Only you change it.",
  unknown: "Made before version 0.9.2, when Tone Studio did not record where it came from. Kept unless you replace it.",
} as const;

export function LyricsTrack({
  audio,
  storageKey,
  onTextChange,
  follow = true,
}: {
  audio?: PcmAudio;
  storageKey: string;
  onTextChange?: (text: string) => void;
  follow?: boolean;
}) {
  const [language, setLanguage] = useState(() => lyricsOptions(storageKey).language);
  const [text, setText] = useState(() => getSetting(storageKey, ":lyrics"));
  const job = useLyricsJobs((s) => s.jobs[storageKey]);
  const status = job?.status ?? "";
  const busy = job?.busy ?? false;
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pasted, setPasted] = useState("");
  const [choice, setChoice] = useState<LyricsChoice>(loadLyricsChoice);
  const [onAnalysis, setOnAnalysis] = useState(loadLyricsOnAnalysis);
  const activeLine = useRef<HTMLParagraphElement>(null);
  const available = useMemo(() => hasSignal(audio), [audio]);
  // Read on each render: the source and the replaced chart change when a job saves or the performer restores.
  const options = readOptions<Record<string, unknown>>(storageKey, {});
  const source = chartSourceOf(options);
  const previous = previousChartOf(options);
  const lines = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .flatMap((line) => {
          const match = /^\[(\d+):([0-5]\d(?:\.\d+)?)\]\s*(.*)$/.exec(line);
          return match ? [{ time: Number(match[1]) * 60 + Number(match[2]), text: match[3] }] : [];
        })
        .sort((a, b) => a.time - b.time),
    [text],
  );
  const active = useActiveIndex(useMemo(() => lines.map((line) => line.time), [lines]));
  useEffect(() => {
    if (follow) activeLine.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, follow]);
  useEffect(() => {
    onTextChange?.(text);
  }, [text, onTextChange]);
  const save = (value: string) => {
    setText(value);
    if (job) useLyricsJobs.setState((s) => ({ jobs: { ...s.jobs, [storageKey]: { ...s.jobs[storageKey], text: value } } }));
    try {
      setSetting(storageKey, ":lyrics", value);
      markLyricsEdited(storageKey);
    } catch {
      setError("Could not save lyrics locally. Export them to keep a copy.");
    }
  };
  useEffect(() => {
    try {
      setText(getSetting(storageKey, ":lyrics"));
    } catch {
      setText("");
    }
    setError("");
    setLanguage(lyricsOptions(storageKey).language);
  }, [storageKey]);
  useEffect(() => {
    if (job?.text !== undefined) setText(job.text);
  }, [job?.text]);
  useEffect(() => {
    // With the analysis option on, an empty chart is filled by the analysis, not here.
    if (audio && available && !text && !job && !loadLyricsOnAnalysis()) void generateLyrics(storageKey, audio);
  }, [audio, available, text, job, storageKey]);
  const transcribe = (pastedText?: string) => {
    if (audio && available) {
      setError("");
      void generateLyrics(storageKey, audio, { ...choice, language }, pastedText);
    }
  };
  return (
    <section aria-label="Lyrics text track" className="space-y-3 rounded border border-seam p-4">
      <h3 className="font-semibold">Lyrics text track · from vocals</h3>
      <p className="text-sm text-silkscreen-3">
        Empty lyrics are generated from the vocals stem when you open Performance. You can switch tabs while transcription runs. Transcription runs on this
        computer after a one-time model download; singing can be misheard. Your chart and MIDI cues are kept separately.
      </p>
      {!!text && <p className="text-sm text-silkscreen-3">{SOURCE_NOTE[source]}</p>}
      {confirming && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Replace these lyrics? You can restore them afterwards.</span>
          <Button
            onClick={() => {
              setConfirming(false);
              transcribe();
            }}
          >
            Replace lyrics
          </Button>
          <Button variant="outline" onClick={() => setConfirming(false)}>
            Keep them
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label>
          Lyrics language{" "}
          <select
            aria-label="Lyrics language"
            className="ml-2 rounded border border-seam bg-background p-2"
            disabled={busy}
            value={language}
            onChange={(e) => {
              const next = e.target.value as LyricsLanguage;
              setLanguage(next);
              try {
                setSetting(storageKey, ":options", JSON.stringify({ ...readOptions(storageKey, {}), lyricsLanguage: next }));
              } catch {
                setError("Could not save language preference.");
              }
            }}
          >
            {LYRIC_LANGUAGES.map((value) => (
              <option key={value} value={value}>
                {value === "auto" ? "Detect automatically" : value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={!available || busy}
          onClick={() => {
            // Lyrics from before 0.9.2 do not say who wrote them, so the performer confirms before they are replaced.
            if (text && source === "unknown") setConfirming(true);
            else transcribe();
          }}
        >
          {text ? "Transcribe again" : "Generate lyrics from vocals"}
        </Button>
        {text && source === "aligned" && (
          <Button variant="outline" disabled={!available || busy} onClick={() => transcribe(lrcTexts(text).join("\n"))}>
            Time my lyrics again
          </Button>
        )}
        {previous && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (restoreLyricsChart(storageKey)) setText(getSetting(storageKey, ":lyrics"));
            }}
          >
            Restore the previous lyrics
          </Button>
        )}
        {busy && (
          <Button variant="outline" onClick={() => cancelLyrics(storageKey)}>
            Cancel transcription
          </Button>
        )}
        <Button
          variant="outline"
          disabled={!text}
          onClick={() =>
            void host.song
              .saveFiles([{ name: "lyrics.lrc", bytes: new TextEncoder().encode(text) }], "Export lyrics text track")
              .catch((e) => setError(String(e)))
          }
        >
          Export lyrics
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={onAnalysis}
          disabled={busy}
          onCheckedChange={(value) => {
            const next = value === true;
            setOnAnalysis(next);
            saveLyricsOnAnalysis(next);
          }}
        />
        <span>Transcribe lyrics when analysing (for songs with no lyrics)</span>
      </label>
      <LyricsModelPicker
        choice={choice}
        disabled={busy}
        onChange={(next) => {
          setChoice(next);
          saveLyricsChoice(next);
        }}
      />
      <details>
        <summary>Paste lyrics and time them</summary>
        <p className="text-sm text-silkscreen-3">
          One line per lyric line; a blank line starts a new section. Your words are kept exactly as typed. Only the timing comes from the vocals.
        </p>
        <textarea
          aria-label="Pasted lyrics"
          className="min-h-32 w-full rounded border border-seam bg-transparent p-2"
          disabled={busy}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <Button disabled={!available || busy || !pasted.trim()} onClick={() => transcribe(pasted)}>
          Time pasted lyrics
        </Button>
      </details>
      {!available && <p>Split the song to get a vocals stem with audio before generating lyrics.</p>}
      <p role="status">{status || (!text ? "No lyrics yet. Generate them from vocals, or import a lyric chart below." : "")}</p>
      {(error || job?.error) && (
        <p role="alert" className="text-red-400">
          {error || job?.error}
        </p>
      )}
      {!!text && (
        <>
          <div aria-label="Transcribed lyrics" className="max-h-64 overflow-auto text-2xl leading-relaxed">
            {lines.length ? (
              lines.map((line, i) => (
                <p key={i} ref={i === active ? activeLine : undefined} className={i === active ? "rounded bg-white/10 font-bold" : "text-silkscreen-3"}>
                  {line.text}
                </p>
              ))
            ) : (
              <p className="whitespace-pre-wrap">{text}</p>
            )}
          </div>
          <details>
            <summary>Edit transcribed words and timestamps</summary>
            <textarea
              aria-label="Lyrics text track editor"
              className="min-h-48 w-full rounded border border-seam bg-transparent p-2 font-mono"
              disabled={busy}
              value={text}
              onChange={(e) => save(e.target.value)}
            />
          </details>
        </>
      )}
    </section>
  );
}
