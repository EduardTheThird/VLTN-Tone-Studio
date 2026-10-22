import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PerformancePanel } from './PerformancePanel';
import { readMidiConfiguration, useMidiConfiguration } from '@/song/performance/midi-configuration';
beforeEach(()=>{localStorage.clear();useMidiConfiguration.setState(readMidiConfiguration());HTMLElement.prototype.scrollTo=vi.fn();});
const mocks = vi.hoisted(() => ({ send: vi.fn(), clear: vi.fn(), metronome: vi.fn(), mix: vi.fn(), bluetooth: null as null | {id: string; name: string; state: string; send: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn>}, position: 0, source: { name: 'clock-test.wav', audio: { sampleRate: 44100, channels: [new Float32Array(44100)] } } }));
vi.mock('@/song/store', () => ({ useSong: Object.assign((select: (s: unknown) => unknown) => select({source: mocks.source, stems: null}), {getState:()=>({source:mocks.source})}) }));
vi.mock('@/state/device', () => ({ useDevice: (select: (s: unknown) => unknown) => select({device: 'gp5', preset: null, mode: 'mock', gp180WriteUnlocked: false}) }));
vi.mock('@/song/library', () => ({ useSongLibrary: Object.assign(() => ({queue: [], position: -1, index: {songs: []}}), {getState:()=>({queue:[],position:-1,playlistPlaying:false})}) }));
vi.mock('@/host', () => ({ host: {} }));
vi.mock('@/bluetooth/connection', () => ({ useBluetooth: (select: (s: unknown) => unknown) => select({connection: mocks.bluetooth}) }));
vi.mock('@/bluetooth/BluetoothControls', () => ({ BluetoothControls: () => null }));
vi.mock('./LyricsTrack', () => ({ LyricsTrack: () => null }));
vi.mock('@/song/stems/player', () => ({ StemPlayer: class { names=['other']; duration=60; get position(){return mocks.position;} async seek(value: number){mocks.position=value;} isPlaying=false; setMix(value: unknown){mocks.mix(value);} setMetronome(value: unknown){mocks.metronome(value);} async dispose(){} async play(){this.isPlaying=true;} pause(){this.isPlaying=false;} } }));
afterEach(() => { cleanup(); mocks.bluetooth=null; mocks.position=0; mocks.send.mockClear(); mocks.clear.mockClear(); mocks.metronome.mockClear(); mocks.mix.mockClear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('locks recording BPM during playback and stops MIDI clock on pause', async () => {
  vi.useFakeTimers(); localStorage.clear(); HTMLElement.prototype.scrollIntoView=vi.fn();
  const access=Object.assign(new EventTarget(), { outputs: new Map([['fake', {id:'fake', name:'Fake MIDI', state:'connected', send:mocks.send, clear:mocks.clear}]]), inputs: new Map() });
  vi.stubGlobal('navigator', {requestMIDIAccess: async () => access});
  render(<PerformancePanel />);
  await act(async () => { fireEvent.click(screen.getByText('Enable USB / system MIDI')); });
  fireEvent.change(screen.getByLabelText('MIDI output'), {target:{value:'fake'}});
  fireEvent.click(screen.getByLabelText('Send cues'));
  fireEvent.click(screen.getByLabelText('MIDI Clock (24 PPQN)'));
  await act(async () => { fireEvent.click(screen.getByText('Play song')); });
  expect(mocks.send.mock.calls.some(c=>c[0][0]===250)).toBe(true);
  expect(mocks.send.mock.calls.some(c=>c[0][0]===252)).toBe(false);
  mocks.send.mockClear();
  expect((screen.getByLabelText('BPM') as HTMLInputElement).disabled).toBe(true);
  mocks.position=0.04; act(()=>vi.advanceTimersByTime(40));
  expect(mocks.send.mock.calls.some(c=>[250,251,252].includes(c[0][0]))).toBe(false);
  expect(mocks.send.mock.calls.some(c=>c[0][0]===248)).toBe(true);
  fireEvent.click(screen.getByText('Pause'));
  expect(mocks.send.mock.calls.some(c=>c[0][0]===252)).toBe(true);
});

it('sends timed song cues to Bluetooth without a USB editor or Web MIDI access', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('navigator', {});
  mocks.bluetooth = {id: 'bluetooth-midi', name: 'GP-180 BLE', state: 'connected', send: mocks.send, clear: mocks.clear};
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100', '[00:00] {midi:pc 3 7}\n[00:01] {midi:cc 4 12 127}');
  render(<PerformancePanel />);
  expect((screen.getByLabelText('MIDI output') as HTMLSelectElement).value).toBe('bluetooth-midi');
  fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async () => { fireEvent.click(screen.getByText('Play song')); });
  act(() => vi.advanceTimersByTime(20));
  expect(mocks.send.mock.calls.filter(c => c[0][0] === 0xc2).map(c => c[0])).toEqual([[0xc2,7]]);
  mocks.position=0.98; act(() => vi.advanceTimersByTime(20));
  mocks.position=1.2; act(() => vi.advanceTimersByTime(40));
  expect(mocks.send.mock.calls.filter(c => c[0][0] === 0xb3 && c[0][1] === 12).map(c => c[0])).toEqual([[0xb3,12,127]]);
  fireEvent.click(screen.getByText('Pause'));
  expect(mocks.clear).toHaveBeenCalled();
});
it('disarms after a Bluetooth disconnect and does not re-arm a replacement connection', () => {
  localStorage.clear();
  mocks.bluetooth = {id: 'bluetooth-midi', name: 'GP-180 BLE', state: 'connected', send: mocks.send, clear: mocks.clear};
  const view = render(<PerformancePanel />);
  fireEvent.click(screen.getByLabelText('Send cues'));
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(true);
  mocks.bluetooth=null; view.rerender(<PerformancePanel />);
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
  mocks.bluetooth = {id: 'bluetooth-midi', name: 'GP-180 BLE', state: 'connected', send: mocks.send, clear: mocks.clear};
  view.rerender(<PerformancePanel />);
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
});

it('remembers global metronome, song clock and mixer settings without arming MIDI', () => {
  localStorage.clear();
  const view=render(<PerformancePanel />);
  expect(screen.queryByText('Start rhythm')).toBeNull();
  fireEvent.click(screen.getByLabelText('Metronome'));
  fireEvent.click(screen.getByLabelText('MIDI Clock (24 PPQN)'));
  fireEvent.change(screen.getByLabelText('Song volume'), {target:{value:'0.4'}});
  expect(mocks.metronome.mock.lastCall?.[0]).toMatchObject({enabled:true,bpm:120});
  expect(mocks.mix.mock.lastCall?.[0].other.volume).toBe(0.4);
  view.unmount(); render(<PerformancePanel />);
  expect((screen.getByLabelText('Metronome') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('MIDI Clock (24 PPQN)') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Song volume') as HTMLInputElement).value).toBe('0.4');
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
  expect(mocks.send).not.toHaveBeenCalled();
});

it('disables clock during playback without replaying transport or stopping audio', async () => {
  vi.useFakeTimers(); localStorage.clear();
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100', '[00:00.04] {midi:pc 1 9}');
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  render(<PerformancePanel />);
  fireEvent.click(screen.getByLabelText('Send cues'));
  fireEvent.click(screen.getByLabelText('MIDI Clock (24 PPQN)'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  act(()=>vi.advanceTimersByTime(20));
  expect(mocks.send.mock.calls.some(c=>c[0][0]===248)).toBe(true);
  mocks.send.mockClear();
  mocks.position=0.01;
  fireEvent.click(screen.getByLabelText('MIDI Clock (24 PPQN)'));
  expect(mocks.send.mock.calls.some(c=>c[0][0]===252)).toBe(true);
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===192).map(c=>c[0])).toEqual([[192,9]]);
  mocks.send.mockClear();
  mocks.position=0.11; act(()=>vi.advanceTimersByTime(100));
  expect(mocks.send.mock.calls.some(c=>c[0][0]===248)).toBe(false);
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===192)).toHaveLength(0);
  expect(screen.getByText('Pause')).toBeTruthy();
});

it.each([90,120,180])('schedules exactly 24 MIDI clock pulses per beat at %i BPM',async bpm=>{
  vi.useFakeTimers(); localStorage.clear();
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100:bpm',String(bpm));
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  render(<PerformancePanel/>);
  fireEvent.click(screen.getByLabelText('Send cues'));
  fireEvent.click(screen.getByLabelText('MIDI Clock (24 PPQN)'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  const origin=performance.now();
  for(let ms=20;ms<=10000;ms+=20){mocks.position=ms/1000;act(()=>vi.advanceTimersByTime(20));}
  const stamps=mocks.send.mock.calls.filter(c=>c[0][0]===248).map(c=>c[1]-origin).filter(t=>t<10000-0.001);
  expect(stamps).toHaveLength(bpm/60*24*10);
  // Ignore the first already-due pulse; subsequent timestamps must form a steady tempo grid.
  for(let i=2;i<stamps.length;i++)expect(stamps[i]-stamps[i-1]).toBeCloseTo(60000/bpm/24,5);
  fireEvent.click(screen.getByText('Pause'));
  mocks.send.mockClear();act(()=>vi.advanceTimersByTime(1000));
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===248)).toHaveLength(0);
});

it('sends Start before clock and keeps a fixed timestamp grid through audio polling jitter', async () => {
  vi.useFakeTimers(); localStorage.clear();
  mocks.position=-0.02; // The audio sources start after a 20 ms pre-roll.
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  render(<PerformancePanel/>);
  fireEvent.click(screen.getByLabelText('Send cues'));
  fireEvent.click(screen.getByLabelText('MIDI Clock (24 PPQN)'));
  const origin=performance.now()+20;
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  expect(mocks.send.mock.calls[0][0]).toEqual([250]);
  for(let ms=20;ms<=1000;ms+=20){
    // AudioContext.currentTime is quantized, unlike performance.now().
    mocks.position=ms/1000-0.02+(ms%40===0 ? 0.002 : -0.001);
    act(()=>vi.advanceTimersByTime(20));
  }
  const stamps=mocks.send.mock.calls.filter(c=>c[0][0]===248).map(c=>c[1]);
  expect(stamps[0]).toBeCloseTo(origin,5);
  stamps.forEach((stamp,i)=>expect(stamp).toBeCloseTo(origin+i*60000/120/24,5));
});
it('keeps scheduled MIDI running while commands are hidden and remembers visibility', async () => {
  vi.useFakeTimers();
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100','[00:00] {label:Opening preset} {midi:pc 1 3}\n[00:01] {label:Delay change} {midi:cc 1 12 100}');
  const view=render(<PerformancePanel/>);
  fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  expect(screen.getAllByLabelText('MIDI cue')).toHaveLength(2);
  mocks.clear.mockClear(); mocks.send.mockClear();
  fireEvent.click(screen.getByLabelText('Show MIDI commands'));
  expect(screen.queryByLabelText('MIDI cue')).toBeNull();
  expect(screen.queryByLabelText('MIDI cue builder')).toBeNull();
  expect(screen.getByText('Pause')).toBeTruthy();
  expect(mocks.clear).not.toHaveBeenCalled();
  mocks.position=0.98; act(()=>vi.advanceTimersByTime(20));
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===176 && c[0][1]===12).map(c=>c[0])).toEqual([[176,12,100]]);
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===192)).toHaveLength(0);
  view.unmount(); render(<PerformancePanel/>);
  expect((screen.getByLabelText('Show MIDI commands') as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
});

it('remembers USB configuration and applies GP-180 one-time song tempo without arming on reopen', async () => {
  const access=Object.assign(new EventTarget(), { outputs:new Map([['gp180',{id:'gp180',name:'GP-180 MIDI',state:'connected',send:mocks.send,clear:mocks.clear}]]),inputs:new Map() });
  vi.stubGlobal('navigator',{requestMIDIAccess:async()=>access});
  const view=render(<PerformancePanel/>);
  fireEvent.change(screen.getByLabelText('MIDI setup preset'),{target:{value:'gp180-usb'}});
  fireEvent.click(screen.getByText('Apply MIDI setup'));
  expect(mocks.send).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Send song BPM to GP-180 on playback start') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('MIDI Clock (24 PPQN)') as HTMLInputElement).checked).toBe(false);
  await act(async()=>{fireEvent.click(screen.getByText('Enable USB / system MIDI'));});
  fireEvent.change(screen.getByLabelText('MIDI output'),{target:{value:'gp180'}});
  view.unmount(); render(<PerformancePanel/>);
  await act(async()=>{fireEvent.click(screen.getByText('Enable USB / system MIDI'));});
  expect((screen.getByLabelText('MIDI output') as HTMLSelectElement).value).toBe('gp180');
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===191).map(c=>c[0])).toEqual([[191,73,0],[191,74,120]]);
  expect(mocks.send.mock.calls.some(c=>c[0][0]===248)).toBe(false);
});

it('uses the latest song tempo and channel when remote MIDI starts playback', async () => {
  const input=Object.assign(new EventTarget(),{id:'remote',name:'Footswitch',state:'connected'});
  const access=Object.assign(new EventTarget(),{outputs:new Map([['usb',{id:'usb',name:'GP-180',state:'connected',send:mocks.send,clear:mocks.clear}]]),inputs:new Map([['remote',input]])});
  vi.stubGlobal('navigator',{requestMIDIAccess:async()=>access});
  render(<PerformancePanel />);
  await act(async()=>{fireEvent.click(screen.getByText('Enable USB / system MIDI'));});
  fireEvent.change(screen.getByLabelText('MIDI output'),{target:{value:'usb'}});
  fireEvent.change(screen.getByLabelText('MIDI input'),{target:{value:'remote'}});
  fireEvent.click(screen.getByLabelText('Send cues'));
  fireEvent.click(screen.getByLabelText('Send song BPM to GP-180 on playback start'));
  fireEvent.change(screen.getByLabelText('BPM'),{target:{value:'141'}});
  fireEvent.change(screen.getByLabelText('GP-180 tempo channel'),{target:{value:'15'}});
  mocks.send.mockClear();
  await act(async()=>{input.dispatchEvent(Object.assign(new Event('midimessage'),{data:new Uint8Array([250])}));});
  expect(mocks.send.mock.calls.map(c=>c[0])).toContainEqual([0xbe,73,1]);
  expect(mocks.send.mock.calls.map(c=>c[0])).toContainEqual([0xbe,74,13]);
});

it('applies automatic tempo after song-start patch recalls on the same MIDI timeline', async () => {
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  mocks.position=-0.02;
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100','[00:00] {midi:cc 16 0 0} {midi:pc 16 12}');
  useMidiConfiguration.getState().update({tempoOnStart:true});
  render(<PerformancePanel />);
  fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  expect(mocks.send.mock.calls.map(c=>c[0])).toEqual([[0xbf,0,0],[0xcf,12],[0xbf,73,0],[0xbf,74,120]]);
  const stamps=mocks.send.mock.calls.map(c=>c[1]);
  expect(stamps[2]).toBeCloseTo(stamps[1],1);
  expect(stamps[3]).toBeCloseTo(stamps[1],1);
});

it('preserves the song key when mixer, tempo and metronome options are saved',()=>{
  const view=render(<PerformancePanel />);
  fireEvent.change(screen.getByLabelText('Song key override'),{target:{value:'D minor'}});
  fireEvent.change(screen.getByLabelText('Song volume'),{target:{value:'0.35'}});
  fireEvent.change(screen.getByLabelText('BPM'),{target:{value:'100'}});
  fireEvent.click(screen.getByLabelText('Metronome'));
  view.unmount();render(<PerformancePanel />);
  expect((screen.getByLabelText('Song key override') as HTMLSelectElement).value).toBe('D minor');
  expect((screen.getByLabelText('Song volume') as HTMLInputElement).value).toBe('0.35');
  expect((screen.getByLabelText('BPM') as HTMLInputElement).value).toBe('100');
});
