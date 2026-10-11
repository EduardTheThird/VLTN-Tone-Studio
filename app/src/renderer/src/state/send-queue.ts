// Coalesced live edits (knob turns must not flood the pedal): per key only the newest value is sent, with one send in flight
// per key; a value queued while its key is in flight goes out right after. Used for params, globals, tempo and EXP.

export class SendQueue {
  readonly #pending = new Map<string, () => Promise<void>>();
  readonly #inflight = new Set<string>();

  constructor(private readonly onError: (e: unknown) => void) {}

  /** Queue `send` as the newest edit of `key`. */
  push(key: string, send: () => Promise<void>): void {
    this.#pending.set(key, send);
    void this.#pump(key);
  }

  /** True while an edit of `key` waits or is being sent. */
  busy(key: string): boolean {
    return this.#pending.has(key) || this.#inflight.has(key);
  }

  /** Drop every edit not sent yet (preset switch, discard, disconnect). */
  clear(): void {
    this.#pending.clear();
  }

  async #pump(key: string) {
    if (this.#inflight.has(key)) return;
    this.#inflight.add(key);
    try {
      for (let send = this.#pending.get(key); send; send = this.#pending.get(key)) {
        this.#pending.delete(key);
        await send().catch(this.onError);
      }
    } finally {
      this.#inflight.delete(key);
    }
  }
}
