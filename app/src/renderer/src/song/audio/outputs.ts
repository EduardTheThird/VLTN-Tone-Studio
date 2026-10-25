// Routes the tracks and the click to output buses. A bus is a stereo pair of channels on one device: the tracks might sit on outputs
// 1/2 and the click on 3/4 of a multichannel interface. When the device has fewer channels, or the device cannot be selected, both buses
// fall back to the default stereo output so audio never goes silent. The caller is told about the fallback.
//
// The planning and the device lookup are pure functions. OutputRouter is the thin WebAudio adapter around them.

declare global {
  interface AudioContext {
    // Chromium 110 and later. The DOM typings this project builds against do not declare it yet.
    setSinkId(sinkId: string): Promise<void>;
  }
}

export const BUS_NAMES = ["main", "click"] as const;

export type BusName = (typeof BUS_NAMES)[number];

export interface Bus {
  /** Zero-based output pair, [0, 1] is outputs 1 and 2 */
  channels: [number, number];
  /** Linear gain, 0 to 2 */
  gain: number;
}

export interface OutputConfig {
  /** The AudioContext sink. "" is the system default. */
  deviceId: string;
  /** The device's label, so a saved device can be found again when its ID changes */
  label: string;
  buses: Record<BusName, Bus>;
}

export const DEFAULT_OUTPUTS: OutputConfig = {
  deviceId: "",
  label: "",
  buses: { main: { channels: [0, 1], gain: 1 }, click: { channels: [0, 1], gain: 1 } },
};

const SETTINGS_KEY = "vltn.performance.outputs.v1";

export interface RoutePlan {
  /** Channels the destination needs. Ignored when `multichannel` is false. */
  outputs: number;
  /** False means both buses connect straight to the stereo destination */
  multichannel: boolean;
  buses: Record<BusName, [number, number]>;
  /** Set when a requested pair does not exist on the device, so every bus uses outputs 1/2 */
  fellBack: boolean;
}

export interface OutputDevice {
  deviceId: string;
  label: string;
}

/** `gain` kept between 0 and 2. Anything that is not a number is silence. */
export function clampGain(gain: number): number {
  if (!Number.isFinite(gain)) return 0;
  return Math.max(0, Math.min(2, gain));
}

/** Every bus on outputs 1/2 of the default device. Used when the device cannot be selected. */
export function stereoOnly(config: OutputConfig): OutputConfig {
  const buses = Object.fromEntries(BUS_NAMES.map((name) => [name, { ...config.buses[name], channels: [0, 1] }]));
  return { ...config, buses: buses as OutputConfig["buses"] };
}

/**
 * The channel layout for `config` on a device with `maxChannels` outputs. A pair must be two neighbouring outputs that the device
 * has. If any bus asks for a pair the device lacks, every bus falls back to outputs 1/2.
 */
export function planRoutes(config: OutputConfig, maxChannels = 2): RoutePlan {
  const available = Math.max(2, maxChannels);
  const pairs = BUS_NAMES.map((name) => config.buses[name].channels);
  const valid = pairs.every(([left, right]) => Number.isInteger(left) && left >= 0 && right === left + 1 && right < available);
  const stereo: Record<BusName, [number, number]> = { main: [0, 1], click: [0, 1] };
  if (!valid) return { outputs: 2, multichannel: false, buses: stereo, fellBack: true };
  const top = Math.max(...pairs.map(([, right]) => right));
  if (top < 2) return { outputs: 2, multichannel: false, buses: stereo, fellBack: false };
  return { outputs: available, multichannel: true, buses: { main: pairs[0], click: pairs[1] }, fellBack: false };
}

/**
 * The device ID to use for `config`, given the devices the system lists. "" is the default output. A saved device keeps its ID when it is
 * still there, else the first device with the same label. Returns null when the device is gone.
 */
export function resolveDeviceId(config: Pick<OutputConfig, "deviceId" | "label">, devices: OutputDevice[]): string | null {
  if (!config.deviceId) return "";
  if (devices.some((device) => device.deviceId === config.deviceId)) return config.deviceId;
  const byLabel = config.label ? devices.find((device) => device.label === config.label) : undefined;
  return byLabel?.deviceId ?? null;
}

function readBus(bus: Partial<Bus> | undefined, fallback: Bus): Bus {
  if (!bus || !Array.isArray(bus.channels) || bus.channels.length !== 2 || typeof bus.gain !== "number") return fallback;
  const [left, right] = bus.channels;
  return { channels: [left, right], gain: clampGain(bus.gain) };
}

/** The saved outputs, or the defaults when nothing usable is stored. */
export function loadOutputSettings(storage: Storage | null): OutputConfig {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_OUTPUTS;
    const saved = JSON.parse(raw) as Partial<OutputConfig>;
    return {
      deviceId: typeof saved.deviceId === "string" ? saved.deviceId : "",
      label: typeof saved.label === "string" ? saved.label : "",
      buses: {
        main: readBus(saved.buses?.main, DEFAULT_OUTPUTS.buses.main),
        click: readBus(saved.buses?.click, DEFAULT_OUTPUTS.buses.click),
      },
    };
  } catch {
    return DEFAULT_OUTPUTS;
  }
}

/** Saves the outputs. Storage can be full or blocked, and the audio must not depend on it, so a failure is ignored. */
export function saveOutputSettings(storage: Storage | null, config: OutputConfig): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(config));
  } catch {
    // Keep the settings in memory for this session.
  }
}

/** The system's audio outputs, or null when the platform cannot list them. */
async function listOutputDevices(): Promise<OutputDevice[] | null> {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.enumerateDevices) return null;
  try {
    const devices = await mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "audiooutput");
  } catch {
    return null;
  }
}

/**
 * Connects the buses to the AudioContext's destination. `main` and `click` are stereo gain nodes that the player feeds. Both connect
 * to a ChannelMergerNode when the device has a channel pair past 1/2, else straight to the destination.
 */
export class OutputRouter {
  readonly buses: Record<BusName, GainNode>;
  private merger: ChannelMergerNode | null = null;
  private config = DEFAULT_OUTPUTS;
  private queue: Promise<void> = Promise.resolve();
  private readonly onDeviceChange = () => void this.apply(this.config);

  constructor(
    private readonly ctx: AudioContext,
    private readonly warn: (message: string) => void,
  ) {
    this.buses = Object.fromEntries(
      BUS_NAMES.map((name) => {
        // Always stereo, so a mono click still has a right channel to send to a multichannel output.
        const bus = ctx.createGain();
        bus.channelCount = 2;
        bus.channelCountMode = "explicit";
        bus.channelInterpretation = "speakers";
        return [name, bus];
      }),
    ) as Record<BusName, GainNode>;
    this.wire(planRoutes(DEFAULT_OUTPUTS));
    globalThis.navigator?.mediaDevices?.addEventListener?.("devicechange", this.onDeviceChange);
  }

  /** Applies `config`. Calls run one after another, so a device change cannot overlap a selection. */
  apply(config: OutputConfig): Promise<void> {
    this.config = config;
    this.queue = this.queue.then(() => this.route(config));
    return this.queue;
  }

  dispose(): void {
    globalThis.navigator?.mediaDevices?.removeEventListener?.("devicechange", this.onDeviceChange);
  }

  private async route(config: OutputConfig): Promise<void> {
    this.setGains(config);
    const devices = await listOutputDevices();
    const deviceId = devices ? resolveDeviceId(config, devices) : config.deviceId;
    if (deviceId !== null && (await this.selectSink(deviceId))) {
      const plan = planRoutes(config, this.ctx.destination.maxChannelCount);
      if (plan.fellBack) this.warn("This output does not have the channels set for the click or tracks. Both use outputs 1 and 2.");
      this.wire(plan);
      return;
    }
    this.warn(`"${config.label || config.deviceId || "The audio output"}" is not available. Audio is playing on the default output.`);
    await this.selectSink("");
    this.wire(planRoutes(stereoOnly(config)));
  }

  private async selectSink(deviceId: string): Promise<boolean> {
    try {
      await this.ctx.setSinkId(deviceId);
      return true;
    } catch {
      return false;
    }
  }

  private setGains(config: OutputConfig): void {
    for (const name of BUS_NAMES) this.buses[name].gain.setValueAtTime(clampGain(config.buses[name].gain), this.ctx.currentTime);
  }

  private wire(plan: RoutePlan): void {
    const destination = this.ctx.destination;
    for (const name of BUS_NAMES) this.buses[name].disconnect();
    this.merger?.disconnect();
    this.merger = null;
    destination.channelCount = plan.outputs;
    if (!plan.multichannel) {
      destination.channelInterpretation = "speakers";
      for (const name of BUS_NAMES) this.buses[name].connect(destination);
      return;
    }
    // "discrete" maps merger input N to output N, instead of speaker-layout mixing that would fold 3/4 back onto 1/2.
    destination.channelInterpretation = "discrete";
    const merger = this.ctx.createChannelMerger(plan.outputs);
    for (const name of BUS_NAMES) {
      const [left, right] = plan.buses[name];
      this.buses[name].connect(merger, 0, left);
      this.buses[name].connect(merger, 1, right);
    }
    merger.connect(destination);
    this.merger = merger;
  }
}
