import { useEffect, useState } from "react";
import { useSession, type PerformanceSession } from "@/song/performance/session";
/** The countdown updates only this small status, not the song's mixer or scheduler. */
export function SongPreparationStatus({ session }: { session: PerformanceSession }) {
  const preparing = useSession(session, (state) => state.preparing);
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (!preparing) return;
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [preparing]);
  if (!preparing) return null;
  const seconds = Math.max(0, preparing.until - now) / 1000;
  return (
    <p role="status">
      Preparing pedals: {preparing.label}
      {seconds > 0 ? ` — ${seconds.toFixed(1)} s` : ""}.
    </p>
  );
}
