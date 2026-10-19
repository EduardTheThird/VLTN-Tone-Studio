import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToneRecord } from "@shared/host/tones";
// vi.mock below is hoisted above these imports, so the store sees the fake host, device and converter.
import { runSend, startSendDraft, updateDraft, useTones } from "./store";
import { convertToClone } from "@/snaptone/convert";

const fake = vi.hoisted(() => ({
  irReads: [] as number[],
  toneWav: new Uint8Array([1, 2, 3]),
}));

const record = (toneId: number): ToneRecord => ({
  tone_id: toneId,
  title: "JCM800",
  gear: "amp",
  format: "nam",
  creator: { username: "someone", avatar_url: null },
  image_url: null,
  license: "t3k",
  url: "https://www.tone3000.com/tones/1",
  models: [],
  gp5: { verdict: "ready" },
  savedAt: "2026-10-10T00:00:00.000Z",
});

vi.mock("@/host", () => ({
  host: {
    tones: {
      prepareSnapTone: async (req: { toneId: number }) => ({
        text: "{}",
        bytes: 2,
        check: { version: "0.5.4", reshaped: false, arch: "A1", size: "standard" },
        record: record(req.toneId),
      }),
      readIr: async (toneId: number) => {
        fake.irReads.push(toneId);
        return fake.toneWav;
      },
      local: async () => [],
    },
  },
}));

vi.mock("@/state/device", () => {
  // Disconnected: runSend stops in "ready" with the converted file instead of writing it.
  const state = { status: "disconnected", device: "gp5", snapTones: null, userIRs: null };
  return { useDevice: { getState: () => state } };
});

vi.mock("@/app/notify", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/snaptone/convert", () => ({ convertToClone: vi.fn(async () => new Uint8Array([9])), snapToneFile: vi.fn() }));

const TONE = 7;

beforeEach(() => {
  fake.irReads = [];
  vi.mocked(convertToClone).mockClear();
  useTones.setState({ send: {}, records: {} });
});

describe("SnapTone send with a cab IR", () => {
  it("passes a picked WAV file to the converter", async () => {
    const wav = new Uint8Array([4, 5, 6]);
    startSendDraft(TONE, 1, "JCM", "snaptone", { cabIr: { kind: "file", name: "V30", wav } });
    await runSend(TONE);
    expect(vi.mocked(convertToClone).mock.calls[0][3]).toBe(wav);
    expect(fake.irReads).toEqual([]);
    expect(useTones.getState().send[TONE]).toMatchObject({ phase: "ready", step: 4 });
  });

  it("reads a downloaded IR tone from disk and passes its bytes", async () => {
    startSendDraft(TONE, 1, "JCM", "snaptone", { cabIr: { kind: "tone", toneId: 99, name: "Mesa 4x12" } });
    await runSend(TONE);
    expect(fake.irReads).toEqual([99]);
    expect(vi.mocked(convertToClone).mock.calls[0][3]).toBe(fake.toneWav);
  });

  it("converts amp only without a cab IR", async () => {
    startSendDraft(TONE, 1, "JCM", "snaptone");
    await runSend(TONE);
    expect(vi.mocked(convertToClone).mock.calls[0][3]).toBeUndefined();
  });

  it("drops the converted file and goes back to step 1 when the cab IR changes", async () => {
    startSendDraft(TONE, 1, "JCM", "snaptone");
    await runSend(TONE);
    expect(useTones.getState().send[TONE]?.file).not.toBeNull();
    updateDraft(TONE, { cabIr: { kind: "file", name: "V30", wav: new Uint8Array([1]) } });
    expect(useTones.getState().send[TONE]).toMatchObject({ phase: "idle", step: 1, file: null, cabIr: { name: "V30" } });
  });

  it("keeps the converted file when only the name changes", async () => {
    startSendDraft(TONE, 1, "JCM", "snaptone");
    await runSend(TONE);
    updateDraft(TONE, { name: "JCM2" });
    expect(useTones.getState().send[TONE]).toMatchObject({ phase: "ready", step: 4, name: "JCM2" });
  });

  it("never attaches a cab IR to an IR send", () => {
    startSendDraft(TONE, 1, "MESA", "ir", { cabIr: { kind: "tone", toneId: 99, name: "Mesa 4x12" } });
    expect(useTones.getState().send[TONE]?.cabIr).toBeNull();
  });

  it("starts a SnapTone built elsewhere (Tone Match) at the write step, without converting again", () => {
    const clone = new Uint8Array(8840);
    const check = { version: "0.5.4", reshaped: false, arch: "A1" as const, size: "standard" };
    const wav = new Uint8Array([7]);
    expect(startSendDraft(TONE, 1, "PLEXI", "snaptone", { cabIr: { kind: "file", name: "Tone Match IR", wav }, built: { clone, check } })).toBe(true);
    expect(useTones.getState().send[TONE]).toMatchObject({ phase: "ready", step: 4, file: clone, check, cabIr: { name: "Tone Match IR" } });
    expect(convertToClone).not.toHaveBeenCalled();
  });

  it("doesn't replace a send that is running", async () => {
    startSendDraft(TONE, 1, "JCM", "snaptone");
    const running = runSend(TONE);
    expect(startSendDraft(TONE, 1, "PLEXI", "snaptone", { built: { clone: new Uint8Array(8840), check: { version: "0.5.4", reshaped: false, arch: "A1", size: "standard" } } })).toBe(false);
    await running;
    expect(useTones.getState().send[TONE]?.name).toBe("JCM");
  });
});
