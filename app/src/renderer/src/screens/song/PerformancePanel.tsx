import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSong } from "@/song/store";
import { defaultMix } from "@/song/stems/mix";
import { parseChart } from "@/song/performance/chart";
import { defaultChordSource } from "@/song/performance/sources";
import { PerformanceSession, useSession, type Timing } from "@/song/performance/session";
import { isMetronomeMode, recordTap, tapBpm, type MetronomeMode } from "@/song/performance/rhythm";
import { type StemName } from "@/song/types";
import { getSetting, performanceKey, readOptions, setSetting } from "@/song/performance/settings";
import { useSongLibrary } from "@/song/library";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { useBluetooth } from "@/bluetooth/connection";
import { SongKey } from "./SongKey";
import { ChordVoicings } from "./ChordVoicings";
import { PerformanceTransport } from "./PerformanceTransport";
import { PerformanceMix } from "./PerformanceMix";
import { PerformanceMidiSetup, SessionMidiHealth } from "./PerformanceMidiSetup";
import { PerformanceAnalysis, useChordAnalysis } from "./PerformanceAnalysis";
import { StageView } from "./StageView";

function readNumber(raw: string, fallback: number, min: number, max: number): number {
  const n = raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

let sessionId = 0;
/** A saved number, kept within its range; anything else gets the fallback. */
const numberIn = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** The metronome mode a song starts with when it has none of its own. Earlier builds stored the on/off toggle as "true" or "false". */
function readGlobalMetronome(): MetronomeMode {
  try {
    const stored = localStorage.getItem("vltn.performance.metronome");
    if (stored === "true") return "playing";
    return isMetronomeMode(stored) ? stored : "off";
  } catch {
    return "off";
  }
}

/** Typing in a field must not tap the tempo. */
const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function PerformancePanel() {
  const source = useSong((s) => s.source);
  const generation = useMemo(() => ++sessionId, [source]);
  const [stage, setStage] = useState(false);
  return <PerformanceView key={generation} stage={stage} setStage={setStage} />;
}

/** Composes the performance screen. The MIDI session, scheduler and transport live in `PerformanceSession`. */
function PerformanceView({ stage, setStage }: { stage: boolean; setStage: (value: boolean) => void }) {
  const bluetooth = useBluetooth((s) => s.connection);
  const midiConfig = useMidiConfiguration();
  const source = useSong((s) => s.source),
    stems = useSong((s) => s.stems);
  const key = performanceKey(source);
  const library = useSongLibrary();
  const queued = !!source?.libraryId && library.queue[library.position] === source.libraryId;
  const options = useMemo(
    () =>
      readOptions(key, {
        firstBeat: 0,
        beats: 4,
        shift: 0,
        clock: false,
        volume: 0.25,
        mix: defaultMix(),
        chordChoice: "" as StemName | "",
        lyricsLanguage: "auto",
        metronomeMode: "",
        countInBars: 0,
        preRollBeats: 0,
        startDelay: 0,
      }),
    [key],
  );
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState("");
  const [chart, setChart] = useState(() => getSetting(key, ""));
  const [bpm, setBpm] = useState(() => readNumber(getSetting(key, ":bpm"), 120, 30, 300)),
    [beats, setBeats] = useState(options.beats),
    [shift, setShift] = useState(options.shift);
  const [volume, setVolume] = useState(options.volume);
  const [firstBeat, setFirstBeat] = useState(() =>
    typeof options.firstBeat === "number" && Number.isFinite(options.firstBeat) && options.firstBeat >= 0 ? options.firstBeat : 0,
  );
  const [metronome, setMetronome] = useState<MetronomeMode>(() => (isMetronomeMode(options.metronomeMode) ? options.metronomeMode : readGlobalMetronome()));
  const [countInBars, setCountInBars] = useState(() => numberIn(options.countInBars, 0, 2, 0));
  const [preRollBeats, setPreRollBeats] = useState(() => numberIn(options.preRollBeats, 0, 16, 0));
  const [startDelay, setStartDelay] = useState(() => numberIn(options.startDelay, 0, 10, 0));
  const [mix, setMix] = useState(options.mix);
  const [chordChoice, setChordChoice] = useState<StemName | "">(options.chordChoice);
  const automaticSource = useMemo(() => defaultChordSource(stems), [stems]);
  const chordSource = chordChoice && stems?.[chordChoice] ? chordChoice : automaticSource;
  const parsed = useMemo(() => {
    try {
      return { cues: parseChart(chart), error: "" };
    } catch (e) {
      return { cues: [], error: String(e) };
    }
  }, [chart]);

  const [session] = useState(
    () =>
      new PerformanceSession({
        initialClock: !midiConfig.tempoOnStart && options.clock === true,
        carried: queued && library.playlistPlaying ? library.midiSession : null,
        initial: {
          bluetooth,
          tempoOnStart: midiConfig.tempoOnStart,
          tempoChannel: midiConfig.tempoChannel,
          savedOutput: midiConfig.output,
          savedInput: midiConfig.input,
          queued,
          playlistPlaying: !!library.playlistPlaying,
          busy: !!library.busy,
          cues: parsed.cues,
          parseError: parsed.error,
          bpm,
        },
      }),
  );
  const player = useSession(session, (s) => s.player);
  const clock = useSession(session, (s) => s.clock);
  const { chords, analysing } = useChordAnalysis(session, stems, chordSource);

  useEffect(() => session.loadSong(source, stems), [session, source, stems]);
  useEffect(() => {
    session.locked = stage;
  }, [session, stage]);
  useEffect(() => {
    session.bind();
    return () => session.dispose();
  }, [session]);
  // Lead-in before a start. Memoised: the session compares inputs by identity, so a new object every render would re-run it every render.
  const timing = useMemo<Timing>(() => ({ countInBars, beatsPerBar: beats, preRollBeats, startDelay }), [countInBars, beats, preRollBeats, startDelay]);
  // Tap tempo sets the song BPM only while stopped. The taps live in a ref so the key handler always sees the latest sequence.
  const tapsRef = useRef<number[]>([]);
  const tap = () => {
    tapsRef.current = recordTap(tapsRef.current, performance.now());
    const value = tapBpm(tapsRef.current);
    if (value && !session.state.playing) setBpm(value);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "t" || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      tap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);
  // Values owned by other stores; the session re-runs only the effects whose inputs changed.
  useEffect(() => {
    session.update({
      bluetooth,
      tempoOnStart: midiConfig.tempoOnStart,
      tempoChannel: midiConfig.tempoChannel,
      savedOutput: midiConfig.output,
      savedInput: midiConfig.input,
      queued,
      playlistPlaying: !!library.playlistPlaying,
      busy: !!library.busy,
      cues: parsed.cues,
      parseError: parsed.error,
      bpm,
      timing,
    });
  });

  const saveChart = (value: string) => {
    session.pause();
    setChart(value);
    try {
      setSetting(key, "", value);
    } catch (e) {
      session.fail(e);
    }
  };
  useEffect(() => {
    try {
      setSetting(key, ":bpm", String(bpm));
    } catch (e) {
      session.fail(e);
    }
  }, [session, key, bpm]);
  useEffect(() => {
    setMix(options.mix);
  }, [player]);
  useEffect(() => {
    player?.setMix(mix);
  }, [player, mix]);
  useEffect(() => {
    try {
      setSetting(
        key,
        ":options",
        JSON.stringify({
          ...readOptions(key, {}),
          firstBeat,
          beats,
          shift,
          clock,
          volume,
          mix,
          chordChoice,
          lyricsLanguage: readOptions(key, { lyricsLanguage: "auto" }).lyricsLanguage,
          metronomeMode: metronome,
          countInBars,
          preRollBeats,
          startDelay,
        }),
      );
    } catch (e) {
      session.fail(e);
    }
  }, [session, key, firstBeat, beats, shift, clock, volume, mix, chordChoice, metronome, countInBars, preRollBeats, startDelay]);
  useEffect(() => {
    player?.setMetronome({ mode: metronome, bpm, beats, volume, firstBeat });
  }, [player, metronome, bpm, beats, volume, firstBeat]);
  useEffect(() => {
    try {
      localStorage.setItem("vltn.performance.metronome", String(metronome));
    } catch (e) {
      session.fail(e);
    }
  }, [session, metronome]);

  return (
    <section className="glass flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-xl p-5" aria-label="Performance">
      <div style={{ display: stage ? "none" : "contents" }}>
        <Button variant="outline" onClick={() => setStage(true)}>
          Enter stage mode
        </Button>
        <PerformanceTransport
          session={session}
          stage={stage}
          bpm={bpm}
          onBpm={setBpm}
          metronome={{
            metronome,
            onMetronome: setMetronome,
            firstBeat,
            onFirstBeat: setFirstBeat,
            beats,
            onBeats: setBeats,
            volume,
            onVolume: setVolume,
            countInBars,
            onCountInBars: setCountInBars,
            preRollBeats,
            onPreRollBeats: setPreRollBeats,
            startDelay,
            onStartDelay: setStartDelay,
          }}
          onTap={tap}
        />
        <SessionMidiHealth session={session} />
        <SongKey stems={stems} original={source?.audio} storageKey={key} shift={shift} />
        <PerformanceMix session={session} stems={stems} mix={mix} onMix={setMix} />
      </div>
      <StageView
        session={session}
        stage={stage}
        onExitStage={() => setStage(false)}
        chart={chart}
        lyrics={lyrics}
        chords={chords}
        shift={shift}
        onSaveChart={saveChart}
      />
      <div style={{ display: stage ? "none" : "contents" }}>
        <PerformanceMidiSetup session={session} chart={chart} onSaveChart={saveChart} />
        <PerformanceAnalysis
          session={session}
          stems={stems}
          storageKey={key}
          chart={chart}
          onSaveChart={saveChart}
          shift={shift}
          onShift={setShift}
          onLyrics={setLyrics}
          chords={chords}
          analysing={analysing}
          chordChoice={chordChoice}
          onChordChoice={setChordChoice}
          automaticSource={automaticSource}
          chordSource={chordSource}
          onSelectChord={setSelectedChord}
        />
        <ChordVoicings chord={selectedChord} onClose={() => setSelectedChord(null)} />
      </div>
    </section>
  );
}
