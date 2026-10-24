import type { Cue } from "./chart";

export interface ChaseMessage {
  bytes: number[];
  /** Song position of the cue the state came from. */
  time: number;
}

/** The chase is sent this long before the start position so the pedals have settled when the song begins. */
export const CHASE_LEAD_MS = 30;

/**
 * Controller numbers that every built-in pedal profile uses only for triggers (looper, tap tempo, footswitch presses, patch step).
 * A raw cue cannot say which pedal it targets, so these are not replayed unless the cue is marked `{chase}`. Numbers that some profile
 * uses for a lasting parameter are left out; cues built from the pedal library carry `{nochase}` instead.
 * Kept literal so the scheduler worker stays free of the profile data; midi-chase.test.ts checks it against the profiles.
 */
export const MOMENTARY_CCS: ReadonlySet<number> = new Set([24, 64, 65, 75, 80, 82, 85, 86, 87, 89, 90, 93, 125]);

const isBank = (cc: number) => cc === 0 || cc === 32;

/** Whether a message from this cue is state worth replaying when the song starts after it. Notes and clock never are. */
export function isChased(cue: Cue, bytes: number[]): boolean {
  if (cue.chase === false) return false;
  if (bytes[0] === 0xf0) return cue.chase === true;
  const kind = bytes[0] & 240;
  if (kind === 0xc0) return true;
  if (kind === 0xb0) return cue.chase === true || !MOMENTARY_CCS.has(bytes[1]);
  return false;
}

/**
 * The messages that bring the pedals to the state they would be in at `position` had the song played from the start.
 * Order: bank select + program change per channel, then controllers, then SysEx; each group in song order.
 * Only the latest value per (channel, controller) and the latest program change per channel are kept.
 */
export function computeChaseState(cues: Cue[], position: number): ChaseMessage[] {
  const banks = new Map<number, Map<number, number[]>>();
  const programs = new Map<number, ChaseMessage[]>();
  const controllers = new Map<string, ChaseMessage>();
  const sysex = new Map<string, ChaseMessage>();
  const ordered = cues.filter((cue) => cue.messages.length && cue.time < position - 0.001).sort((a, b) => a.time - b.time);
  for (const cue of ordered) {
    for (const bytes of cue.messages) {
      if (!isChased(cue, bytes)) continue;
      if (bytes[0] === 0xf0) {
        const key = bytes.join(",");
        sysex.delete(key);
        sysex.set(key, { bytes, time: cue.time });
        continue;
      }
      const channel = bytes[0] & 15;
      if ((bytes[0] & 240) === 0xc0) {
        const selected = [...(banks.get(channel)?.entries() ?? [])].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
        programs.set(channel, [...selected.map((bank) => ({ bytes: bank, time: cue.time })), { bytes, time: cue.time }]);
        continue;
      }
      if (isBank(bytes[1])) {
        const channelBanks = banks.get(channel) ?? new Map<number, number[]>();
        channelBanks.set(bytes[1], bytes);
        banks.set(channel, channelBanks);
      }
      const key = `${channel}:${bytes[1]}`;
      controllers.delete(key);
      controllers.set(key, { bytes, time: cue.time });
    }
  }
  return [...[...programs.values()].flat(), ...[...controllers.values()].filter((m) => !isBank(m.bytes[1])), ...sysex.values()];
}
