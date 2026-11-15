// Synthetic fixtures only: no pedal backups or user metadata are included.
import { RC10R_BANK_BYTES, RC10R_RECORD_BYTES } from "./rc10r-bank";

export function testRc10rRecord(name = "Test"): Uint8Array {
  const result = new Uint8Array(RC10R_RECORD_BYTES),
    view = new DataView(result.buffer);
  result.set(new TextEncoder().encode(name.padEnd(8, " ").slice(0, 8)));
  view.setUint16(14, 120, true);
  result[16] = result[17] = 4;
  for (let i = 0; i < 6; i++) {
    const at = 20 + i * 16;
    view.setUint16(at + 2, 1, true);
    view.setUint32(at + 4, 1, true);
    view.setUint32(at + 12, 3, true);
  }
  result.set([0, 0, 36, 100, 96, 0, 38, 90, 32, 1, 0, 0], 116);
  return result;
}
export function testRc10rBank(count = 1): Uint8Array {
  const result = new Uint8Array(RC10R_BANK_BYTES);
  result.set(new TextEncoder().encode("PTN_0000"));
  new DataView(result.buffer).setUint32(8, count * RC10R_RECORD_BYTES, true);
  for (let i = 0; i < count; i++) result.set(testRc10rRecord(`User${i + 1}`), 12 + i * RC10R_RECORD_BYTES);
  return result;
}
export function testRc10rXml(): string {
  const contents = Array.from(
    { length: 400 },
    (_, i) => `<CONTENT${String(i).padStart(3, "0")}><Kit>0</Kit><Tempo>1200</Tempo></CONTENT${String(i).padStart(3, "0")}>`,
  ).join("\n");
  const fields =
    "<TRACK1><WavLen>42</WavLen></TRACK1><TRACK2><WavLen>43</WavLen></TRACK2><MASTER><Other>17</Other></MASTER><RHYTHM><Genre>20</Genre><Pattern>0</Pattern></RHYTHM>";
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n<database name="RC-10R" revision="0">\n' +
    Array.from({ length: 99 }, (_, id) => `<mem id="${id}">${fields}\n${contents}</mem>`).join("\n") +
    "\n</database>\n"
  );
}
export function testRc10rMemory(xml = testRc10rXml(), counter = 0): Uint8Array {
  const body = new TextEncoder().encode(xml),
    result = new Uint8Array(body.length + 4);
  result.set(body);
  new DataView(result.buffer).setInt32(body.length, counter, true);
  return result;
}
