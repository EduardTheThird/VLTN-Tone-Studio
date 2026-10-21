import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PcmAudio } from '@/song/types';
import { lyricsLrc, type LyricSegment } from '@/song/performance/lyrics';
import { hasSignal } from '@/song/performance/sources';
import { host } from '@/host';

export function LyricsTrack({ audio, storageKey, time }: { audio?: PcmAudio; storageKey: string; time: number }) {
  const key = storageKey + ':lyrics';
  const [text, setText] = useState(() => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null), generation = useRef(0), activeLine = useRef<HTMLParagraphElement>(null);
  const available = useMemo(() => hasSignal(audio), [audio]);
  const lines = useMemo(() => text.split(/\r?\n/).flatMap(line => {
    const match = /^\[(\d+):([0-5]\d(?:\.\d+)?)\]\s*(.*)$/.exec(line);
    return match ? [{ time: Number(match[1]) * 60 + Number(match[2]), text: match[3] }] : [];
  }).sort((a, b) => a.time - b.time), [text]);
  const active = lines.findLastIndex(line => line.time <= time);
  useEffect(() => { activeLine.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [active]);
  const save = (value: string) => {
    setText(value);
    try { localStorage.setItem(key, value); } catch { setError('Could not save lyrics locally. Export them to keep a copy.'); }
  };
  const cancel = () => { generation.current++; worker.current?.terminate(); worker.current = null; setBusy(false); setStatus(''); };
  useEffect(() => { cancel(); return () => { generation.current++; worker.current?.terminate(); }; }, [audio]);
  const transcribe = async () => {
    if (!audio || !available || busy) return;
    const id = ++generation.current;
    setBusy(true); setError(''); setStatus('Preparing vocals…');
    try {
      // Web Audio resamples with an anti-aliasing filter; Whisper expects mono 16 kHz.
      const context = new OfflineAudioContext(1, Math.ceil(audio.channels[0].length * 16000 / audio.sampleRate), 16000);
      const buffer = context.createBuffer(audio.channels.length, audio.channels[0].length, audio.sampleRate);
      audio.channels.forEach((channel, i) => buffer.copyToChannel(new Float32Array(channel), i));
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();
      const pcm = (await context.startRendering()).getChannelData(0);
      if (id !== generation.current) return;
      const w = new Worker(new URL('../../song/performance/lyrics-worker.ts', import.meta.url), { type: 'module' });
      worker.current = w; setStatus('Loading lyrics model… First use downloads and caches the model.');
      const finish = () => { w.terminate(); worker.current = null; setBusy(false); };
      w.onmessage = (event: MessageEvent<{ status?: string; error?: string; segments?: LyricSegment[] }>) => {
        if (id !== generation.current) return;
        if (event.data.status) setStatus(event.data.status);
        if (event.data.error) { setError(event.data.error); setStatus(''); finish(); }
        if (event.data.segments) {
          if (event.data.segments.length) { save(lyricsLrc(event.data.segments)); setStatus('Lyrics ready. Review the words and timing while listening.'); }
          else setStatus('No words detected. You can import or type lyrics in the chart below.');
          finish();
        }
      };
      w.onerror = e => { if (id === generation.current) { setError(e.message); setStatus(''); finish(); } };
      w.postMessage(pcm, [pcm.buffer]);
    } catch (e) { if (id === generation.current) { setError(String(e)); setBusy(false); setStatus(''); } }
  };
  return <section aria-label="Lyrics text track" className="space-y-3 rounded border border-seam p-4">
    <h3 className="font-semibold">Lyrics text track · from vocals</h3>
    <p className="text-sm text-silkscreen-3">Generate timed words from the vocals stem. Transcription runs on this computer after a one-time model download; singing can be misheard. Your chart and MIDI cues are kept separately.</p>
    <div className="flex gap-3">
      <Button disabled={!available || busy} onClick={() => void transcribe()}>{text ? 'Regenerate lyrics' : 'Generate lyrics from vocals'}</Button>
      {busy && <Button variant="outline" onClick={cancel}>Cancel transcription</Button>}
      <Button variant="outline" disabled={!text} onClick={() => void host.song.saveFiles([{ name: 'lyrics.lrc', bytes: new TextEncoder().encode(text) }], 'Export lyrics text track').catch(e => setError(String(e)))}>Export lyrics</Button>
    </div>
    {!available && <p>Split the song to get a vocals stem with audio before generating lyrics.</p>}
    <p role="status">{status || (!text ? 'No lyrics yet. Generate them from vocals, or import a lyric chart below.' : '')}</p>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {!!text && <><div aria-label="Transcribed lyrics" className="max-h-64 overflow-auto text-2xl leading-relaxed">{lines.length ? lines.map((line, i) => <p key={i} ref={i === active ? activeLine : undefined} className={i === active ? 'rounded bg-white/10 font-bold' : 'text-silkscreen-3'}>{line.text}</p>) : <p className="whitespace-pre-wrap">{text}</p>}</div><details><summary>Edit transcribed words and timestamps</summary><textarea aria-label="Lyrics text track editor" className="min-h-48 w-full rounded border border-seam bg-transparent p-2 font-mono" disabled={busy} value={text} onChange={e => save(e.target.value)} /></details></>}
  </section>;
}
