import { SaxesParser } from "saxes";

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const damaged = () => new Error("The RC-10R memory files disagree or have an unsupported layout. Keep the backup and check the pedal before sending.");

/** Validates XML without resolving document types or entities. Unknown scalar fields remain untouched. */
export function rc10rMemoryXml(bytes: Uint8Array): string {
  if (bytes.length < 100 || bytes.length > 8 * 1024 * 1024) throw damaged();
  const xml = decoder.decode(bytes.subarray(0, -4));
  if (!xml.endsWith("</database>\n") || /<!|<\?(?!xml\s)/.test(xml)) throw damaged();
  const stack: { name: string; children: Set<string>; values: Map<string, string>; text: string }[] = [];
  const memories = new Set<string>();
  let nodes = 0;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("error", () => {
    throw damaged();
  });
  parser.on("opentag", (tag) => {
    if (++nodes > 300000 || stack.length > 6) throw damaged();
    if (!stack.length) {
      if (tag.name !== "database" || tag.attributes.name !== "RC-10R" || tag.attributes.revision !== "0") throw damaged();
    } else if (stack.length === 1) {
      const id = tag.attributes.id;
      if (tag.name !== "mem" || typeof id !== "string" || !/^(?:0|[1-9]\d?)$/.test(id) || Number(id) > 98 || memories.has(id)) throw damaged();
      memories.add(id);
    } else {
      if (Object.keys(tag.attributes).length || stack.at(-1)!.children.has(tag.name)) throw damaged();
      stack.at(-1)!.children.add(tag.name);
    }
    stack.push({ name: tag.name, children: new Set(), values: new Map(), text: "" });
  });
  parser.on("text", (text) => {
    if (text.trim() && stack.length) {
      stack.at(-1)!.text += text;
      if (stack.at(-1)!.text.length > 8192) throw damaged();
    }
  });
  parser.on("closetag", () => {
    const node = stack.pop()!;
    if (/^CONTENT/.test(node.name)) {
      if (
        !/^CONTENT[0-3]\d{2}$/.test(node.name) ||
        node.children.size !== 2 ||
        !/^\d+$/.test(node.values.get("Kit") ?? "") ||
        Number(node.values.get("Kit")) > 15 ||
        !/^\d+$/.test(node.values.get("Tempo") ?? "") ||
        Number(node.values.get("Tempo")) < 400 ||
        Number(node.values.get("Tempo")) > 3500
      )
        throw damaged();
    }
    if (node.name === "mem") {
      for (let i = 0; i < 400; i++) if (!node.children.has(`CONTENT${String(i).padStart(3, "0")}`)) throw damaged();
      for (const required of ["TRACK1", "TRACK2", "MASTER", "RHYTHM"]) if (!node.children.has(required)) throw damaged();
    }
    stack.at(-1)?.values.set(node.name, node.text);
  });
  parser.write(xml).close();
  if (memories.size !== 99) throw damaged();
  return xml;
}

/** Sending requires matching valid copies. Divergent copies are a recovery decision, never an automatic repair. */
export function readRc10rMemoryPair(first: Uint8Array, second: Uint8Array): string {
  const one = rc10rMemoryXml(first),
    two = rc10rMemoryXml(second);
  if (one !== two) throw damaged();
  return one;
}

export const RC10R_RHYTHM_FIELDS = ["Kit", "Level", "ReverbLevel", "Intro", "StopMode", "PlayMode", "FadeOutTime", "TransitionFill"] as const;
export type Rc10rRhythmField = (typeof RC10R_RHYTHM_FIELDS)[number];
export type Rc10rRhythmMemory = Partial<Record<Rc10rRhythmField, number>>;

/** Inspects one phrase in a validated backup pair. Values are the literal numbers in RHYTHM. */
export function inspectRc10rRhythmMemory(first: Uint8Array, second: Uint8Array, memory: number): Rc10rRhythmMemory {
  if (!Number.isInteger(memory) || memory < 1 || memory > 99) throw new Error("Choose a pedal memory from 1–99.");
  const xml = readRc10rMemoryPair(first, second);
  const phrase = new RegExp(`<mem id="${memory - 1}">([\\s\\S]*?)</mem>`).exec(xml)?.[1];
  const rhythm = phrase?.match(/<RHYTHM>([\s\S]*?)<\/RHYTHM>/)?.[1];
  if (rhythm === undefined) throw damaged();
  const values: Rc10rRhythmMemory = {};
  for (const field of RC10R_RHYTHM_FIELDS) {
    const raw = new RegExp(`<${field}>([0-9]{1,4})</${field}>`).exec(rhythm)?.[1];
    if (raw !== undefined) values[field] = Number(raw);
  }
  return values;
}

/** Changes only the chosen memory's per-user-rhythm kit and tempo; current selection and looper data stay byte-identical. */
export function patchRc10rMemory(xml: string, memory: number, slot: number, kit: number, bpm: number): [Uint8Array, Uint8Array] {
  if (
    !Number.isInteger(memory) ||
    memory < 1 ||
    memory > 99 ||
    !Number.isInteger(slot) ||
    slot < 1 ||
    slot > 50 ||
    !Number.isInteger(kit) ||
    kit < 0 ||
    kit > 15 ||
    !Number.isInteger(bpm) ||
    bpm < 40 ||
    bpm > 350
  )
    throw damaged();
  const memoryRe = new RegExp(`<mem id="${memory - 1}">[\\s\\S]*?</mem>`, "g");
  const memories = [...xml.matchAll(memoryRe)];
  if (memories.length !== 1) throw damaged();
  const source = memories[0][0];
  const contentRe = new RegExp(`<CONTENT${349 + slot}>[\\s\\S]*?</CONTENT${349 + slot}>`, "g");
  const contents = [...source.matchAll(contentRe)];
  if (contents.length !== 1) throw damaged();
  const content = contents[0][0];
  if ((content.match(/<Kit>\d+<\/Kit>/g)?.length ?? 0) !== 1 || (content.match(/<Tempo>\d+<\/Tempo>/g)?.length ?? 0) !== 1) throw damaged();
  const changed = content.replace(/<Kit>\d+<\/Kit>/, `<Kit>${kit}</Kit>`).replace(/<Tempo>\d+<\/Tempo>/, `<Tempo>${bpm * 10}</Tempo>`);
  const body = encoder.encode(xml.replace(source, source.replace(content, changed)));
  const copies = [0, 1].map((counter) => {
    const output = new Uint8Array(body.length + 4);
    output.set(body);
    new DataView(output.buffer).setInt32(body.length, counter, true);
    return output;
  });
  return [copies[0], copies[1]];
}
