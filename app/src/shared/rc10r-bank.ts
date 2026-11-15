/** Fixed native user-rhythm storage. Existing records stay byte-identical when another slot changes. */
export const RC10R_RECORD_BYTES = 40_116;
export const RC10R_BANK_BYTES = 12 + 50 * RC10R_RECORD_BYTES;

export interface Rc10rPatternInfo {
  slot: number;
  name: string;
  kit: number;
  bpm: number;
}

const invalid = () => new Error("The RC-10R rhythm data has an unsupported or damaged layout. No files were changed.");

/** Validates one populated record, including every role and its shared note sequence. */
export function readRc10rRecord(record: Uint8Array): Omit<Rc10rPatternInfo, "slot"> {
  if (record.length !== RC10R_RECORD_BYTES) throw invalid();
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  const name = String.fromCharCode(...record.subarray(0, 8)).trim();
  const kit = view.getUint16(12, true),
    bpm = view.getUint16(14, true);
  const numerator = record[16],
    denominator = record[17];
  if (!name || [...record.subarray(0, 8)].some((b) => b < 32 || b > 126) || kit > 15 || bpm < 40 || bpm > 350) throw invalid();
  if (!((denominator === 4 && numerator >= 2 && numerator <= 7) || (denominator === 8 && numerator >= 5 && numerator <= 15))) throw invalid();
  if (view.getUint32(8, true) || view.getUint16(18, true)) throw invalid();
  const bars = view.getUint32(24, true),
    count = view.getUint32(32, true);
  if (!bars || bars > 65535 || count < 2 || count > 10000) throw invalid();
  for (let role = 0; role < 6; role++) {
    const at = 20 + role * 16;
    const from = view.getUint16(at, true),
      length = view.getUint16(at + 2, true);
    if (!length || from + length > bars || ((role === 2 || role === 4) && length !== 1)) throw invalid();
    if (view.getUint32(at + 4, true) !== bars || view.getUint32(at + 8, true) || view.getUint32(at + 12, true) !== count) throw invalid();
  }
  let tick = 0;
  for (let i = 0; i < count; i++) {
    const at = 116 + i * 4,
      pitch = record[at + 2],
      velocity = record[at + 3];
    tick += view.getUint16(at, true);
    if (i === count - 1 ? pitch !== 0 || velocity !== 0 : pitch < 1 || pitch > 127 || velocity < 1 || velocity > 127) throw invalid();
  }
  if (!tick || tick > bars * numerator * (4 / denominator) * 96 || record.subarray(116 + count * 4).some((b) => b !== 0)) throw invalid();
  return { name, kit, bpm };
}

/** Active records are contiguous; extending a bank may only append its next empty slot. */
export function readRc10rBank(bytes: Uint8Array): Rc10rPatternInfo[] {
  if (bytes.length !== RC10R_BANK_BYTES || String.fromCharCode(...bytes.subarray(0, 8)) !== "PTN_0000") throw invalid();
  const used = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  if (used % RC10R_RECORD_BYTES || used > 50 * RC10R_RECORD_BYTES) throw invalid();
  const count = used / RC10R_RECORD_BYTES;
  if (bytes.subarray(12 + used).some((b) => b !== 0)) throw invalid();
  return Array.from({ length: count }, (_, i) => ({
    slot: i + 1,
    ...readRc10rRecord(bytes.subarray(12 + i * RC10R_RECORD_BYTES, 12 + (i + 1) * RC10R_RECORD_BYTES)),
  }));
}

/** Replaces just the chosen record. Gaps are refused because the native active list is contiguous. */
export function patchRc10rBank(bank: Uint8Array, slot: number, record: Uint8Array): Uint8Array {
  const patterns = readRc10rBank(bank);
  readRc10rRecord(record);
  if (!Number.isInteger(slot) || slot < 1 || slot > 50 || slot > patterns.length + 1) throw new Error("Choose an existing User rhythm or the next empty slot.");
  const result = bank.slice();
  result.set(record, 12 + (slot - 1) * RC10R_RECORD_BYTES);
  new DataView(result.buffer).setUint32(8, Math.max(slot, patterns.length) * RC10R_RECORD_BYTES, true);
  return result;
}
