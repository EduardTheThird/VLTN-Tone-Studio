import { decodeFlac, encodeFlac, type FlacAudio } from "@shared/flac";

/** One FLAC job per worker; the client starts a worker for each track so a seven-track song decodes in parallel. */
export type FlacRequest = { kind: "encode"; audio: FlacAudio } | { kind: "decode"; bytes: Uint8Array };
export type FlacResponse = { ok: true; audio?: FlacAudio; bytes?: Uint8Array } | { ok: false; error: string };

self.onmessage = async (event: MessageEvent<FlacRequest>) => {
  try {
    const request = event.data;
    if (request.kind === "encode") {
      const bytes = await encodeFlac(request.audio);
      (self as unknown as Worker).postMessage({ ok: true, bytes } satisfies FlacResponse, [bytes.buffer]);
    } else {
      const audio = await decodeFlac(request.bytes);
      (self as unknown as Worker).postMessage(
        { ok: true, audio } satisfies FlacResponse,
        audio.channels.map((c) => c.buffer),
      );
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) } satisfies FlacResponse);
  }
};
