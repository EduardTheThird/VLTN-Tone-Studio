# Performance and GP-180 support

## Use

Saved songs and ordered playlists are available in the desktop app under **Song → Songs & playlists**. See [the song library guide](SONG-LIBRARY.md) for offline storage and live set controls.

Open **Song → Performance**. Load audio through Stems first; splitting is optional for playback. After a split, Performance plays the stems together and offers individual mute switches. The existing Stems mixer retains its level, solo and WAV-export controls.

Paste or import TXT, LRC or bracket-chord text. Lyrics and BPM are saved locally under the audio filename, sample rate and length. Export charts for backup: audio and stems are not saved by this feature. Two files with identical names and lengths share a chart key. Transposition affects chord symbols, including slash bass notes, without pitch-shifting audio. Bold (`**text**`) and italic (`*text*`) formatting are supported; full ChordPro directives are not.

Use timestamps on every displayed line for playback-following lyrics:

```text
[00:00.00] [C]**Verse**
[00:12.50] [Am]Words here {midi:pc 1 0}
[00:24.00] [F]Chorus {midi:cc 1 64 127}
[00:25.00] {midi:note 1 60 100}
[00:26.00] {midi:off 1 60 0}
[00:27.00] {midi:sysex F0 7D 01 F7}
```

This is Tone Studio syntax. MIDI channels are 1–16, PC/CC/note data are 0–127. Note events need explicit note-off events. Select an output, then enable **Send cues**. MIDI messages are scheduled with Web MIDI timestamps and 50 ms lookahead; this is not a hard realtime guarantee. Pause, seek, leaving the tab and panic clear queued messages and release notes. Seeking pauses audio and skips earlier cues; pressing Play starts cues at the selected position. Editing a chart pauses playback. Port removal disarms output.

MIDI Clock emits 24 pulses per beat at the chosen BPM with transport messages. External transport input accepts Start/Continue/Stop or CC 80 with value 64–127 (any channel). Configure a GP-180 MIDI-command footswitch to send CC 80 to use it as play/pause. USB ports use Web MIDI; **Connect Bluetooth MIDI** provides standard BLE-MIDI input/output. See [Bluetooth and hardware evidence](BLUETOOTH.md). RTP-MIDI is not implemented. Do not loop output back to input.

**Set GP-180 patch tempo** and **Recall 001–200** use the existing driver paths and work in the simulator. Real GP-180 editor sessions now default to read-only inspection, so these actions are rejected before transmission until writes are separately validated. Other external gear can use explicit standard MIDI commands in the chart.

The standalone rhythm has adjustable BPM, tap tempo, beats per bar, gain and click/synth drum sounds. It runs independently of song transport: start/stop it separately. It does not stretch the recording or phase-lock to its drummer. MIDI Clock follows song playback, not this standalone practice rhythm.

After splitting, opening Performance automatically estimates major/minor chords from guitar. Missing or near-silent guitar falls back to piano, then other, bass, vocals or drums. The **Chord source** selector allows an explicit override: sound in a separated guitar output does not prove a guitar is present. A worker performs windowed FFT/chroma-template matching. Results can be exported or appended to the editable chart. `N` means silence/uncertainty. Dense mixes, inversions and extended chords can be misidentified. This does not detect tempo.

**Lyrics text track → Generate lyrics from vocals** transcribes the isolated vocals locally with multilingual Whisper base through Transformers.js. First use downloads and caches quantized model files from Hugging Face. Audio is not uploaded. A bundled WebAssembly runtime runs in a cancellable worker; leaving Performance or changing the song cancels transcription. The separate editable LRC text track follows song playback, persists locally, and can be exported. It does not replace existing chords or MIDI cues. Regenerate replaces the text track only after a successful result; cancellation or failure preserves prior text. Singing and instrumental leakage can produce incorrect words and timing: review the draft. No transcription is started without a usable vocals stem.
