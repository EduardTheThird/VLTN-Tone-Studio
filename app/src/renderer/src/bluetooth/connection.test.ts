import { afterEach, describe, expect, it, vi } from 'vitest';
import { BleMidiConnection, type BleDevice, useBluetooth } from './connection';
import { BleMidiDecoder } from './ble-midi';

function fixture() {
  const characteristic = Object.assign(new EventTarget(), {
    value: undefined as DataView | undefined,
    properties: { write: true, writeWithoutResponse: true, notify: true, indicate: false },
    startNotifications: vi.fn(async () => characteristic), stopNotifications: vi.fn(async () => characteristic),
    writeValueWithResponse: vi.fn(async (_bytes: Uint8Array) => {}),
    writeValueWithoutResponse: vi.fn(async (_bytes: Uint8Array) => {}),
  });
  const gatt = { connected: true, connect: vi.fn(async () => ({ getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) })), disconnect: vi.fn(() => { gatt.connected = false; }) };
  const device: BleDevice = Object.assign(new EventTarget(), { id: 'test', name: 'GP-180', gatt });
  return { device, gatt, characteristic };
}
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => { useBluetooth.getState().connection?.close(); useBluetooth.setState({ connection: null, error: null }); vi.useRealTimers(); });
describe('Bluetooth connection lifecycle', () => {
  it('finishes an in-flight SysEx when clearing pending performance cues', async () => {
    const f = fixture(), connection = await BleMidiConnection.open(f.device);
    const message = [0xf0, ...Array(80).fill(1), 0xf7];
    f.characteristic.writeValueWithoutResponse.mockImplementationOnce(async () => { connection.clear(); });
    connection.send(message); connection.send([0xc0,3]); await settle();
    const decoder = new BleMidiDecoder();
    expect(f.characteristic.writeValueWithoutResponse.mock.calls.flatMap(([b]) => decoder.decode(b)).map(b => [...b])).toEqual([message]);
    connection.close();
  });
  it('serializes fragmented writes, delivers MIDI and releases listeners on disconnect', async () => {
    const f = fixture(), connection = await BleMidiConnection.open(f.device);
    useBluetooth.setState({ connection });
    const received = vi.fn(), lost = vi.fn(); connection.subscribe(received); connection.onDisconnect(lost);
    const message = [0xf0, ...Array(80).fill(1), 0xf7];
    connection.send(message); connection.send([0xc0,3]); await settle();
    const decoder = new BleMidiDecoder();
    expect(f.characteristic.writeValueWithoutResponse.mock.calls.flatMap(([b]) => decoder.decode(b)).map(b => [...b])).toEqual([message,[0xc0,3]]);
    f.characteristic.value = new DataView(Uint8Array.from([0x80,0x80,0xb0,80,127]).buffer);
    f.characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    expect([...received.mock.calls[0][0]]).toEqual([0xb0,80,127]);
    f.device.dispatchEvent(new Event('gattserverdisconnected'));
    f.characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    expect(received).toHaveBeenCalledTimes(1); expect(lost).toHaveBeenCalledTimes(1);
    expect(useBluetooth.getState().connection).toBeNull(); expect(() => connection.send([0xf8])).toThrow();
  });
  it('clears future performance messages without cancelling editor requests', async () => {
    vi.useFakeTimers();
    const f = fixture(), connection = await BleMidiConnection.open(f.device);
    connection.send([0xc0,1], performance.now() + 1000);
    connection.send([0xc0,2], performance.now(), true);
    connection.clear(); await vi.advanceTimersByTimeAsync(1100); await settle();
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
    expect([...f.characteristic.writeValueWithoutResponse.mock.calls[0][0]].slice(-2)).toEqual([0xc0,2]);
    connection.close();
  });
  it('reports a failed write and closes the GATT connection', async () => {
    const f = fixture(), connection = await BleMidiConnection.open(f.device);
    f.characteristic.writeValueWithoutResponse.mockRejectedValueOnce(new Error('radio lost'));
    connection.send([0xf8]); await settle();
    expect(connection.state).toBe('disconnected'); expect(f.gatt.disconnect).toHaveBeenCalledOnce();
    expect(useBluetooth.getState().error).toContain('radio lost');
  });
  it('disconnects if notifications fail during setup', async () => {
    const f = fixture(); f.characteristic.startNotifications.mockRejectedValueOnce(new Error('denied'));
    await expect(BleMidiConnection.open(f.device)).rejects.toThrow('denied');
    expect(f.gatt.disconnect).toHaveBeenCalled();
  });
});
