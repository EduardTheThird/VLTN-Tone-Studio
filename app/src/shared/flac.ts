import type * as FlacModule from "libflacjs/dist/libflac";

/**
 * Lossless FLAC for the song library. The same module runs in the main process (migration) and in a renderer worker (save and load), so it
 * uses the plain pure-JavaScript libflac build, whose memory image is embedded. The WASM build and the `min` build fetch a second file by URL,
 * which neither Node nor the packaged app can serve; with the `min` build the encoder silently fails to initialise.
 *
 * Samples are stored as 24-bit integers. Float32 has a 24-bit mantissa, so a stem recorded at normal levels loses nothing audible, and the
 * encoder/decoder pair is bit-exact for the quantized values.
 */
export const FLAC_BITS = 24;
const SCALE = 2 ** (FLAC_BITS - 1) - 1;
const COMPRESSION_LEVEL = 5;
const BLOCK_FRAMES = 65536;

export interface FlacAudio {
  sampleRate: number;
  channels: Float32Array[];
}

let loading: Promise<typeof FlacModule> | undefined;
function loadFlac(): Promise<typeof FlacModule> {
  loading ??= import("libflacjs/dist/libflac.js").then(
    (m) =>
      new Promise<typeof FlacModule>((resolve) => {
        const flac = ((m as { default?: unknown }).default ?? m) as typeof FlacModule;
        if (flac.isReady()) resolve(flac);
        else flac.on("ready", () => resolve(flac));
      }),
  );
  return loading;
}

/** The 24-bit integer a float sample is stored as. Exported so tests can check the round trip bit for bit. */
export const quantize = (value: number): number => Math.round(Math.max(-1, Math.min(1, value)) * SCALE);

export async function encodeFlac(audio: FlacAudio): Promise<Uint8Array> {
  const { sampleRate, channels } = audio;
  const frames = channels[0]?.length ?? 0;
  if (!channels.length || channels.length > 2 || !frames || channels.some((c) => c.length !== frames)) throw new Error("Invalid audio for FLAC encoding.");
  const flac = await loadFlac();
  const encoder = flac.create_libflac_encoder(sampleRate, channels.length, FLAC_BITS, COMPRESSION_LEVEL, frames, false);
  if (!encoder) throw new Error("Could not start the FLAC encoder.");
  const chunks: Uint8Array[] = [];
  try {
    const status = flac.init_encoder_stream(encoder, (data) => {
      chunks.push(data.slice());
    });
    if (status !== 0) throw new Error(`Could not start the FLAC encoder (status ${status}).`);
    const block = new Int32Array(BLOCK_FRAMES * channels.length);
    for (let start = 0, blockNo = 0; start < frames; start += BLOCK_FRAMES, blockNo++) {
      // The main process migrates songs with this; give its event loop a turn about every million frames.
      if (blockNo % 16 === 15) await new Promise((resolve) => setTimeout(resolve));
      const count = Math.min(BLOCK_FRAMES, frames - start);
      for (let i = 0; i < count; i++) for (let c = 0; c < channels.length; c++) block[i * channels.length + c] = quantize(channels[c][start + i]);
      if (!flac.FLAC__stream_encoder_process_interleaved(encoder, block.subarray(0, count * channels.length), count)) throw new Error("FLAC encoding failed.");
    }
    if (!flac.FLAC__stream_encoder_finish(encoder)) throw new Error("FLAC encoding failed.");
  } finally {
    flac.FLAC__stream_encoder_delete(encoder);
  }
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function decodeFlac(bytes: Uint8Array): Promise<FlacAudio> {
  const flac = await loadFlac();
  const decoder = flac.create_libflac_decoder(false);
  if (!decoder) throw new Error("Could not start the FLAC decoder.");
  let sampleRate = 0,
    total = 0,
    channelCount = 0,
    bits = 0,
    channels: Float32Array[] = [],
    written = 0,
    position = 0,
    failure = "";
  try {
    const status = flac.init_decoder_stream(
      decoder,
      (wanted) => {
        const count = Math.min(wanted, bytes.length - position);
        // libflac only reads the bytes; the cast narrows away SharedArrayBuffer, which a stored file never is.
        const buffer = bytes.subarray(position, position + count) as Uint8Array<ArrayBuffer>;
        position += count;
        return { buffer, readDataLength: count, error: false };
      },
      (data, info) => {
        // libflac hands out every channel as 32-bit little-endian integers, whatever the stream's bit depth.
        const samples = data.map((d) => new Int32Array(d.buffer, d.byteOffset, d.byteLength >> 2));
        const frames = samples[0].length;
        if (written + frames > total) {
          failure = "The FLAC stream is longer than its header says.";
          return;
        }
        for (let c = 0; c < channelCount; c++) for (let i = 0; i < frames; i++) channels[c][written + i] = samples[c][i] / (2 ** (bits - 1) - 1);
        written += frames;
        void info;
      },
      (_code, description) => {
        failure = String(description || "The FLAC stream is damaged.");
      },
      (meta) => {
        if (!meta) return;
        sampleRate = meta.sampleRate;
        total = meta.total_samples;
        channelCount = meta.channels;
        bits = meta.bitsPerSample;
        if (!total || channelCount < 1 || channelCount > 2 || bits < 8 || bits > 24) {
          failure = "Unsupported FLAC stream.";
          return;
        }
        channels = Array.from({ length: channelCount }, () => new Float32Array(total));
      },
    );
    if (status !== 0) throw new Error("This is not a FLAC file.");
    if (!flac.FLAC__stream_decoder_process_until_end_of_stream(decoder) || failure) throw new Error(failure || "The FLAC stream is damaged.");
    flac.FLAC__stream_decoder_finish(decoder);
  } finally {
    flac.FLAC__stream_decoder_delete(decoder);
  }
  if (!channels.length || written !== total) throw new Error("The FLAC stream is truncated.");
  return { sampleRate, channels };
}
