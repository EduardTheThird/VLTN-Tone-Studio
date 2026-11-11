import type { PreparationCommand } from "@/song/performance/preparation-repeat";
import { useSession, type PerformanceSession } from "@/song/performance/session";

const seconds = (ms: number) => Number((ms / 1000).toFixed(3)).toString();
function message(bytes: number[]): string {
  const kind = bytes[0] & 240,
    channel = (bytes[0] & 15) + 1;
  if (kind === 192) return `Ch ${channel} · PC ${bytes[1]}`;
  if (kind === 176) return `Ch ${channel} · CC ${bytes[1]}=${bytes[2]}`;
  return bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function commandDetails(commands: PreparationCommand[], tempo: boolean): string {
  const bytes = commands.map((command) => command.bytes);
  const bpm = tempo && bytes.length === 2 && bytes[0][1] === 73 && bytes[1][1] === 74 ? `${bytes[0][2] * 128 + bytes[1][2]} BPM · ` : "";
  return bpm + bytes.map(message).join(" → ");
}
const originLabel = { automatic: "Automatic", custom: "Your command", tempo: "Automatic tempo" };

/** The plan comes from the actual sender and reflects the current position, repeat history and automatic setup. */
export function PreparationSequencePreview({ session }: { session: PerformanceSession }) {
  const state = useSession(session, (value) => value);
  let plan,
    error = "";
  try {
    plan = session.preparationPreview();
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
  }
  return (
    <section aria-label="Preparation sequence preview" className="space-y-2 rounded border border-seam p-3 text-sm">
      <h3 className="font-medium">{state.starting ? "Preparation in progress" : "Next preparation sequence"}</h3>
      {state.parseError || error ? (
        <p role="alert">{state.parseError || error}</p>
      ) : state.playing ? (
        <p>Pause playback to preview the next preparation.</p>
      ) : !plan ? (
        <p>Load a song and enable Before song preparation to see its sequence.</p>
      ) : (
        <>
          <p>
            Configured preparation time: <strong>{seconds(plan.totalWaitMs)} s</strong>. This includes per-command waits, gaps, loading and tempo settling.
            Audio preparation, MIDI delivery, start delay and count-in can add time.
          </p>
          {state.pedalsReady && <p>Play reuses the Ready setup. This preview shows what Prepare again will run.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left" aria-label="Preparation steps">
              <thead>
                <tr>
                  <th className="p-2">At</th>
                  <th className="p-2">Step</th>
                  <th className="p-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {plan.steps.map((step, index) => (
                  <tr key={index} className="border-t border-seam" aria-current={state.preparing?.step === index ? "step" : undefined}>
                    <td className="p-2 tabular-nums">{seconds(step.atMs)} s</td>
                    <td className="p-2">
                      {step.label}
                      {step.kind === "send" && <span className="ml-1 text-xs text-silkscreen-3">({originLabel[step.origin]})</span>}
                    </td>
                    <td className="p-2">{step.kind === "wait" ? `${seconds(step.durationMs)} s` : commandDetails(step.commands, step.origin === "tempo")}</td>
                  </tr>
                ))}
                <tr className="border-t border-seam">
                  <td className="p-2">{seconds(plan.totalWaitMs)} s</td>
                  <td className="p-2">Ready</td>
                  <td className="p-2">Play starts the count-in and song.</td>
                </tr>
              </tbody>
            </table>
          </div>
          {plan.skipped.length > 0 && (
            <ul className="list-disc pl-5">
              {plan.skipped.map((step, index) => (
                <li key={index}>
                  {step.label}: {step.reason}
                </li>
              ))}
            </ul>
          )}
          <p>This is a read-only preview. Sending and wait completion do not confirm a pedal’s received settings.</p>
        </>
      )}
    </section>
  );
}
