// Rotating session log files: `session.log` takes appends; past `maxBytes` it becomes `session.1.log`, the older ones
// move up and the oldest past `keep` is dropped. Writes run one at a time in call order. Pure Node, no Electron.
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SESSION_LOG_KEEP, SESSION_LOG_MAX_BYTES } from "@shared/host/log";

const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";
/** A log file's text; "" when it doesn't exist (yet, or rotated away). */
const readLog = (path: string) => readFile(path, "utf8").catch((e) => (missing(e) ? "" : Promise.reject(e)));

export class SessionLogStore {
  #queue: Promise<unknown> = Promise.resolve();
  /** Bytes in session.log; null until the first write looked. */
  #size: number | null = null;

  constructor(
    readonly dir: string,
    private readonly maxBytes = SESSION_LOG_MAX_BYTES,
    private readonly keep = SESSION_LOG_KEEP,
  ) {}

  /** session.log (0) or session.N.log. */
  #file(index: number): string {
    return join(this.dir, index === 0 ? "session.log" : `session.${index}.log`);
  }

  /** Run `job` after every earlier one; a failed job doesn't stop the next. */
  #serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(job);
    this.#queue = run.catch(() => {});
    return run;
  }

  append(lines: string[]): Promise<void> {
    if (!lines.length) return Promise.resolve();
    const text = lines.join("\n") + "\n";
    return this.#serial(async () => {
      if (this.#size === null) {
        await mkdir(this.dir, { recursive: true });
        this.#size = await stat(this.#file(0)).then((s) => s.size, () => 0);
      }
      const bytes = Buffer.byteLength(text);
      if (this.#size > 0 && this.#size + bytes > this.maxBytes) {
        for (let i = this.keep; i >= 1; i--) await rename(this.#file(i - 1), this.#file(i)).catch((e) => (missing(e) ? undefined : Promise.reject(e)));
        this.#size = 0;
      }
      await appendFile(this.#file(0), text, "utf8");
      this.#size += bytes;
    });
  }

  /** The newest `count` lines, oldest first. */
  tail(count: number): Promise<string[]> {
    return this.#serial(async () => {
      const lines: string[] = [];
      for (let i = 0; i <= this.keep && lines.length < count; i++) {
        const text = await readLog(this.#file(i));
        if (text) lines.unshift(...text.split("\n").filter(Boolean));
      }
      return lines.slice(-count);
    });
  }

  /** Write the whole log, every kept file oldest first, to `path`. */
  saveTo(path: string): Promise<void> {
    return this.#serial(async () => {
      const texts: string[] = [];
      for (let i = this.keep; i >= 0; i--) texts.push(await readLog(this.#file(i)));
      await writeFile(path, texts.join(""), "utf8");
    });
  }
}
