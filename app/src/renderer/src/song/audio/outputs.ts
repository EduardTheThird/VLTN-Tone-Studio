import { SeparateClickOutput } from "./click-output";

// Routes the tracks and the click to output buses. A bus is a stereo channel pair on one device: the tracks might sit on outputs
// 1/2 and the click on 3/4 of a multichannel interface. The click can also use a second device of its own (a headphone jack for the
// in-ear click, say), and the aux buses are spare pairs for other tracks. When the device has fewer channels, or cannot be selected,
// backing audio falls back to a usable route. A click assigned to a private route is muted if that route is lost.
//
// The planning and the device lookup are pure functions. OutputRouter is the thin WebAudio adapter around them.

declare global {
  interface AudioContext {
    // Chromium 110 and later. The DOM typings this project builds against do not declare it yet.
    setSinkId(sinkId: string): Promise<void>;
  }
}

export const BUS_NAMES = ["main", "click", "aux1", "aux2"] as const;

export type BusName = (typeof BUS_NAMES)[number];

export const BUS_LABELS: Record<BusName, string> = { main: "Main", click: "Click", aux1: "Aux 1", aux2: "Aux 2" };

export interface Bus {
  /** Zero-based output pair, [0, 1] is outputs 1 and 2 */
  channels: [number, number];
  /** Linear gain, 0 to 2 */
  gain: number;
}

export interface OutputDevice {
  deviceId: string;
  label: string;
}

export interface ActiveOutputRoute {
  main: string;
  mainFallback?: boolean;
  click: string;
  clickMuted: boolean;
  warnings: string[];
}

export interface OutputConfig {
  /** The main device. "" is the system default. */
  deviceId: string;
  /** The main device's label, so a saved device can be found again when its ID changes */
  label: string;
  /** A device of its own for the click, or null to share the main device */
  clickDevice: OutputDevice | null;
  buses: Record<BusName, Bus>;
}

/** Calls `value` for each bus, in BUS_NAMES order. */
function busRecord<T>(value: (name: BusName) => T): Record<BusName, T> {
  return Object.fromEntries(BUS_NAMES.map((name) => [name, value(name)])) as Record<BusName, T>;
}

export const DEFAULT_OUTPUTS: OutputConfig = {
  deviceId: "",
  label: "",
  clickDevice: null,
  buses: busRecord((): Bus => ({ channels: [0, 1], gain: 1 })),
};

export function separateClickPair(config: OutputConfig): boolean {
  return config.buses.click.channels[0] !== config.buses.main.channels[0];
}

function hasPair([left, right]: [number, number], available: number): boolean {
  return Number.isInteger(left) && left >= 0 && right === left + 1 && right < available;
}

function pairLabel([left, right]: [number, number]): string {
  return `${left + 1}/${right + 1}`;
}

const SETTINGS_KEY = "vltn.performance.outputs.v1";

export interface RoutePlan {
  /** Channels the destination needs. Ignored when `multichannel` is false. */
  outputs: number;
  /** False means every bus connects straight to the stereo destination */
  multichannel: boolean;
  buses: Record<BusName, [number, number]>;
  /** Set when a requested pair does not exist on the device, so every bus uses outputs 1/2 */
  fellBack: boolean;
}

/** `gain` kept between 0 and 2. Anything that is not a number is silence. */
export function clampGain(gain: number): number {
  if (!Number.isFinite(gain)) return 0;
  return Math.max(0, Math.min(2, gain));
}

/** Every bus on outputs 1/2 of the main device, and the click on the main device too. Used when a device cannot be selected. */
export function stereoOnly(config: OutputConfig): OutputConfig {
  return { ...config, clickDevice: null, buses: busRecord((name): Bus => ({ ...config.buses[name], channels: [0, 1] })) };
}

/**
 * The channel layout for `config` on a device with `maxChannels` outputs. A pair must be two neighbouring outputs that the device
 * has. If any bus asks for a pair the device lacks, every bus falls back to outputs 1/2.
 */
export function planRoutes(config: OutputConfig, maxChannels = 2): RoutePlan {
  const available = Math.max(2, maxChannels);
  const pairs = BUS_NAMES.map((name) => config.buses[name].channels);
  const stereo = busRecord((): [number, number] => [0, 1]);
  const valid = pairs.every((pair) => hasPair(pair, available));
  if (!valid) return { outputs: 2, multichannel: false, buses: stereo, fellBack: true };
  const top = Math.max(...pairs.map(([, right]) => right));
  if (top < 2) return { outputs: 2, multichannel: false, buses: stereo, fellBack: false };
  return { outputs: available, multichannel: true, buses: busRecord((name) => config.buses[name].channels), fellBack: false };
}

/**
 * The device ID to use for `config`, given the devices the system lists. "" is the default output. A saved device keeps its ID when it is
 * still there, else the first device with the same label. Returns null when the device is gone.
 */
export function resolveDeviceId(config: OutputDevice, devices: OutputDevice[]): string | null {
  if (!config.deviceId) return "";
  if (devices.some((device) => device.deviceId === config.deviceId)) return config.deviceId;
  const matches = config.label ? devices.filter((device) => device.label === config.label) : [];
  return matches.length === 1 ? matches[0].deviceId : null;
}

function readBus(bus: Partial<Bus> | undefined, fallback: Bus): Bus {
  if (!bus || !Array.isArray(bus.channels) || bus.channels.length !== 2 || typeof bus.gain !== "number") return fallback;
  const [left, right] = bus.channels;
  return { channels: [left, right], gain: clampGain(bus.gain) };
}

function readDevice(device: Partial<OutputDevice> | null | undefined): OutputDevice | null {
  if (!device || typeof device.deviceId !== "string" || !device.deviceId) return null;
  return { deviceId: device.deviceId, label: typeof device.label === "string" ? device.label : "" };
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
      clickDevice: readDevice(saved.clickDevice),
      buses: busRecord((name) => readBus(saved.buses?.[name], DEFAULT_OUTPUTS.buses[name])),
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
export async function listOutputDevices(): Promise<OutputDevice[] | null> {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.enumerateDevices) return null;
  try {
    const devices = await mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "audiooutput").map((device) => ({ deviceId: device.deviceId, label: device.label }));
  } catch {
    return null;
  }
}

/** Where a click goes: its context, its bus, and how to turn a main-clock time into that context's time. */
export interface ClickTarget {
  ctx: AudioContext;
  bus: GainNode;
  localTime: (time: number) => number;
}

/** What is wired right now. Re-routing happens only when this changes. */
function routeKey(mainId: string | null, clickId: string | null, config: OutputConfig): string {
  return JSON.stringify([mainId, clickId, BUS_NAMES.map((name) => config.buses[name].channels)]);
}

/**
 * Connects the buses to the main AudioContext's destination. `main`, `aux1` and `aux2` (and `click`, unless it has its own device) are
 * stereo gain nodes that the player feeds. They join a ChannelMergerNode when the device has a channel pair past 1/2, else they go
 * straight to the destination.
 */
export class OutputRouter {
  readonly buses: Record<BusName, GainNode>;
  private levelTest: AudioBufferSourceNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private click: SeparateClickOutput | null = null;
  private config = DEFAULT_OUTPUTS;
  /** The route key that is wired now. An empty string means the last attempt failed, so the next attempt tries again. */
  private applied = "";
  private selectedSink: string | null = null;
  private active: ActiveOutputRoute | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly onDeviceChange = () => {
    if (this.config.clickDevice || separateClickPair(this.config)) {
      const { ctx, bus } = this.clickTarget();
      bus.gain.setValueAtTime(0, ctx.currentTime);
    }
    void this.apply(this.config);
  };

  constructor(
    private readonly ctx: AudioContext,
    private readonly warn: (message: string) => void,
    private readonly onRoute?: (route: ActiveOutputRoute) => void,
  ) {
    this.buses = busRecord(() => {
      // Always stereo, so a mono click still has a right channel to send to a multichannel output.
      const bus = ctx.createGain();
      bus.channelCount = 2;
      bus.channelCountMode = "explicit";
      bus.channelInterpretation = "speakers";
      return bus;
    });
    this.wire(planRoutes(DEFAULT_OUTPUTS), false);
    globalThis.navigator?.mediaDevices?.addEventListener?.("devicechange", this.onDeviceChange);
  }

  /** Channels the main device reports. A stereo device, or one that reports nothing, has two. */
  get channels(): number {
    return this.ctx.destination.maxChannelCount || 2;
  }

  /** Applies `config`. Calls run one after another, so a device change cannot overlap a selection. */
  apply(config: OutputConfig): Promise<void> {
    if (config !== this.config && (config.clickDevice || separateClickPair(config))) {
      this.buses.click.gain.setValueAtTime(0, this.ctx.currentTime);
    }
    this.config = config;
    this.queue = this.queue.then(() => this.route(config)).catch((error) => {
      this.buses.click.disconnect();
      void this.closeClick();
      this.publish({
        main: "Unverified",
        click: "Muted",
        clickMuted: true,
        warnings: [`The audio outputs could not be set. ${String(error)}`],
      });
    });
    return this.queue;
  }

  /** Resumes the main context and, when the click has its own device, that context too. */
  async resume(): Promise<void> {
    await this.ctx.resume();
    await this.click?.resume();
  }

  /** Where a click goes: the click's own device when it has one, else the main click bus. */
  clickTarget(): ClickTarget {
    const click = this.click;
    if (click) return { ctx: click.ctx, bus: click.bus, localTime: (time) => click.localTime(time) };
    return { ctx: this.ctx, bus: this.buses.click, localTime: (time) => time };
  }

  /** A short tone on one bus only, so each output can be checked. */
  testTone(name: BusName): void {
    const { ctx, bus } = name === "click" ? this.clickTarget() : { ctx: this.ctx, bus: this.buses[name] };
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + 0.05;
    osc.frequency.setValueAtTime(880, start);
    gain.gain.setValueAtTime(0.25, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
    osc.connect(gain).connect(bus);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(start);
    osc.stop(start + 0.5);
    void ctx.resume();
  }

  /** Plays two seconds of calibrated pink noise through the main bus at its configured gain. */
  testMainLevel(): void {
    if (this.levelTest || !this.active || this.active.main === "Unverified") return;
    const { ctx } = this;
    const noise = pinkNoise(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, noise.length, ctx.sampleRate);
    buffer.getChannelData(0).set(noise);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.buses.main);
    this.levelTest = source;
    const clear = () => {
      source.disconnect();
      if (this.levelTest === source) this.levelTest = null;
    };
    source.onended = clear;
    void ctx.resume().then(() => source.start()).catch(clear);
  }

  dispose(): void {
    globalThis.navigator?.mediaDevices?.removeEventListener?.("devicechange", this.onDeviceChange);
    void this.closeClick();
  }

  private async route(config: OutputConfig): Promise<void> {
    const devices = await listOutputDevices();
    const resolve = (device: OutputDevice): string | null => (devices ? resolveDeviceId(device, devices) : device.deviceId);
    const mainId = resolve(config);
    const clickId = config.clickDevice ? resolve(config.clickDevice) : null;
    // Changes that only move a gain, or an unrelated device appearing, leave the sinks alone.
    const defaultLabel = devices?.find(({ deviceId }) => deviceId === "default")?.label ?? "";
    const key = routeKey(mainId, clickId, config) + defaultLabel;
    if (this.applied === `${key}:${this.channels}`) {
      this.setGains(config);
      return;
    }
    this.applied = "";
    // Disconnect the old click graph before changing the main sink. A multichannel graph can be folded down when the sink changes.
    this.buses.click.disconnect();
    const warnings: string[] = [];
    const mainSelected = mainId !== null && (await this.selectSink(mainId));
    const defaultSelected = mainSelected || (await this.selectSink(""));
    if (!mainSelected) {
      warnings.push(`"${config.label || config.deviceId || "System default"}" is unavailable. ${defaultSelected ? "Backing uses the system default output." : "The default output could not be selected."}`);
    }

    const available = this.channels;
    const effective = mainSelected ? config : stereoOnly(config);
    const routed = {
      ...effective,
      buses: busRecord((name) => {
        const bus = effective.buses[name];
        if (name === "click" && config.clickDevice) return DEFAULT_OUTPUTS.buses.click;
        if (hasPair(bus.channels, available)) return bus;
        if (name !== "click") warnings.push(`${BUS_LABELS[name]} outputs ${pairLabel(bus.channels)} are unavailable. Using 1/2.`);
        return { ...bus, channels: [0, 1] as [number, number] };
      }),
    };
    const plan = planRoutes(routed, available);
    const privatePair = !config.clickDevice && separateClickPair(config);
    const overlapsBacking = plan.buses.main.some((channel) => plan.buses.click.includes(channel));
    const failedPair = privatePair && (!mainSelected || !hasPair(config.buses.click.channels, available) || overlapsBacking);
    const actualMainId = mainSelected ? mainId : "";
    // Chromium can list the same physical endpoint as both "default" and a named output.
    const deviceName = (id: string) => devices?.find((device) => device.deviceId === (id || "default"))?.label.replace(/^Default - /i, "");
    const mainDeviceName = deviceName(actualMainId ?? "");
    const clickSharesDevice = !!config.clickDevice && clickId !== null && (
      actualMainId === clickId ||
      ((!actualMainId || actualMainId === "default" || clickId === "default") && !!mainDeviceName && mainDeviceName === deviceName(clickId))
    );
    const separate = await this.openClick(clickSharesDevice ? null : config.clickDevice, clickId);
    const mute = failedPair || (!!config.clickDevice && !separate) || !defaultSelected;
    if (failedPair) warnings.push(`Private click outputs ${pairLabel(config.buses.click.channels)} are unavailable or shared with backing. Click muted.`);
    if (config.clickDevice && !separate) warnings.push(`"${config.clickDevice.label || config.clickDevice.deviceId}" cannot be used as a separate click output. Click muted.`);
    if (!privatePair && !config.clickDevice) {
      // An intentional shared click follows Main even if Main's requested pair changed.
      plan.buses.click = plan.buses.main;
    }
    if (mute && separate) await this.closeClick();
    this.wire(plan, separate || mute);
    this.setGains(config);
    const main = defaultSelected
      ? `${(mainSelected && mainId && (deviceName(mainId) || config.label || mainId)) || "System default"} · ${pairLabel(plan.buses.main)}`
      : "Unverified";
    this.publish({
      main,
      mainFallback: !mainSelected && defaultSelected,
      click: mute ? "Muted" : separate ? `${config.clickDevice?.label || clickId} · 1/2` : `${privatePair ? "Separate pair" : "Main"} · ${pairLabel(plan.buses.click)}`,
      clickMuted: mute,
      warnings,
    });
    // Failed sink selections can be retried. Missing devices change the route key when they come back.
    if (defaultSelected && (mainSelected || mainId === null) && (separate || clickId === null || clickSharesDevice)) this.applied = `${key}:${available}`;
  }

  get activeRoute(): ActiveOutputRoute | null {
    return this.active;
  }

  private publish(route: ActiveOutputRoute): void {
    const previous = this.active;
    this.active = route;
    this.onRoute?.(route);
    for (const warning of route.warnings) if (!previous?.warnings.includes(warning)) this.warn(warning);
  }

  /** Opens, keeps or closes the click's own device. Returns true when the click is on that device. */
  private async openClick(device: OutputDevice | null, deviceId: string | null): Promise<boolean> {
    if (!device || deviceId === null) {
      await this.closeClick();
      return false;
    }
    if (this.click?.deviceId === deviceId) return true;
    await this.closeClick();
    try {
      this.click = await SeparateClickOutput.open(this.ctx, deviceId);
      if (this.ctx.state === "running") void this.click.resume().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  private async closeClick(): Promise<void> {
    const click = this.click;
    this.click = null;
    await click?.dispose();
  }

  private async selectSink(deviceId: string): Promise<boolean> {
    if (typeof this.ctx.setSinkId !== "function") return deviceId === "";
    if (this.selectedSink === deviceId) return true;
    try {
      await this.ctx.setSinkId(deviceId);
      this.selectedSink = deviceId;
      return true;
    } catch {
      return false;
    }
  }

  private setGains(config: OutputConfig): void {
    for (const name of BUS_NAMES) {
      const { ctx, bus } = name === "click" ? this.clickTarget() : { ctx: this.ctx, bus: this.buses[name] };
      bus.gain.setValueAtTime(clampGain(config.buses[name].gain), ctx.currentTime);
    }
  }

  /** Connects every bus that stays on the main device. The click is left out when it has its own device. */
  private wire(plan: RoutePlan, separateClick: boolean): void {
    const destination = this.ctx.destination;
    const names = BUS_NAMES.filter((name) => !(separateClick && name === "click"));
    for (const name of BUS_NAMES) this.buses[name].disconnect();
    this.merger?.disconnect();
    this.merger = null;
    destination.channelCount = plan.outputs;
    if (!plan.multichannel) {
      destination.channelInterpretation = "speakers";
      for (const name of names) this.buses[name].connect(destination);
      return;
    }
    // "discrete" maps merger input N to output N, instead of speaker-layout mixing that would fold 3/4 back onto 1/2.
    destination.channelInterpretation = "discrete";
    const merger = this.ctx.createChannelMerger(plan.outputs);
    for (const name of names) {
      const [left, right] = plan.buses[name];
      this.buses[name].connect(merger, 0, left);
      this.buses[name].connect(merger, 1, right);
    }
    merger.connect(destination);
    this.merger = merger;
  }
}

/** Paul Kellet's pinking filter, with short fades and a measured -18 dBFS RMS before Main's gain. */
export function pinkNoise(sampleRate: number, random = Math.random): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(sampleRate * 2);
  let slow = 0, mid = 0, fast = 0, energy = 0;
  const fade = Math.round(sampleRate * 0.025);
  for (let i = 0; i < samples.length; i++) {
    const white = random() * 2 - 1;
    slow = 0.99765 * slow + white * 0.099046;
    mid = 0.963 * mid + white * 0.2965164;
    fast = 0.57 * fast + white * 1.0526913;
    const amplitude = Math.min(1, i / fade, (samples.length - 1 - i) / fade);
    samples[i] = (slow + mid + fast + white * 0.1848) * amplitude;
    energy += samples[i] ** 2;
  }
  if (energy > 0) {
    const scale = 10 ** (-18 / 20) / Math.sqrt(energy / samples.length);
    for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  }
  return samples;
}
