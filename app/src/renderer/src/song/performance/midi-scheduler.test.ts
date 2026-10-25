import { expect, it } from "vitest";
import { BLUETOOTH_LOOKAHEAD, MidiSchedule, SYSTEM_LOOKAHEAD, type SchedulerConfig, type SchedulerReply } from "./midi-scheduler";
import { parseChart } from "./chart";
const config = (patch: Partial<SchedulerConfig> = {}): SchedulerConfig => ({
  cues: parseChart("[00:00] {midi:pc 1 1}\n[00:01] {midi:cc 2 12 127}"),
  position: 0,
  duration: 2,
  origin: 1000,
  bpm: 120,
  clock: false,
  tempo: null,
  ...patch,
});
function fixture(patch: Partial<SchedulerConfig> = {}) {
  const replies: SchedulerReply[] = [];
  const schedule = new MidiSchedule(config(patch), 1000, (r) => replies.push(r));
  return { schedule, replies, messages: () => replies.flatMap((r) => (r.type === "batch" ? r.messages : [])) };
}
it("queues each cue once on the fixed grid, preserves message order and applies start tempo after patch recall", () => {
  const f = fixture({
    tempo: [
      [191, 73, 0],
      [191, 74, 120],
    ],
  });
  f.schedule.tick(1000);
  f.schedule.sync(0.98, 1980, 1980);
  f.schedule.tick(1980); // a long poll resyncs instead of faulting
  expect(f.messages().map((m) => m.bytes)).toEqual([
    [192, 1],
    [191, 73, 0],
    [191, 74, 120],
    [177, 12, 127],
  ]);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
  expect(f.replies.some((r) => r.type === "resync")).toBe(true);
});
it("fills on-time cues without duplication and never emits after stop", () => {
  const f = fixture();
  for (let t = 1000; t <= 2020; t += 20) {
    f.schedule.sync((t - 1000) / 1000, t, t);
    f.schedule.tick(t);
  }
  expect(f.messages().map((m) => [m.bytes, m.due])).toEqual([
    [[192, 1], 1000],
    [[177, 12, 127], 2000],
  ]);
  f.schedule.stop();
  f.schedule.tick(2040);
  expect(f.messages()).toHaveLength(2);
});
it("does not replay cues before a seek as cues, only as chased state, and ignores cues beyond the song end", () => {
  const f = fixture({ position: 0.5, origin: 500, duration: 0.9 });
  f.schedule.tick(1000);
  expect(f.messages().map((m) => [m.bytes, m.label])).toEqual([[[192, 1], "Chase state"]]);
});
it.each([90, 120, 180])("keeps 24 PPQN at %i BPM despite checkpoint jitter", (bpm) => {
  const f = fixture({ bpm, clock: true, cues: [], duration: 10 });
  for (let t = 1000; t < 11000; t += 20) {
    f.schedule.sync((t - 1000) / 1000 + 0.002, t, t);
    f.schedule.tick(t);
  }
  const pulses = f.messages().filter((m) => m.bytes[0] === 248);
  expect(pulses).toHaveLength((bpm / 60) * 24 * 10);
  pulses.forEach((p, i) => expect(p.due).toBeCloseTo(1000 + (i * 60000) / bpm / 24, 6));
});
it("faults once when the audio clock stops advancing and never produces catch-up commands", () => {
  const f = fixture({ cues: parseChart("[00:03] {midi:pc 1 2}"), duration: 10 });
  for (let t = 1000; t <= 2100; t += 20) {
    f.schedule.sync(0, t, t);
    f.schedule.tick(t);
  }
  f.schedule.tick(3000);
  expect(f.replies.filter((r) => r.type === "fault")).toHaveLength(1);
  expect(f.replies.at(-1)?.type).toBe("fault");
  expect(f.messages()).toEqual([]);
});
it("resyncs when checkpoints disappear and only faults after three resyncs within five seconds", () => {
  const f = fixture({ cues: [] });
  for (let t = 1000; t < 1500; t += 20) f.schedule.tick(t);
  expect(f.replies.filter((r) => r.type === "resync")).toHaveLength(1);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
  for (let t = 1500; t <= 2000; t += 20) f.schedule.tick(t);
  expect(f.replies.filter((r) => r.type === "fault")).toHaveLength(1);
});
it("keeps the session running through a frozen renderer: stale patch changes are dropped and counted, later ones still fire", () => {
  const f = fixture({ cues: parseChart("[00:00.30] {midi:pc 1 2}\n[00:00.35] {midi:pc 1 3}\n[00:01.00] {midi:pc 1 4}"), duration: 5 });
  f.schedule.tick(1000);
  f.schedule.sync(0, 1000, 1000);
  // Nothing runs for 700 ms, then everything resumes.
  f.schedule.sync(0.7, 1700, 1700);
  for (let t = 1700; t <= 2000; t += 20) {
    f.schedule.sync((t - 1000) / 1000, t, t);
    f.schedule.tick(t);
  }
  const dropped = f.replies.flatMap((r) => (r.type === "batch" ? (r.dropped ?? []) : []));
  expect(dropped.map((m) => m.bytes)).toEqual([
    [192, 2],
    [192, 3],
  ]);
  // The dropped changes are replayed as one chase (only the latest patch), then the later cue fires.
  expect(f.messages().map((m) => m.bytes)).toEqual([
    [192, 3],
    [192, 4],
  ]);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
  expect(f.replies.some((r) => r.type === "resync")).toBe(true);
});
it("sends a late note-off, drops a late note-on and silently drops late clock pulses", () => {
  const f = fixture({ cues: parseChart("[00:00.10] {midi:note 1 60 100}\n[00:00.10] {midi:off 1 60 0}"), clock: true, duration: 5 });
  f.schedule.sync(0.7, 1700, 1700);
  f.schedule.tick(1700);
  const dropped = f.replies.flatMap((r) => (r.type === "batch" ? (r.dropped ?? []) : []));
  expect(dropped.map((m) => m.bytes)).toEqual([[144, 60, 100]]);
  expect(f.messages().map((m) => m.bytes)).toContainEqual([128, 60, 0]);
  expect(
    f
      .messages()
      .filter((m) => m.bytes[0] === 248)
      .every((m) => 1700 - m.due <= 250),
  ).toBe(true);
  expect(dropped.some((m) => m.bytes[0] === 248)).toBe(false);
});
it("emits system MIDI cues up to a second ahead with exact due times, and only 120 ms ahead for Bluetooth", () => {
  const cues = parseChart("[00:00.05] {midi:pc 1 1}\n[00:00.90] {midi:pc 1 2}\n[00:02.00] {midi:pc 1 3}");
  const usb = fixture({ cues, duration: 5, lookahead: SYSTEM_LOOKAHEAD });
  usb.schedule.tick(1000);
  expect(usb.messages().map((m) => [m.bytes, m.due])).toEqual([
    [[192, 1], 1050],
    [[192, 2], 1900],
  ]);
  const ble = fixture({ cues, duration: 5, lookahead: BLUETOOTH_LOOKAHEAD });
  ble.schedule.tick(1000);
  expect(ble.messages().map((m) => m.bytes)).toEqual([[192, 1]]);
});
it("does not apply the start tempo late: it is dropped and the session carries on", () => {
  const replies: SchedulerReply[] = [];
  const schedule = new MidiSchedule(config({ cues: [], tempo: [[191, 74, 120]] }), 1500, (r) => replies.push(r));
  schedule.tick(1500);
  expect(replies.some((r) => r.type === "fault")).toBe(false);
  expect(replies.flatMap((r) => (r.type === "batch" ? (r.dropped ?? []) : [])).map((m) => m.bytes)).toEqual([[191, 74, 120]]);
});
const chaseCues = "[00:00] {midi:cc 1 0 0} {midi:pc 1 1}\n[00:40] {midi:pc 1 2}\n[01:10] {midi:cc 1 0 0} {midi:pc 1 3}\n[01:40] {midi:pc 1 9}";
it("chases the patch in force when starting at 1:30, before the start tempo, 30 ms ahead of the start", () => {
  const f = fixture({ cues: parseChart(chaseCues), position: 90, origin: 1000 - 90_000, duration: 200, tempo: [[191, 74, 120]] });
  f.schedule.tick(1000);
  expect(f.messages().map((m) => m.bytes)).toEqual([[176, 0, 0], [192, 3], [191, 74, 120]]);
  expect(f.messages()[0].due).toBe(1000);
  f.schedule.tick(1020);
  expect(f.messages()).toHaveLength(3);
});
it("does not chase when starting from the beginning", () => {
  const f = fixture();
  f.schedule.tick(1000);
  expect(f.messages().map((m) => m.bytes)).toEqual([[192, 1]]);
});
it("replays dropped patch changes as a chase after a stall instead of leaving the pedal on the old patch", () => {
  const f = fixture({ cues: parseChart("[00:00.30] {midi:pc 1 2}\n[00:01.00] {midi:pc 1 4}"), duration: 5 });
  f.schedule.tick(1000);
  f.schedule.sync(0.7, 1700, 1700);
  f.schedule.tick(1700);
  expect(f.replies.flatMap((r) => (r.type === "batch" ? (r.dropped ?? []) : [])).map((m) => m.bytes)).toEqual([[192, 2]]);
  expect(f.messages().map((m) => m.bytes)).toEqual([[192, 2]]);
});

it("sends the start tempo at the start of a count-in, with the first cue at the audio start two seconds later", () => {
  // One bar at 120 BPM: the count-in starts at 1.0 s on the clock and the audio, with cue 0:00, at 3.0 s.
  const f = fixture({
    cues: parseChart("[00:00] {midi:pc 1 1}"),
    position: 0,
    duration: 2,
    origin: 3000,
    tempoAt: 1000,
    lookahead: 2.5,
    tempo: [[191, 74, 120]],
  });
  f.schedule.tick(1000);
  const tempo = f.messages().find((m) => m.label === "Song tempo");
  const cue = f.messages().find((m) => m.label === "Song cue");
  expect(tempo?.due).toBe(1000);
  expect(cue?.due).toBe(3000);
});

/**
 * Runs a schedule the way the worker does: a tick every 20 ms and a checkpoint every 50 ms, taken from `audio(now)`.
 * `actions` run at the given clock times, before that tick, so a test can plan a jump at a chosen moment.
 */
function run(
  f: ReturnType<typeof fixture>,
  from: number,
  to: number,
  audio: (now: number) => number,
  actions: [number, () => void][] = [],
) {
  for (let now = from; now <= to; now += 20) {
    for (const [time, action] of actions) if (time === now) action();
    f.schedule.tick(now);
    if ((now - from) % 50 === 0) f.schedule.sync(audio(now), now, now);
  }
}

/** Song 0–16 with the clock on, a section 8–16 looped three times, then released. The loop is planned two seconds ahead of each boundary. */
it("loops a section three times with the clock running: no Stop, a continuous pulse, and cues once per pass", () => {
  const f = fixture({
    cues: parseChart("[00:08.50] {midi:pc 1 5}\n[00:12.00] {midi:pc 1 7}"),
    clock: true,
    duration: 40,
    origin: 1000,
    bpm: 120,
    lookahead: SYSTEM_LOOKAHEAD,
  });
  // Pass ends at clock 17000, 25000, 33000. Audio: song 0–16 first, then 8–16 on each pass of the loop.
  const audio = (now: number) => (now < 17000 ? (now - 1000) / 1000 : 8 + ((now - 17000) % 8000) / 1000);
  const loopPlan = (boundary: number) => () => f.schedule.plan(16, { at: boundary, position: 8 });
  run(f, 1000, 36000, audio, [
    [15000, loopPlan(17000)],
    [23000, loopPlan(25000)],
    [31000, loopPlan(33000)],
    // Released: no plan at 33000, so the song plays on past the section.
  ]);
  const messages = f.messages();
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
  expect(messages.some((m) => m.bytes[0] === 252)).toBe(false);
  const pulses = messages.filter((m) => m.bytes[0] === 248).map((m) => m.due);
  const period = 60000 / 120 / 24;
  expect(pulses.length).toBeGreaterThan(0);
  pulses.forEach((due, i) => expect(due).toBeCloseTo(1000 + i * period, 6));
  const cueDues = messages.filter((m) => m.bytes[0] === 192 && m.bytes[1] === 5).map((m) => m.due);
  expect(cueDues).toEqual([9500, 17500, 25500, 33500]);
});

it("does not send cues beyond the cap until the plan lifts it", () => {
  const f = fixture({ cues: parseChart("[00:06.00] {midi:pc 1 9}"), duration: 10, origin: 1000 });
  f.schedule.plan(5, null);
  run(f, 1000, 8000, (now) => (now - 1000) / 1000);
  expect(f.messages().some((m) => m.bytes[1] === 9)).toBe(false);
  f.schedule.plan(null, null);
  run(f, 8020, 8200, (now) => (now - 1000) / 1000);
  expect(f.messages().filter((m) => m.bytes[0] === 192 && m.bytes[1] === 9)).toHaveLength(1);
});

it("a backward jump chases the state at the new position once, with no duplicates, and replays cues from there", () => {
  const f = fixture({
    cues: parseChart(
      "[00:01.00] {midi:pc 1 2}\n[00:03.00] {midi:cc 1 20 127}\n[00:10.00] {midi:pc 1 5}\n[00:12.00] {midi:cc 1 21 40}\n[00:17.00] {midi:cc 1 22 9}",
    ),
    duration: 30,
    origin: 1000,
  });
  // Plays 0–20 on clock 1000–21000. A jump at 21000 returns to song 15, so the cue at 17.00 plays again.
  const audio = (now: number) => (now < 21000 ? (now - 1000) / 1000 : 15 + (now - 21000) / 1000);
  run(f, 1000, 19000, (now) => (now - 1000) / 1000);
  f.schedule.plan(20, { at: 21000, position: 15 });
  run(f, 19020, 24000, audio);
  const chase = f.messages().filter((m) => m.label === "Chase state");
  // Two chases: the start, and the jump. The jump's is the one at clock 21000.
  const atJump = chase.filter((m) => m.due >= 21000).map((m) => m.bytes);
  expect(atJump).toEqual([
    [192, 5],
    [176, 20, 127],
    [176, 21, 40],
  ]);
  expect(f.messages().filter((m) => m.bytes[1] === 22)).toHaveLength(2);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
});

it("does not fault on a jump, and ignores a checkpoint taken before the jump", () => {
  const f = fixture({ cues: parseChart("[00:01.00] {midi:pc 1 2}"), duration: 30, origin: 1000 });
  run(f, 1000, 4000, (now) => (now - 1000) / 1000);
  f.schedule.plan(3, { at: 4000, position: 1 });
  // A jump backwards: the position falls from 3 to 1 on the clock. Without the jump the stall check would fire.
  run(f, 4020, 6000, (now) => (now < 4000 ? 3 : 1 + (now - 4000) / 1000));
  // A checkpoint sampled just before the jump arrives late: it describes the old passage and must be ignored.
  f.schedule.sync(2.9, 3990, 6000);
  expect(f.replies.some((r) => r.type === "fault" || r.type === "resync")).toBe(false);
});
