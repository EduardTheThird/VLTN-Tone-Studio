import { create } from 'zustand';
import { BleMidiDecoder, encodeBleMidi, MIDI_CHARACTERISTIC, MIDI_SERVICE } from './ble-midi';

// Narrow Web Bluetooth types: not yet part of TypeScript's DOM library.
interface Characteristic extends EventTarget {
  value?: DataView;
  properties: { write: boolean; writeWithoutResponse: boolean; notify: boolean; indicate: boolean };
  startNotifications(): Promise<Characteristic>;
  stopNotifications(): Promise<Characteristic>;
  writeValueWithResponse(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  writeValueWithoutResponse(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
}
export interface BleDevice extends EventTarget {
  id: string; name?: string;
  gatt?: { connected: boolean; connect(): Promise<{ getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<Characteristic> }> }>; disconnect(): void };
}
interface BluetoothApi { requestDevice(options: { filters: ({ services: string[] } | { namePrefix: string })[]; optionalServices: string[] }): Promise<BleDevice> }
type Listener = (bytes: Uint8Array) => void;
export const useBluetooth = create<{ connection: BleMidiConnection | null; connecting: boolean; error: string | null }>(() => ({ connection: null, connecting: false, error: null }));

export class BleMidiConnection {
  readonly id = 'bluetooth-midi';
  get name() { return this.device.name || 'Bluetooth MIDI'; }
  get state(): 'connected' | 'disconnected' { return !this.closed && this.device.gatt?.connected ? 'connected' : 'disconnected'; }
  private closed = false;
  private chain: Promise<void> = Promise.resolve();
  private listeners = new Set<Listener>();
  private disconnectListeners = new Set<() => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private generation = 0;
  private queued = 0;
  private decoder = new BleMidiDecoder();
  private constructor(readonly device: BleDevice, private characteristic: Characteristic) {}
  static async open(device: BleDevice): Promise<BleMidiConnection> {
    try {
      const server = await device.gatt?.connect();
      if (!server) throw new Error('The selected device has no Bluetooth GATT server.');
      const service = await server.getPrimaryService(MIDI_SERVICE);
      const characteristic = await service.getCharacteristic(MIDI_CHARACTERISTIC);
      if ((!characteristic.properties.notify && !characteristic.properties.indicate) || (!characteristic.properties.write && !characteristic.properties.writeWithoutResponse)) throw new Error('This MIDI characteristic cannot send and receive data.');
      const connection = new BleMidiConnection(device, characteristic);
      characteristic.addEventListener('characteristicvaluechanged', connection.receive);
      device.addEventListener('gattserverdisconnected', connection.lost);
      try { await characteristic.startNotifications(); }
      catch (e) { connection.close(); throw e; }
      return connection;
    } catch (e) { device.gatt?.disconnect(); throw e; }
  }
  private receive = () => {
    const value = this.characteristic.value;
    if (!value || this.closed) return;
    for (const message of this.decoder.decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))) {
      for (const listener of this.listeners) listener(message);
    }
  };
  private lost = () => {
    if (this.closed) return;
    this.closed = true; this.clear(); this.decoder.reset();
    this.characteristic.removeEventListener('characteristicvaluechanged', this.receive);
    this.device.removeEventListener('gattserverdisconnected', this.lost);
    if (useBluetooth.getState().connection === this) useBluetooth.setState({ connection: null });
    for (const listener of this.disconnectListeners) listener();
    this.listeners.clear(); this.disconnectListeners.clear();
  };
  subscribe(listener: Listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onDisconnect(listener: () => void) { this.disconnectListeners.add(listener); return () => { this.disconnectListeners.delete(listener); }; }
  /** Queued GATT writes never overlap; a write failure closes the session and is visible in the UI. */
  send(bytes: readonly number[] | Uint8Array, timestamp = performance.now(), editor = false) {
    if (this.state !== 'connected') throw new Error('Bluetooth MIDI is disconnected.');
    const packets = encodeBleMidi(bytes, timestamp);
    const generation = this.generation;
    const enqueue = () => {
      if (this.queued >= 256) { useBluetooth.setState({ error: 'Bluetooth MIDI cannot keep up. Connection closed; reduce MIDI traffic.' }); this.close(); return; }
      this.queued++;
      this.chain = this.chain.then(async () => {
        if (this.closed || (!editor && generation !== this.generation)) return;
        for (const packet of packets) {
          // Once started, complete the message so clear() cannot leave a partial SysEx.
          if (this.closed) return;
          if (this.characteristic.properties.writeWithoutResponse) await this.characteristic.writeValueWithoutResponse(packet as Uint8Array<ArrayBuffer>);
          else await this.characteristic.writeValueWithResponse(packet as Uint8Array<ArrayBuffer>);
        }
      }).catch(e => { useBluetooth.setState({ error: `Bluetooth write failed: ${String(e)}` }); this.close(); }).finally(() => { this.queued--; });
    };
    const delay = timestamp - performance.now();
    if (delay <= 1) enqueue();
    else { const timer = setTimeout(() => { this.timers.delete(timer); if (!this.closed && generation === this.generation) enqueue(); }, delay); this.timers.add(timer); }
  }
  clear() { this.generation++; for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); }
  close() {
    if (this.closed) return;
    this.lost();
    this.device.gatt?.disconnect();
  }
}

/** Invoke directly from a click: browsers require transient user activation for the chooser. */
export async function connectBluetooth(): Promise<BleMidiConnection> {
  const current = useBluetooth.getState();
  if (current.connection?.state === 'connected') return current.connection;
  if (current.connecting) throw new Error('Bluetooth selection is already in progress.');
  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth;
  if (!bluetooth) throw new Error('Web Bluetooth is unavailable. Use the desktop app or Chrome/Edge with a Bluetooth adapter.');
  useBluetooth.setState({ connecting: true, error: null });
  try {
    const device = await bluetooth.requestDevice({ filters: [{ services: [MIDI_SERVICE] }, { namePrefix: 'GP-180' }, { namePrefix: 'GP180' }, { namePrefix: 'Valeton' }], optionalServices: [MIDI_SERVICE] });
    const connection = await BleMidiConnection.open(device);
    useBluetooth.setState({ connection });
    return connection;
  } catch (e) {
    useBluetooth.setState({ error: `Bluetooth connection failed: ${e instanceof Error ? e.message : String(e)}` });
    throw e;
  } finally { useBluetooth.setState({ connecting: false }); }
}
