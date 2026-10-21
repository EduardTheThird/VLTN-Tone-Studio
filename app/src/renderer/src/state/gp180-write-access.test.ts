import { afterEach, expect, it } from 'vitest';
import { getDriver, useDevice } from './device';
import type { Gp150Driver } from './driver/gp150-driver';

afterEach(async () => { await useDevice.getState().disconnect(); });
it.each(['webmidi', 'bluetooth'] as const)('uses the same memory-write gate as the %s transport', async mode => {
  await useDevice.getState().connect('mock', { mockDevice: 'gp180' });
  expect((getDriver() as Gp150Driver).mock).not.toBeNull();
  // Only the simulator transport exists; the mode exercises the real-hardware policy.
  useDevice.setState({ mode });
  useDevice.getState().setGp180WriteUnlocked(false);
  const preset = useDevice.getState().preset!.prst;
  await expect(useDevice.getState().writePreset(1, preset)).rejects.toThrow(/hasn't been tested/);
  useDevice.getState().setGp180WriteUnlocked(true);
  await useDevice.getState().writePreset(1, preset);
  expect(useDevice.getState().slot).toBe(1);
  useDevice.getState().setGp180WriteUnlocked(false);
  await expect(useDevice.getState().selectSlot(2)).rejects.toThrow(/read-only/i);
});
