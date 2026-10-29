// The saved-song analysis in the status bar (spec 77). While a run goes on it shows the song, the step, the time left and a bar. For a
// while after the run ends it shows the summary. A click opens the Library's Analyse dialog on the run.

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { describeTimeLeft, isRunning, jobFraction, secondsLeft, useAnalysisJob, type AnalysisJobState } from "@/song/analysis/analysis-job";
import { useNav } from "@/state/nav";

/** How long the summary stays in the status bar after a run ends, unless it is clicked first. */
export const SUMMARY_MS = 15_000;

/** The one line the chip shows while a run goes on. */
export function analysisChipText(job: AnalysisJobState, now: number): string {
  const position = `${Math.min(job.done + 1, job.total)}/${job.total}`;
  if (job.phase === "waiting") return `Analysing songs: waiting for ${job.waitingFor === "song" ? "playback to stop" : "the playlist to stop"}`;
  if (job.phase === "loading" && job.current) return `Analysing songs: loading ${job.current.title}…`;
  if (job.phase === "preparing" || !job.current) return "Analysing songs…";
  const step = job.current.step ? ` (${job.current.step})` : "";
  const left = job.startedAt === null ? null : secondsLeft(now, job.startedAt, job.done, job.total);
  return `Analysing songs ${position} · ${job.current.title}${step}${left === null ? "" : ` · ${describeTimeLeft(left)} left`}`;
}

export function AnalysisChip() {
  const job = useAnalysisJob();
  const running = isRunning(job.phase);
  const [now, setNow] = useState(() => Date.now());
  const [summary, setSummary] = useState(false);

  // The clock ticks once a second while a run goes on, for the time left.
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  // The summary shows for SUMMARY_MS after the run ends. A run that ended long before this mounted is not shown again.
  useEffect(() => {
    if (job.endedAt === null) return;
    const left = SUMMARY_MS - (Date.now() - job.endedAt);
    if (left <= 0) return;
    setSummary(true);
    const timer = setTimeout(() => setSummary(false), left);
    return () => clearTimeout(timer);
  }, [job.endedAt]);

  if (!running && !(summary && job.endedAt !== null)) return null;

  const open = () => {
    setSummary(false);
    useNav.getState().go("song", "songs");
    useAnalysisJob.getState().requestOpen();
  };
  const failed = job.phase === "failed";
  const stopped = job.phase === "stopped";
  const text = running ? analysisChipText(job, now) : failed ? `Analysis failed: ${job.error ?? ""}` : (job.summary ?? "");
  const percent = running ? Math.round(jobFraction(job) * 100) : 100;

  return (
    <button type="button" onClick={open} className="flex min-w-0 max-w-[45%] shrink items-center gap-2 text-left hover:text-silkscreen-1">
      <span className={cn("size-[7px] shrink-0 rounded-full", failed ? "bg-led-fault" : running || stopped ? "bg-led-warn" : "bg-led-on")} aria-hidden />
      <span className="truncate">{text}</span>
      {running && <Progress className="w-16 shrink-0" value={percent} aria-label="Analysis progress" />}
    </button>
  );
}
