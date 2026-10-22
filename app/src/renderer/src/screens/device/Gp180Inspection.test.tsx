import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Gp180Inspection } from './Gp180Inspection';
import { writesLocked } from '@/state/device-model';
const data = vi.hoisted(() => ({ device: 'gp200', mode: 'webmidi', status: 'connected', preset: null, busy: null, gp180WriteUnlocked: false, setGp180WriteUnlocked: vi.fn() }));
vi.mock('@/state/device', () => ({ useDevice: (select: (s: unknown) => unknown) => select(data) }));
vi.mock('./settings-store', () => ({ useAppSettings: () => ({settings:{gp180WriteUnlocked: false}, patch:vi.fn()}) }));
vi.mock('@/app/notify', () => ({ notifyError: vi.fn() }));
afterEach(cleanup);
it('shows inspection only for GP-180 connections', () => {
  const view = render(<Gp180Inspection />);
  expect(screen.queryByLabelText('Unlock GP-180 writes')).toBeNull();
  data.device = 'gp180'; view.rerender(<Gp180Inspection />);
  expect(screen.getByLabelText('Unlock GP-180 writes')).toBeTruthy();
});
it('uses explicit GP-180 session access for either transport while other supported pedals remain writable', () => {
  for (const mode of ['webmidi', 'bluetooth'] as const) {
    expect(writesLocked('gp180', mode, false)).toBe(true);
    expect(writesLocked('gp180', mode, true)).toBe(false);
    expect(writesLocked('gp150', mode, true)).toBe(false);
    expect(writesLocked('gp200lt', mode, true)).toBe(false);
  }
});
