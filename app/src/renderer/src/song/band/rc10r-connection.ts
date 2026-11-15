import type { Rc10rApi, Rc10rStorageView, Rc10rWritePlan } from "@shared/host/rc10r";
import { claimStageOperation } from "@/state/stage-operation";
import { rc10rPorts } from "./rc10r-device";

const HEADER = [0xf0, 0x41, 0x10, 0, 0, 0, 0x5f];
/** Only the two observed editor/storage control addresses can be sent. Rhythm bytes use storage, never guessed SysEx addresses. */
export function rc10rControl(command: "read" | "write", offset: 0 | 1, value = 0): number[] {
  if ((offset !== 0 && offset !== 1) || (value !== 0 && value !== 1)) throw new Error("Unsupported RC-10R control.");
  const data = [0x7f, 0x70, 0, offset, ...(command === "read" ? [0, 0, 0, 1] : [value])];
  const checksum = (128 - (data.reduce((sum, byte) => sum + byte, 0) % 128)) % 128;
  return [...HEADER, command === "read" ? 0x11 : 0x12, ...data, checksum, 0xf7];
}

/** A state reply must match the model, address, size and checksum, not just its last byte. */
export function rc10rState(bytes: Uint8Array, offset: number): number | null {
  if (
    bytes.length !== 15 ||
    HEADER.some((byte, i) => bytes[i] !== byte) ||
    bytes[7] !== 0x12 ||
    bytes[8] !== 0x7f ||
    bytes[9] !== 0x70 ||
    bytes[10] !== 0 ||
    bytes[11] !== offset ||
    bytes[14] !== 0xf7 ||
    bytes.subarray(8, 14).some((byte) => byte > 127) ||
    bytes.subarray(8, 14).reduce((sum, byte) => sum + byte, 0) % 128 ||
    bytes[12] > 1
  )
    return null;
  return bytes[12];
}

export interface Rc10rConnectionOptions {
  api: Rc10rApi;
  access(): Promise<MIDIAccess>;
  claim?: (owner: object) => () => void;
  wait?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/** Owns one paired MIDI link and one opaque storage lease through disconnect, including on failures. */
export class Rc10rConnection {
  private id?: string;
  inspection?: Rc10rStorageView;
  planned?: Rc10rWritePlan;
  private input?: MIDIInput;
  private output?: MIDIOutput;
  private releaseStage?: () => void;
  private ownsEditor = false;
  private cancelled = false;
  private pending?: { offset: number; expected?: number; resolve(value: number): void };
  private readonly receive = (event: MIDIMessageEvent) => {
    if (!this.pending || !event.data) return;
    const state = rc10rState(event.data, this.pending.offset);
    if (state !== null && (this.pending.expected === undefined || state === this.pending.expected)) this.pending.resolve(state);
  };
  constructor(private readonly options: Rc10rConnectionOptions) {}
  get active(): boolean {
    return this.id !== undefined || !!this.releaseStage;
  }
  private check(): void {
    if (this.cancelled) throw new Error("Transfer cancelled. Close the connection before using the pedal.");
  }
  private exchange(command: "read" | "write", offset: 0 | 1, value = 0, expected?: number): Promise<number> {
    if (this.pending) return Promise.reject(new Error("An RC-10R acknowledgement is already pending."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(new Error("The RC-10R did not acknowledge the storage command. Check USB and retry closing the connection."));
      }, this.options.timeoutMs ?? 5000);
      this.pending = {
        offset,
        expected,
        resolve: (state) => {
          clearTimeout(timer);
          this.pending = undefined;
          resolve(state);
        },
      };
      try {
        this.output!.send(rc10rControl(command, offset, value));
      } catch (error) {
        clearTimeout(timer);
        this.pending = undefined;
        reject(error);
      }
    });
  }
  async open(): Promise<Rc10rStorageView> {
    if (this.active) throw new Error("This transfer connection is already open.");
    this.releaseStage = (this.options.claim ?? claimStageOperation)(this);
    try {
      this.id = await this.options.api.reserve();
      this.check();
      const access = await this.options.access();
      if (!access.sysexEnabled) throw new Error("Allow MIDI SysEx access to connect the RC-10R.");
      const { inputs, outputs } = rc10rPorts(access);
      if (inputs.length !== 1 || outputs.length !== 1)
        throw new Error("Connect exactly one RC-10R USB input and output. Disconnect additional RC-10R ports, then retry.");
      this.input = inputs[0];
      this.output = outputs[0];
      await this.input.open();
      await this.output.open();
      this.input.addEventListener("midimessage", this.receive);
      this.check();
      if ((await this.exchange("read", 0)) !== 0) throw new Error("Another editor owns the RC-10R. Close it before opening native transfer.");
      this.check();
      // Mark ownership before sending: an acknowledgement can be lost after the pedal has accepted the request.
      this.ownsEditor = true;
      await this.exchange("write", 0, 1, 1);
      this.check();
      await this.exchange("write", 1, 1, 1);
      for (let attempt = 0; ; attempt++) {
        this.check();
        try {
          this.inspection = await this.options.api.inspect(this.id);
          return this.inspection;
        } catch (error) {
          if (attempt >= 9 || !(error instanceof Error) || !error.message.startsWith("Waiting for RC-10R storage")) throw error;
          await (this.options.wait ?? ((ms) => new Promise((done) => setTimeout(done, ms))))(1000);
        }
      }
    } catch (error) {
      try {
        await this.close();
      } catch (cleanup) {
        throw new Error(`${error instanceof Error ? error.message : String(error)} ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`);
      }
      throw error;
    }
  }
  async plan(record: Uint8Array, slot: number, memory: number | null): Promise<Rc10rWritePlan> {
    this.check();
    if (!this.id || !this.ownsEditor) throw new Error("Connect and inspect the RC-10R first.");
    this.planned = await this.options.api.plan(this.id, record, slot, memory);
    return this.planned;
  }
  async write(): Promise<void> {
    this.check();
    if (!this.id || !this.ownsEditor) throw new Error("The RC-10R connection is closed.");
    await this.options.api.write(this.id);
  }
  async cancel(): Promise<void> {
    this.cancelled = true;
    if (this.id) await this.options.api.cancel(this.id);
  }
  async recover(backupId: string): Promise<void> {
    if (!this.id || !this.ownsEditor) throw new Error("Reconnect the RC-10R before restoring its files.");
    await this.options.api.recover(this.id, backupId);
  }
  /** Manual release is possible only after Web MIDI observes the USB output disconnected. */
  async releaseDisconnected(): Promise<void> {
    if (this.output?.state !== "disconnected" || this.pending) throw new Error("Disconnect USB and press EXIT on the pedal first.");
    if (this.id) {
      await this.options.api.eject(this.id);
      await this.options.api.release(this.id);
      this.id = undefined;
    }
    this.ownsEditor = false;
    this.input?.removeEventListener("midimessage", this.receive);
    this.releaseStage?.();
    this.releaseStage = undefined;
  }
  async close(): Promise<void> {
    if (this.pending) throw new Error("Wait for the current acknowledgement, then retry disconnecting.");
    if (this.id) {
      if (this.ownsEditor) {
        // Never exit editor mode while the filesystem is mounted, even after a cancelled or failed write.
        await this.options.api.eject(this.id);
        await this.exchange("write", 0, 0, 0);
        this.ownsEditor = false;
      }
      await this.options.api.release(this.id);
      this.id = undefined;
    }
    this.input?.removeEventListener("midimessage", this.receive);
    this.releaseStage?.();
    this.releaseStage = undefined;
  }
}
