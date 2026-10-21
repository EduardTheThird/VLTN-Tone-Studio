import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LyricsTrack } from './LyricsTrack';

vi.mock('@/host', () => ({ host: { song: { saveFiles: vi.fn() } } }));
class FakeWorker {
  static current: FakeWorker;
  onmessage?: (e: { data: unknown }) => void;
  onerror?: (e: { message: string }) => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { FakeWorker.current = this; }
}
const audio = { sampleRate: 16000, channels: [new Float32Array(16000).fill(0.2)] };
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('OfflineAudioContext', class {
    destination = {};
    createBuffer() { return { copyToChannel() {} }; }
    createBufferSource() { return { buffer: null, connect() {}, start() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array(16000) }; }
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('persists timed transcription separately from charts and follows playback', async () => {
  localStorage.setItem('song', '[00:00] [C] {midi:pc 1 0}');
  const view = render(<LyricsTrack audio={audio} storageKey="song" time={0} />);
  fireEvent.click(screen.getByText('Generate lyrics from vocals'));
  await waitFor(() => expect(FakeWorker.current.postMessage).toHaveBeenCalled());
  act(() => FakeWorker.current.onmessage?.({ data: { segments: [{ time: 0, text: 'First' }, { time: 2, text: 'Second' }] } }));
  expect(localStorage.getItem('song:lyrics')).toBe('[00:00.00] First\n[00:02.00] Second');
  expect(localStorage.getItem('song')).toBe('[00:00] [C] {midi:pc 1 0}');
  view.rerender(<LyricsTrack audio={audio} storageKey="song" time={2.1} />);
  expect(screen.getByText('Second').className).toContain('font-bold');
  expect(FakeWorker.current.terminate).toHaveBeenCalled();
});

it('cancels work and ignores late results without replacing saved lyrics', async () => {
  localStorage.setItem('song:lyrics', '[00:00.00] Existing');
  render(<LyricsTrack audio={audio} storageKey="song" time={0} />);
  fireEvent.click(screen.getByText('Regenerate lyrics'));
  await waitFor(() => expect(FakeWorker.current.postMessage).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Cancel transcription'));
  act(() => FakeWorker.current.onmessage?.({ data: { segments: [{ time: 0, text: 'Late' }] } }));
  expect(FakeWorker.current.terminate).toHaveBeenCalled();
  expect(localStorage.getItem('song:lyrics')).toBe('[00:00.00] Existing');
});
