import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { host } from "@/host";
import { lrcTime, transpose, type Cue } from "@/song/performance/chart";
import type { Chord } from "@/song/performance/chords";
import { useActiveIndex } from "@/song/performance/playback-clock";
import { CAPO_MAX, keySpelling } from "@/song/performance/speed";
import { useSession, type PerformanceSession } from "@/song/performance/session";
import { STEM_NAMES, type StemName, type Stems } from "@/song/types";
import { LyricsTrack } from "./LyricsTrack";

// The chart editor is loaded when this panel first renders it, so the CodeMirror code is kept out of the main bundle.
const ChartCodeEditor = lazy(() => import("./ChartCodeEditor"));

const field = "rounded border border-seam bg-transparent p-2";

/** Small safe formatting subset; imported charts never become HTML. */
function chartLine(text: string, onChord: (name: string) => void) {
  return text
    .replace(/\[N\]/g, "—")
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[A-G][^\]]*\])/g)
    .map((part, i) =>
      part.startsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("*") ? (
        <em key={i}>{part.slice(1, -1)}</em>
      ) : /^\[[A-G]/.test(part) ? (
        <button
          key={i}
          type="button"
          aria-label={`Show ${part.slice(1, -1)} guitar voicings`}
          className="mr-1 cursor-pointer rounded font-bold text-sky-400 hover:bg-sky-400/15"
          onClick={() => onChord(part.slice(1, -1))}
        >
          {part.slice(1, -1)}
        </button>
      ) : (
        part
      ),
    );
}
/** The plain lyrics preview. It owns the active-line subscription so the panel does not re-render on line changes. */
function ChartLines({ cues, shift, flats, onChord }: { cues: Cue[]; shift: number; flats?: boolean; onChord: (name: string) => void }) {
  const active = useActiveIndex(useMemo(() => cues.map((cue) => cue.time), [cues]));
  return cues.map((cue, i) => (
    <p key={i} className={i === active ? "rounded bg-white/10 font-bold" : "text-silkscreen-3"}>
      {chartLine(transpose(cue.text, shift, flats) || "♪", onChord)}
    </p>
  ));
}

/** Estimates chords from a stem in a worker. Errors go to the session. */
export function useChordAnalysis(session: PerformanceSession, stems: Stems | null, chordSource: StemName | "") {
  const [chords, setChords] = useState<Chord[]>([]),
    [analysing, setAnalysing] = useState(false);
  useEffect(() => {
    setChords([]);
    setAnalysing(false);
    const audio = chordSource ? stems?.[chordSource] : undefined;
    if (!audio) return;
    const worker = new Worker(new URL("../../song/performance/chords-worker.ts", import.meta.url), { type: "module" });
    setAnalysing(true);
    setChords([]);
    worker.onmessage = (e) => {
      setAnalysing(false);
      if (e.data.error) session.fail(e.data.error);
      else setChords(e.data.chords);
      worker.terminate();
    };
    worker.onerror = (e) => {
      setAnalysing(false);
      session.fail(e.message);
      worker.terminate();
    };
    worker.postMessage(audio);
    return () => worker.terminate();
  }, [session, stems, chordSource]);
  return { chords, analysing };
}

/** Transpose, chart import and export, the separate lyrics and chart editors, and chord estimates. */
export function PerformanceAnalysis({
  session,
  stems,
  storageKey,
  chart,
  onSaveChart,
  shift,
  onShift,
  songKey,
  capo,
  onCapo,
  onLyrics,
  chords,
  analysing,
  chordChoice,
  onChordChoice,
  automaticSource,
  chordSource,
  onSelectChord,
}: {
  session: PerformanceSession;
  stems: Stems | null;
  storageKey: string;
  chart: string;
  onSaveChart: (chart: string) => void;
  shift: number;
  onShift: (value: number) => void;
  /** The song's key, which the chord names are spelled by */
  songKey?: string;
  capo: number;
  onCapo: (value: number) => void;
  onLyrics: (text: string) => void;
  chords: Chord[];
  analysing: boolean;
  chordChoice: StemName | "";
  onChordChoice: (value: StemName | "") => void;
  automaticSource: StemName | "";
  chordSource: StemName | "";
  onSelectChord: (name: string) => void;
}) {
  // Lyric lines are the chart's own cues: the triggers and the MIDI file's messages have no lyrics to show.
  const sessionCues = useSession(session, (s) => s.cues);
  const cues = useMemo(() => sessionCues.filter((cue) => !cue.trigger && !cue.fromFile), [sessionCues]);
  const flats = keySpelling(songKey, shift);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">Lyrics & chords</h2>
        <label>
          Transpose{" "}
          <input
            aria-label="Transpose semitones"
            className={field + " w-20"}
            type="number"
            min="-12"
            max="12"
            value={shift}
            onChange={(e) => onShift(Math.max(-12, Math.min(12, Number(e.target.value) || 0)))}
          />
        </label>
        <label>
          Capo{" "}
          <input
            aria-label="Capo fret"
            className={field + " w-16"}
            type="number"
            min="0"
            max={CAPO_MAX}
            value={capo}
            onChange={(e) => onCapo(Number(e.target.value) || 0)}
          />
        </label>
        <label className="cursor-pointer underline">
          Import TXT / LRC / ChordPro
          <input
            type="file"
            accept=".txt,.lrc,.cho,.chordpro"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void f.text().then(onSaveChart).catch(session.fail);
              e.target.value = "";
            }}
          />
        </label>
        <Button
          variant="outline"
          onClick={() =>
            void host.song.saveFiles([{ name: "performance.lrc", bytes: new TextEncoder().encode(chart) }], "Export lyrics and MIDI cues").catch(session.fail)
          }
        >
          Export chart
        </Button>
      </div>
      <details>
        <summary className="cursor-pointer font-semibold">Separate lyrics and chart editors</summary>
        <LyricsTrack audio={stems?.vocals} storageKey={storageKey} onTextChange={onLyrics} follow={false} />
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <Suspense
              fallback={
                <textarea aria-label="Lyrics and MIDI chart" className={field + " min-h-64 w-full font-mono text-sm"} value={chart} readOnly />
              }
            >
              <ChartCodeEditor
                label="Lyrics and MIDI chart"
                value={chart}
                onChange={onSaveChart}
                hint={"[00:00.00] [C]Verse\n[00:10.00] [Am]Your lyrics {midi:pc 1 0}\n[00:20.00] [F]Chorus {midi:cc 1 64 127}"}
              />
            </Suspense>
            <p className="text-sm text-silkscreen-3">
              Saved locally for this audio filename and length. LRC timestamps enable scrolling and MIDI. Chords use [Am] or [C/G]. MIDI: pc, cc, note, off,
              sysex. Note cues need a matching off cue. Transpose changes the chart only.
            </p>
          </div>
          <div className="max-h-96 overflow-auto rounded border border-seam p-4 text-2xl leading-relaxed" aria-label="Performance lyrics">
            {cues.length ? (
              <ChartLines cues={cues} shift={shift} flats={flats} onChord={onSelectChord} />
            ) : (
              <pre className="whitespace-pre-wrap font-sans">{chartLine(transpose(chart, shift, flats), onSelectChord)}</pre>
            )}
          </div>
        </div>
        <div>
          <h2 className="font-semibold">Chords from stems</h2>
          <label>
            Chord source{" "}
            <select aria-label="Chord source" className={field} value={chordChoice} onChange={(e) => onChordChoice(e.target.value as StemName | "")}>
              <option value="">Automatic - {automaticSource || "no usable stem"}</option>
              {STEM_NAMES.filter((name) => stems?.[name]).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-silkscreen-3">
            Guitar is preferred. If it is missing or silent, automatic selection tries piano, then other stems. Override the source if the song has no guitar
            but separation left sound in that stem.
          </p>
          <p className="text-sm text-silkscreen-3">
            {analysing
              ? "Analysing harmonic stem…"
              : stems
                ? `Estimated major/minor chords from ${chordSource || "no usable stem"}. Review by ear; N means uncertain or silence.`
                : "Split the song in Stems to estimate its chords automatically."}
          </p>
          {!!chords.length && (
            <>
              <div className="my-2 max-h-32 overflow-auto font-mono">
                {chords.map((c) => (
                  <span key={c.time} className="mr-4 inline-block">
                    {lrcTime(c.time)}{" "}
                    {c.name === "N" ? (
                      "—"
                    ) : (
                      <button
                        type="button"
                        className="cursor-pointer rounded text-sky-400 hover:bg-sky-400/15"
                        aria-label={`Show ${transpose(`[${c.name}]`, shift, flats).slice(1, -1)} guitar voicings`}
                        onClick={() => onSelectChord(transpose(`[${c.name}]`, shift, flats).slice(1, -1))}
                      >
                        {transpose(`[${c.name}]`, shift, flats)}
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  void host.song
                    .saveFiles(
                      [{ name: "estimated-chords.lrc", bytes: new TextEncoder().encode(chords.map((c) => `${lrcTime(c.time)} [${c.name}]`).join("\n")) }],
                      "Export estimated chords",
                    )
                    .catch(session.fail)
                }
              >
                Export chord estimates
              </Button>
              <Button
                className="ml-2"
                variant="outline"
                onClick={() => onSaveChart(chart + "\n" + chords.map((c) => `${lrcTime(c.time)} [${c.name}]`).join("\n"))}
              >
                Append estimates to chart
              </Button>
            </>
          )}
        </div>
      </details>
    </>
  );
}
