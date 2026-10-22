import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSong } from '@/song/store';
import { useDevice } from '@/state/device';
import { StemPlayer } from '@/song/stems/player';
import { defaultMix } from '@/song/stems/mix';
import { lrcTime, parseChart, scheduleCues, transpose } from '@/song/performance/chart';
import type { Chord } from '@/song/performance/chords';
import { Rhythm } from '@/song/performance/rhythm';
import { host } from '@/host';
import { useBluetooth } from '@/bluetooth/connection';
import { BluetoothControls } from '@/bluetooth/BluetoothControls';
import { LyricsTrack } from './LyricsTrack';
import { PerformanceReader } from './PerformanceReader';
import { ChordVoicings } from './ChordVoicings';
import { MidiCueBuilder } from './MidiCueBuilder';
import { defaultChordSource } from '@/song/performance/sources';
import { STEM_NAMES, type StemName } from '@/song/types';
import { performanceKey, readOptions } from '@/song/performance/settings';
import { useSongLibrary } from '@/song/library';

const field = 'rounded border border-seam bg-transparent p-2';
function readNumber(key: string, fallback: number, min: number, max: number): number {
  try { const raw = localStorage.getItem(key); const n = raw === null ? NaN : Number(raw); return Number.isFinite(n) && n >= min && n <= max ? n : fallback; } catch { return fallback; }
}
/** Small safe formatting subset; imported charts never become HTML. */
function chartLine(text: string, onChord: (name: string) => void) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[A-G][^\]]*\])/g).map((part, i) =>
    part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith('*') ? <em key={i}>{part.slice(1, -1)}</em> : /^\[[A-G]/.test(part) ? <button key={i} type="button" aria-label={`Show ${part.slice(1, -1)} guitar voicings`} className="mr-1 cursor-pointer rounded font-bold text-sky-400 hover:bg-sky-400/15" onClick={() => onChord(part.slice(1, -1))}>{part.slice(1, -1)}</button> : part);
}
let sessionId = 0;
export function PerformancePanel() {
  const source = useSong(s => s.source);
  const generation = useMemo(() => ++sessionId, [source]);
  return <PerformanceSession key={generation} />;
}

function PerformanceSession() {
  const bluetooth = useBluetooth(s => s.connection);
  const source = useSong(s => s.source), stems = useSong(s => s.stems);
  const device = useDevice(s => s.device), connected = useDevice(s => s.preset !== null);
  const gp180Unlocked = useDevice(s => s.gp180WriteUnlocked);
  const inspectionOnly = useDevice(s => s.device === 'gp180' && s.mode !== 'mock') && !gp180Unlocked;
  const key = performanceKey(source);
  const library = useSongLibrary();
  const options = useMemo(() => readOptions(key, { beats: 4, shift: 0, mode: 'click' as 'click' | 'drums', volume: 0.25, mix: defaultMix(), chordChoice: '' as StemName | '', lyricsLanguage: 'auto' }), [key]);
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState('');
  const [chart, setChart] = useState(() => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } });
  const [bpm, setBpm] = useState(() => readNumber(key + ':bpm', 120, 30, 300)), [beats, setBeats] = useState(options.beats), [shift, setShift] = useState(options.shift);
  const [patch, setPatch] = useState(1);
  const [mode, setMode] = useState<'click' | 'drums'>(options.mode), [volume, setVolume] = useState(options.volume);
  const [rhythmOn, setRhythmOn] = useState(false), rhythm = useRef<Rhythm | null>(null);
  const [player, setPlayer] = useState<StemPlayer | null>(null), [playing, setPlaying] = useState(false), [time, setTime] = useState(0);
  const [mix, setMix] = useState(options.mix);
  const [chordChoice, setChordChoice] = useState<StemName | ''>(options.chordChoice);
  const automaticSource = useMemo(() => defaultChordSource(stems), [stems]);
  const chordSource = chordChoice && stems?.[chordChoice] ? chordChoice : automaticSource;
  const [chords, setChords] = useState<Chord[]>([]), [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState('');
  const [access, setAccess] = useState<MIDIAccess | null>(null), [portId, setPortId] = useState(bluetooth?.state === 'connected' ? bluetooth.id : ''), [inputId, setInputId] = useState('');
  const [midiStatus, setMidiStatus] = useState('');
  const [portsVersion, setPortsVersion] = useState(0);
  const [armed, setArmed] = useState(false), [clock, setClock] = useState(false);
  const cursor = useRef(-0.001), pulse = useRef(0), activeLine = useRef<HTMLParagraphElement>(null);
  const tap = useRef<number[]>([]);
  const playRequest = useRef(0), playPending = useRef(false);
  const parsed = useMemo(() => { try { return { cues: parseChart(chart), error: '' }; } catch (e) { return { cues: [], error: String(e) }; } }, [chart]);
  const active = parsed.cues.findLastIndex(c => c.time <= time);
  const output = portId === 'bluetooth-midi' ? bluetooth : access?.outputs.get(portId);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const saveChart = (value: string) => { pause(); setChart(value); try { localStorage.setItem(key, value); } catch (e) { fail(e); } };
  const panic = () => {
    if (!output || output.state !== 'connected') return;
    try {
      (output as { clear?: () => void }).clear?.();
      if (!armed) return;
      for (let ch = 0; ch < 16; ch++) { output.send([176 + ch, 64, 0]); output.send([176 + ch, 123, 0]); }
      if (clock) output.send([252]);
    } catch (e) { fail(e); }
  };
  const pause = () => { playRequest.current++; player?.pause(); setPlaying(false); panic(); };
  const play = async () => {
    if (!player || parsed.error || playPending.current || player.isPlaying) return;
    const request = ++playRequest.current;
    playPending.current = true;
    try {
      await player.play();
      if (request !== playRequest.current) { player.pause(); return; }
      cursor.current = Math.max(0, player.position) - 0.001; pulse.current = Math.ceil(Math.max(0, player.position) * bpm / 60 * 24);
      setPlaying(true);
    } catch (e) { if (request === playRequest.current) fail(e); }
    finally { playPending.current = false; }
  };
  const seek = async (value: number) => { pause(); await player?.seek(value); setTime(value); cursor.current = value - 0.001; };
  useEffect(() => { try { localStorage.setItem(key + ':bpm', String(bpm)); } catch (e) { fail(e); } }, [key, bpm]);
  useEffect(() => {
    if (!source) return;
    const p = new StemPlayer(stems ?? { other: source.audio });
    p.onEnded = () => { setPlaying(false); setTime(p.duration); };
    setPlayer(p); setTime(0); setPlaying(false); setMix(options.mix);
    return () => { playRequest.current++; void p.dispose(); };
  }, [source, stems]);
  useEffect(() => { player?.setMix(mix); }, [player, mix]);
  useEffect(() => { try { localStorage.setItem(key + ':options', JSON.stringify({ beats, shift, mode, volume, mix, chordChoice, lyricsLanguage: readOptions(key, { lyricsLanguage: 'auto' }).lyricsLanguage })); } catch (e) { fail(e); } }, [key, beats, shift, mode, volume, mix, chordChoice]);
  useEffect(() => {
    setChords([]); setAnalysing(false);
    const audio = chordSource ? stems?.[chordSource] : undefined;
    if (!audio) return;
    const worker = new Worker(new URL('../../song/performance/chords-worker.ts', import.meta.url), { type: 'module' });
    setAnalysing(true); setChords([]);
    worker.onmessage = e => { setAnalysing(false); if (e.data.error) setError(e.data.error); else setChords(e.data.chords); worker.terminate(); };
    worker.onerror = e => { setAnalysing(false); setError(e.message); worker.terminate(); };
    worker.postMessage(audio);
    return () => worker.terminate();
  }, [stems, chordSource]);
  useEffect(() => {
    if (!rhythmOn) return;
    const r = new Rhythm(); rhythm.current = r;
    r.bpm = bpm; r.beats = beats; r.mode = mode; r.volume = volume;
    void r.start().catch(fail);
    return () => { rhythm.current = null; void r.dispose(); };
  }, [rhythmOn]);
  useEffect(() => { if (rhythm.current) Object.assign(rhythm.current, { bpm, beats, mode, volume }); }, [bpm, beats, mode, volume]);
  useEffect(() => {
    if (!playing || !player) return;
    pulse.current = Math.ceil(Math.max(0, player.position) * bpm / 60 * 24);
    const timer = setInterval(() => {
      const now = Math.max(0, player.position); setTime(now);
      try {
        if (armed && output?.state === 'connected') {
          scheduleCues(parsed.cues, cursor.current, now + 0.05, now, performance.now(), (bytes, timestamp) => output.send(bytes, timestamp));
          if (clock) {
            const currentPulse = now * bpm / 60 * 24;
            // Drop stale clocks after a suspended renderer instead of flooding the rig.
            pulse.current = Math.max(pulse.current, Math.floor(currentPulse));
            while (pulse.current / 24 * 60 / bpm < now + 0.05) {
              const seconds = pulse.current / 24 * 60 / bpm;
              output.send([248], performance.now() + Math.max(0, seconds - now) * 1000); pulse.current++;
            }
          }
        }
        cursor.current = now + 0.05;
      } catch (e) { fail(e); setArmed(false); }
    }, 20);
    return () => { clearInterval(timer); };
  }, [playing, player, armed, output, clock, bpm, parsed]);
  // Transport lifecycle is separate from tempo-dependent scheduling.
  useEffect(() => {
    if (!playing) return;
    if (armed && clock) { try { output?.send([(player?.position ?? 0) < 0.05 ? 250 : 251]); } catch (e) { fail(e); } }
    return panic;
  }, [playing, armed, output, clock]);

  useEffect(() => {
    if (!access) return;
    const update = () => { setPortsVersion(n => n + 1); if (portId !== 'bluetooth-midi' && access.outputs.get(portId)?.state !== 'connected') setArmed(false); };
    access.addEventListener('statechange', update);
    return () => access.removeEventListener('statechange', update);
  }, [access, portId]);
  useEffect(() => { if (portId === 'bluetooth-midi') setArmed(false); }, [bluetooth, portId]);
  useEffect(() => {
    const input = access?.inputs.get(inputId);
    const receive = (data: Uint8Array) => {
      if (data[0] === 250 || data[0] === 251) void play();
      if (data[0] === 252) pause();
      if ((data[0] & 240) === 176 && data[1] === 80 && data[2] >= 64) { if (player?.isPlaying) pause(); else void play(); }
    };
    if (inputId === 'bluetooth-midi') return bluetooth?.subscribe(receive);
    if (!input) return;
    const handler = (e: MIDIMessageEvent) => { if (e.data) receive(e.data); };
    input.addEventListener('midimessage', handler);
    return () => input.removeEventListener('midimessage', handler);
  }, [access, inputId, player, parsed.error, armed, clock, output, bluetooth]);
  const connectMidi = async () => { try { setAccess(await navigator.requestMIDIAccess({ sysex: true })); } catch (e) { fail(e); } };
  const outputs = [...(access?.outputs.values() ?? []), ...(bluetooth ? [bluetooth] : [])].filter(p => p.state === 'connected');
  const inputs = [...(access?.inputs.values() ?? []), ...(bluetooth ? [bluetooth] : [])].filter(p => p.state === 'connected');
  void portsVersion;
  return <section className="glass flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-xl p-5" aria-label="Performance">
    {source?.libraryId && library.queue[library.position] === source.libraryId && <div className="flex flex-wrap items-center gap-3 rounded border border-seam p-3"><strong>{library.index.songs.find(s => s.id === source.libraryId)?.title}</strong><span>{library.position + 1} / {library.queue.length}</span><Button variant="outline" disabled={library.busy || library.position <= 0} onClick={() => { pause(); void library.load(library.queue[library.position - 1], library.queue, library.position - 1); }}>Previous song</Button><Button disabled={library.busy || library.position + 1 >= library.queue.length} onClick={() => { pause(); void library.load(library.queue[library.position + 1], library.queue, library.position + 1); }}>Next song</Button><span>Next: {library.index.songs.find(s => s.id === library.queue[library.position + 1])?.title ?? 'End of set'} · Stops between songs</span></div>}
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={!player || !!parsed.error} onClick={() => playing ? pause() : void play()}>{playing ? 'Pause' : 'Play song'}</Button>
      <Button variant="outline" disabled={!player} onClick={() => void seek(0)}>Rewind</Button>
      <span>{lrcTime(time)} / {lrcTime(player?.duration ?? 0)}</span>
      <input aria-label="Song position" type="range" min="0" max={player?.duration ?? 0} step="0.1" value={time} onChange={e => void seek(Number(e.target.value))} />
      {!source && <span>Open a song in Stems, or practise with the rhythm below.</span>}
    </div>
    {stems && <div className="flex flex-wrap gap-3">{player?.names.map(name => <label key={name}><input type="checkbox" checked={!mix[name].mute} onChange={e => setMix(m => ({ ...m, [name]: { ...m[name], mute: !e.target.checked } }))} /> {name}</label>)}</div>}
    <PerformanceReader chart={chart} lyrics={lyrics} chords={chords} time={time} shift={shift} title={source?.name ?? 'Performance'} transport={<>
      <Button disabled={!player || !!parsed.error} onClick={() => playing ? pause() : void play()}>{playing ? 'Pause' : 'Play song'}</Button>
      <Button variant="outline" disabled={!player} onClick={() => void seek(0)}>Rewind</Button>
      <input aria-label="Expanded song position" className="min-w-32 flex-1" type="range" min="0" max={player?.duration ?? 0} step="0.1" value={time} onChange={e => void seek(Number(e.target.value))} />
      <span className="text-sm">{lrcTime(time)} / {lrcTime(player?.duration ?? 0)}</span>
    </>} />
    <div className="flex flex-wrap items-center gap-3">
      <label>BPM <input className={field + ' w-20'} aria-label="BPM" type="number" min="30" max="300" value={bpm} onChange={e => setBpm(Math.max(30, Math.min(300, Number(e.target.value) || 120)))} /></label>
      <Button variant="outline" onClick={() => { const now = performance.now(); const times = tap.current.filter(t => now - t < 3000).slice(-5); times.push(now); tap.current = times; if (times.length > 1) setBpm(Math.max(30, Math.min(300, Math.round(60000 * (times.length - 1) / (now - times[0]))))); }}>Tap tempo</Button>
      <label>Beats <select className={field} value={beats} onChange={e => setBeats(Number(e.target.value))}>{[2,3,4,5,6,7].map(n => <option key={n}>{n}</option>)}</select></label>
      <select aria-label="Rhythm sound" className={field} value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="click">Metronome</option><option value="drums">Synth drums</option></select>
      <label>Volume <input aria-label="Rhythm volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(Number(e.target.value))} /></label>
      <Button onClick={() => setRhythmOn(!rhythmOn)}>{rhythmOn ? 'Stop rhythm' : 'Start rhythm'}</Button>
      {device === 'gp180' && <><Button variant="outline" disabled={!connected || inspectionOnly} onClick={() => { try { useDevice.getState().setBpm(bpm); } catch (e) { fail(e); } }}>Set GP-180 patch tempo</Button><label>GP-180 patch <input className={field + ' w-20'} type="number" min="1" max="200" value={patch} onChange={e => setPatch(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} /></label><Button variant="outline" disabled={!connected || inspectionOnly} onClick={() => void useDevice.getState().selectSlot(patch - 1).catch(fail)}>Recall {String(patch).padStart(3, '0')}</Button></>}
    </div>
    {inspectionOnly && <p className="text-sm text-silkscreen-3">GP-180 inspection is read-only. Patch recall and pedal tempo changes are disabled; the computer’s rhythm remains available.</p>}
    <section aria-label="Performance MIDI routing" className="space-y-3 rounded-xl border border-seam p-4"><h2 className="font-semibold">Bluetooth MIDI controller</h2><p className="text-sm text-silkscreen-3">Computer → Bluetooth MIDI → GP-180 → physical MIDI OUT/THRU → MIDI pedals. USB is not required for song cues.</p><div className="flex flex-wrap items-center gap-3 py-3">
      <BluetoothControls onConnected={connection => { panic(); setArmed(false); setPortId(connection.id); setMidiStatus('Bluetooth output selected. Enable Send cues to send this song’s commands.'); }} />
      <Button variant="outline" onClick={() => void connectMidi()}>Enable USB / system MIDI</Button>
      <select aria-label="MIDI output" className={field} value={portId} onChange={e => { panic(); setArmed(false); setPortId(e.target.value); }}><option value="">Select output…</option>{outputs.map(p => <option value={p.id} key={p.id}>{p.id === 'bluetooth-midi' ? `Bluetooth · ${p.name}` : p.name}</option>)}</select>
      <label><input type="checkbox" disabled={output?.state !== 'connected' || !!parsed.error} checked={armed} onChange={e => { panic(); cursor.current = time; setArmed(e.target.checked); setMidiStatus(''); }} /> Send cues</label>
      <label><input type="checkbox" checked={clock} onChange={e => setClock(e.target.checked)} /> MIDI Clock (24 PPQN)</label>
      <select aria-label="MIDI input" className={field} value={inputId} onChange={e => setInputId(e.target.value)}><option value="">No remote input</option>{inputs.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select>
      <Button variant="outline" onClick={() => { panic(); setArmed(false); }}>Panic / disarm</Button>
    </div><p className="text-sm text-silkscreen-3">Input: Start/Continue/Stop or CC 80 ≥ 64 toggles playback. Configure a GP-180 MIDI footswitch to send CC 80. Output is opt-in for each song. PC values are 0–127; channels are 1–16. Bluetooth uses its own connection and does not need Enable USB / system MIDI.</p>
      <p role="status" className="text-sm">{output?.state === 'connected' ? `${portId === 'bluetooth-midi' ? 'Bluetooth' : 'System MIDI'} output: ${output.name} · ${armed ? 'Song cues enabled' : 'Song cues off'}` : 'Connect Bluetooth MIDI and select an output.'}</p>
      <MidiCueBuilder time={time} cues={parsed.cues} canTest={output?.state === 'connected' && armed} onAdd={line => saveChart([chart.trimEnd(), line].filter(Boolean).join('\n'))} onTest={bytes => { if (!armed || output?.state !== 'connected') return; output.send(bytes); setMidiStatus(`MIDI command queued for ${output.name}. Check whether the downstream pedal responds.`); }} />
      {midiStatus && <p role="status" className="text-sm">{midiStatus}</p>}
      <details><summary className="cursor-pointer text-sm">GP-180 routing setup</summary><p className="py-2 text-sm text-silkscreen-3">On the GP-180, enable Bluetooth and configure MIDI IN Source as BT Only or Mixed. Configure EXP/FS jack 2 for MIDI OUT and connect the correct TRS MIDI cable to the downstream pedal. Match MIDI channels on the pedals. Forwarding Bluetooth input to physical MIDI OUT depends on the GP-180’s routing and firmware; use the test command to verify it. A Bluetooth connection alone does not confirm delivery at MIDI OUT.</p><p className="pb-2 text-sm text-silkscreen-3">For MIDI Clock, check Clock Source and Clock Output separately. The GP-180 manual says enabling Clock Output makes the pedal ignore incoming clock. Receiving the app’s clock and forwarding it to another pedal must each be verified; successful patch changes do not confirm clock routing.</p></details>
    </section>
    <div className="flex flex-wrap items-center gap-3"><h2 className="font-semibold">Lyrics & chords</h2><label>Transpose <input aria-label="Transpose semitones" className={field + ' w-20'} type="number" min="-12" max="12" value={shift} onChange={e => setShift(Math.max(-12, Math.min(12, Number(e.target.value) || 0)))} /></label>
      <label className="cursor-pointer underline">Import TXT / LRC / ChordPro<input type="file" accept=".txt,.lrc,.cho,.chordpro" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void f.text().then(saveChart).catch(fail); e.target.value = ''; }} /></label>
      <Button variant="outline" onClick={() => void host.song.saveFiles([{ name: 'performance.lrc', bytes: new TextEncoder().encode(chart) }], 'Export lyrics and MIDI cues').catch(fail)}>Export chart</Button>
    </div>
    <details><summary className="cursor-pointer font-semibold">Separate lyrics and chart editors</summary>
    <LyricsTrack audio={stems?.vocals} storageKey={key} time={time} onTextChange={setLyrics} follow={false} />
    <div className="grid gap-4 lg:grid-cols-2">
      <div><textarea aria-label="Lyrics and MIDI chart" className={field + ' min-h-64 w-full font-mono text-sm'} value={chart} onChange={e => saveChart(e.target.value)} placeholder={'[00:00.00] [C]Verse\n[00:10.00] [Am]Your lyrics {midi:pc 1 0}\n[00:20.00] [F]Chorus {midi:cc 1 64 127}'} /><p className="text-sm text-silkscreen-3">Saved locally for this audio filename and length. LRC timestamps enable scrolling and MIDI. Chords use [Am] or [C/G]. MIDI: pc, cc, note, off, sysex. Note cues need a matching off cue. Transpose changes the chart only.</p></div>
      <div className="max-h-96 overflow-auto rounded border border-seam p-4 text-2xl leading-relaxed" aria-label="Performance lyrics">{parsed.cues.length ? parsed.cues.map((cue, i) => <p ref={i === active ? activeLine : undefined} key={i} className={i === active ? 'rounded bg-white/10 font-bold' : 'text-silkscreen-3'}>{chartLine(transpose(cue.text, shift) || '♪', setSelectedChord)}</p>) : <pre className="whitespace-pre-wrap font-sans">{chartLine(transpose(chart, shift), setSelectedChord)}</pre>}</div>
    </div>
    <div><h2 className="font-semibold">Chords from stems</h2><label>Chord source <select aria-label="Chord source" className={field} value={chordChoice} onChange={e => setChordChoice(e.target.value as StemName | '')}><option value="">Automatic - {automaticSource || 'no usable stem'}</option>{STEM_NAMES.filter(name => stems?.[name]).map(name => <option key={name} value={name}>{name}</option>)}</select></label><p className="text-sm text-silkscreen-3">Guitar is preferred. If it is missing or silent, automatic selection tries piano, then other stems. Override the source if the song has no guitar but separation left sound in that stem.</p><p className="text-sm text-silkscreen-3">{analysing ? 'Analysing harmonic stem…' : stems ? `Estimated major/minor chords from ${chordSource || 'no usable stem'}. Review by ear; N means uncertain or silence.` : 'Split the song in Stems to estimate its chords automatically.'}</p>
      {!!chords.length && <><div className="my-2 max-h-32 overflow-auto font-mono">{chords.map(c => <span key={c.time} className="mr-4 inline-block">{lrcTime(c.time)} {c.name === 'N' ? '—' : <button type="button" className="cursor-pointer rounded text-sky-400 hover:bg-sky-400/15" aria-label={`Show ${transpose(`[${c.name}]`, shift).slice(1, -1)} guitar voicings`} onClick={() => setSelectedChord(transpose(`[${c.name}]`, shift).slice(1, -1))}>{transpose(`[${c.name}]`, shift)}</button>}</span>)}</div><Button variant="outline" onClick={() => void host.song.saveFiles([{ name: 'estimated-chords.lrc', bytes: new TextEncoder().encode(chords.map(c => `${lrcTime(c.time)} [${c.name}]`).join('\n')) }], 'Export estimated chords').catch(fail)}>Export chord estimates</Button><Button className="ml-2" variant="outline" onClick={() => saveChart(chart + '\n' + chords.map(c => `${lrcTime(c.time)} [${c.name}]`).join('\n'))}>Append estimates to chart</Button></>}
    </div>
    </details>
    <ChordVoicings chord={selectedChord} onClose={() => setSelectedChord(null)} />
    {(error || parsed.error) && <p role="alert" className="text-red-400">{error || parsed.error}</p>}
  </section>;
}
