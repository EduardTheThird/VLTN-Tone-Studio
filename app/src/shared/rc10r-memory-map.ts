// A read-only summary of the RC-10R's 99 phrase memories from a validated MEMORY1/MEMORY2 pair (spec 177): which rhythm each memory
// selects, its kit and tempo, and whether its two looper tracks hold recorded audio. Values are the literal numbers in the files.

/** The genre number the pedal uses for User rhythms; the pattern is then User slot − 1. */
export const RC10R_USER_GENRE = 20;
/** Looper audio is 44.1 kHz; WavLen counts sample frames. */
const LOOP_RATE = 44100;

export interface Rc10rTrackSummary {
  /** True when the track holds recorded audio. */
  recorded: boolean;
  seconds: number;
  /** Tempo the track was recorded at, in BPM. */
  tempo: number;
}

export interface Rc10rMemorySummary {
  /** 1–99, as shown on the pedal. */
  memory: number;
  genre: number;
  pattern: number;
  /** User rhythm 1–50 when the memory selects one, otherwise null. */
  userRhythm: number | null;
  kit: number;
  /** Rhythm tempo in BPM. */
  tempo: number;
  intro: boolean;
  stopMode: number;
  playMode: number;
  tracks: [Rc10rTrackSummary, Rc10rTrackSummary];
}

const damaged = () => new Error("The RC-10R memory files have an unsupported layout.");

function field(block: string, name: string): number {
  const raw = new RegExp(`<${name}>(\\d{1,8})</${name}>`).exec(block)?.[1];
  if (raw === undefined) throw damaged();
  return Number(raw);
}

function track(phrase: string, index: 1 | 2): Rc10rTrackSummary {
  const block = new RegExp(`<TRACK${index}>([\\s\\S]*?)</TRACK${index}>`).exec(phrase)?.[1];
  if (block === undefined) throw damaged();
  const recorded = field(block, "WavStat") !== 0;
  return { recorded, seconds: recorded ? field(block, "WavLen") / LOOP_RATE : 0, tempo: field(block, "RecTmp") / 10 };
}

/** Summarises a validated memory XML string (see rc10r-memory.ts readRc10rMemoryPair). */
export function rc10rMemoryMap(xml: string): Rc10rMemorySummary[] {
  const result: Rc10rMemorySummary[] = [];
  for (const [, id, phrase] of xml.matchAll(/<mem id="(\d{1,2})">([\s\S]*?)<\/mem>/g)) {
    const rhythm = /<RHYTHM>([\s\S]*?)<\/RHYTHM>/.exec(phrase)?.[1];
    if (rhythm === undefined) throw damaged();
    const genre = field(rhythm, "Genre"),
      pattern = field(rhythm, "Pattern");
    result.push({
      memory: Number(id) + 1,
      genre,
      pattern,
      userRhythm: genre === RC10R_USER_GENRE ? pattern + 1 : null,
      kit: field(rhythm, "Kit"),
      tempo: field(rhythm, "Tempo") / 10,
      intro: field(rhythm, "Intro") === 1,
      stopMode: field(rhythm, "StopMode"),
      playMode: field(rhythm, "PlayMode"),
      tracks: [track(phrase, 1), track(phrase, 2)],
    });
  }
  if (result.length !== 99) throw damaged();
  return result.sort((a, b) => a.memory - b.memory);
}

/** True when either looper track of the memory holds audio. */
export const hasLoops = (memory: Rc10rMemorySummary): boolean => memory.tracks.some((t) => t.recorded);

/** Memories with no loops and not used by any song, in order. */
export function freeRc10rMemories(map: readonly Rc10rMemorySummary[], used: ReadonlySet<number>): number[] {
  return map.filter((m) => !hasLoops(m) && !used.has(m.memory)).map((m) => m.memory);
}
