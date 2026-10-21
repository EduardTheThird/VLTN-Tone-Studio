import { describe, expect, it } from 'vitest';
import { assertReadOnlyFrame } from '../gp150/lib/read-only.mjs';
import { CMD, ack, hello, packetize, query, readPatch, setParam, setBlockOn } from '../gp150/lib/protocol.mjs';
import { Gp150Driver } from '../state/driver/gp150-driver';
describe('GP-180 hardware read-only boundary', () => {
  it('applies and revokes explicit write access on an existing connection', async () => {
    const driver = await Gp150Driver.simulate('gp180', { readOnly: true, log: () => {}, onDisconnect: () => {} });
    try {
      await driver.sync();
      await expect(driver.select(1)).rejects.toThrow(/read-only/i);
      driver.setReadOnly(false);
      await driver.select(1);
      driver.setReadOnly(true);
      await expect(driver.select(2)).rejects.toThrow(/read-only/i);
    } finally { await driver.close(); }
  });
  it('allows a complete inspection but blocks selecting a preset at the driver boundary', async () => {
    const driver = await Gp150Driver.simulate('gp180', { readOnly: true, log: () => {}, onDisconnect: () => {} });
    try {
      const snapshot = await driver.sync();
      expect(snapshot.device).toBe('gp180');
      expect(snapshot.names).toHaveLength(200);
      expect(snapshot.prst.length).toBeGreaterThan(0);
      await expect(driver.select(1)).rejects.toThrow(/read-only/i);
    } finally { await driver.close(); }
  });
  it('allows only known queries and acknowledgements', () => {
    for (const bytes of [hello(), ack(1), ...packetize(query(CMD.STATE), 1), ...packetize(query(CMD.GLOBALS), 2), ...packetize(readPatch(199, false), 3)]) expect(() => assertReadOnlyFrame(bytes)).not.toThrow();
  });
  it('rejects patch selection, parameter changes, toggles and unknown queries', () => {
    for (const msg of [readPatch(0, true), setParam(0,0,0,1), setBlockOn(0,true), query(CMD.DEVICE_ID)]) {
      for (const bytes of packetize(msg,1)) expect(() => assertReadOnlyFrame(bytes)).toThrow();
    }
    expect(() => assertReadOnlyFrame(Uint8Array.from([0xc0,1]))).toThrow();
  });
});
