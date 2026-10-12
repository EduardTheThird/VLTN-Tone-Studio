// Session log: connections, errors, host checks and every MIDI message, kept for bug reports and device work.
// Desktop: rotated files in userData/logs (main/ipc/log.ts). Browser: an in-memory buffer. Owner: Device screen.

/** One file holds up to this much before it rotates; KEEP older files stay next to it. */
export const SESSION_LOG_MAX_BYTES = 4 * 1024 * 1024;
export const SESSION_LOG_KEEP = 4;
/** Longest line a host stores (a full preset in hex fits); longer lines are cut. */
export const SESSION_LOG_MAX_LINE = 64 * 1024;
/** Most lines one append may carry. */
export const SESSION_LOG_MAX_BATCH = 5000;

/** "2026-10-12T08:20:47.123Z  Event  Connected …": the line format of every log writer. */
export function sessionLogLine(kind: string, text: string, at = Date.now()): string {
  return `${new Date(at).toISOString()}  ${kind.padEnd(5)}  ${text}`;
}

export interface SessionLogApi {
  /** Append lines (already formatted with sessionLogLine). */
  append(lines: string[]): Promise<void>;
  /** The newest `count` lines, oldest first. */
  tail(count: number): Promise<string[]>;
  /** Save the whole log (every kept file, oldest first) as one text file. Returns the path, or null when cancelled. */
  save(fileName: string): Promise<string | null>;
  /** Folder holding the log files; null when the host keeps the log in memory (browser). */
  folder(): Promise<string | null>;
}
