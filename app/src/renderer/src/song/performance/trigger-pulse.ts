/** A physical controller must see a press before its release, even when both chart messages share a timestamp. */
export const TRIGGER_HOLD_MS = 100;
const RESET_MS = 10;
interface ControlState {
  bytes: number[];
  press: number | null;
  release: number | null;
}

/** Keeps momentary controls ordered on one output; all times use performance.now(), like Web MIDI timestamps. */
export class TriggerPulses {
  private outputs = new WeakMap<object, Map<string, ControlState>>();

  timestamp(output: object, bytes: number[], timestamp: number | undefined, now: number): number | undefined {
    if (bytes.length !== 3 || (bytes[0] & 240) !== 176 || ![0, 127].includes(bytes[2])) return timestamp;
    const controls = this.outputs.get(output) ?? new Map<string, ControlState>();
    this.outputs.set(output, controls);
    const key = `${bytes[0]}:${bytes[1]}`;
    const previous = controls.get(key);
    const requested = Math.max(now, timestamp ?? now);
    let at = requested;
    if (bytes[2] === 127) {
      if (previous?.release !== null && previous?.release !== undefined) at = Math.max(at, previous.release + RESET_MS);
      controls.set(key, { bytes: [bytes[0], bytes[1], 0], press: at, release: null });
    } else {
      if (previous?.press !== null && previous?.press !== undefined) at = Math.max(at, previous.press + TRIGGER_HOLD_MS);
      controls.set(key, { bytes: [...bytes], press: previous?.press ?? null, release: at });
    }
    return at > requested ? at : timestamp;
  }

  /** Output.clear() cancels queued releases. Requeue only controls whose presses could already have reached the pedal. */
  releasesAfterClear(output: object, now: number): { bytes: number[]; timestamp: number }[] {
    const controls = this.outputs.get(output);
    if (!controls) return [];
    const releases: { bytes: number[]; timestamp: number }[] = [];
    for (const [key, control] of controls) {
      if (control.press !== null && control.press <= now && (control.release === null || control.release > now)) {
        const timestamp = Math.max(now, control.press + TRIGGER_HOLD_MS);
        releases.push({ bytes: [...control.bytes], timestamp });
        control.release = timestamp;
      } else controls.delete(key);
    }
    return releases;
  }
}
