# Performance and GP-180 support

## Use

Saved songs and ordered playlists are available in the desktop app under **Song → Songs & playlists**. See [the song library guide](SONG-LIBRARY.md) for offline storage and live set controls.

Open **Song → Performance**. Load audio through Stems first; splitting is optional for playback. After a split, Performance plays the stems together and offers individual mute switches. The existing Stems mixer retains its level, solo and WAV-export controls.

**Lyrics & chords · Perform** combines the lyric track and chord changes in one reading view. Playback highlights the current line and chord and scrolls within the reader, including after seeking backward. Chart lyrics and chords take priority over automatic drafts; chord-only charts can accompany the separate transcribed lyrics. Chords appear above the lyric interval containing their timestamp, rather than claiming exact word alignment. Untimed text supports manual reading. Toggle **Follow playback** to scroll freely, use **A− / A+** for text size, or **Expand performance view** for a larger view with transport controls (Escape closes it). The original tracks, chart editor, and chord-source controls remain under **Separate lyrics and chart editors**.

Click a chord in the reader, chart preview, or stem estimates to open its guitar tabs. Standard tuning is assumed, with high e at the top and low E at the bottom; `x` means muted and `0` means open. Several positions are offered with barre shapes first, preferring closed shapes over open-string shapes. Tabs follow the displayed transposition. Common major, minor, seventh, suspended, diminished, augmented, power and slash chords are supported; unsupported spellings show an explicit message. Shapes are checked against the chord tones and requested bass. Escape closes the overlay without closing the expanded reader or stopping playback.

## Pedal command library

**Song MIDI cues** now offers named presets for TimeLine, RC-10R, IR-200, SY-200 and GP-180. Choose the pedal and its receive channel, then select a memory or function. Bank-select sequences are generated where needed. BOSS assignable controls require the matching CC setting from the pedal. Cues retain readable labels in the chart and scheduled-cue list. **Raw MIDI command** remains available. See [pedal profiles and custom JSON import/export](MIDI-PEDALS.md).

## Recognition implementation and limits

The existing AI pipeline separates stems with Demucs and transcribes the vocals with local quantized Whisper base through Transformers.js. Choose **Lyrics language** before regenerating to supply a known language instead of relying on automatic detection. Language hints are supported by the [Transformers.js speech recognition pipeline](https://huggingface.co/docs/transformers.js/v3.0.0/en/api/pipelines). The setting travels with the saved song options. Near-identical transcript chunks less than half a second apart are deduplicated; later repeated verses are retained.

Chord recognition is FFT/chroma matching, not a learned chord model, and still estimates major/minor triads only. It now analyses the louder stereo channel to avoid opposite-phase cancellation and removes isolated non-silent label changes between matching neighbours. Silence and sustained changes remain. These behaviours have synthetic regression tests; no real-song accuracy gain has been measured. Existing separation quality/source controls can help provide cleaner inputs, but the Whisper speech model cannot replace a chord recognizer. Extended-chord recognition and a larger lyrics model need a separate implementation and evaluation on labelled recordings; the tab vocabulary does not expand the recognizer's vocabulary.

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

**Bluetooth MIDI controller** uses Bluetooth independently of USB. Connect the GP-180 here to select its Bluetooth output, enable **Send cues**, and use **Song MIDI cues** to add PC/CC commands per time and downstream pedal channel. **Send MIDI now** sends the displayed command immediately while output is enabled. Bluetooth cues are scheduled with local timers and serialized GATT writes; the same lookahead is used, but delivery is best effort. To control pedals attached to the GP-180's physical MIDI OUT, verify Bluetooth-to-TRS forwarding on the pedal using [the wireless setup guide](BLUETOOTH.md#wireless-song-cues-through-the-gp-180). No USB editor connection or GP-180 editor write unlock is needed. **Enable USB / system MIDI** only enables additional system MIDI ports.

MIDI Clock emits 24 pulses per beat at the chosen BPM with transport messages. Changing BPM while playing changes the clock rate without sending Stop. External transport input accepts Start/Continue/Stop or CC 80 with value 64–127 (any channel). Configure a GP-180 MIDI-command footswitch to send CC 80 to use it as play/pause. USB ports use Web MIDI; **Connect Bluetooth MIDI** provides standard BLE-MIDI input/output. See [Bluetooth and hardware evidence](BLUETOOTH.md). RTP-MIDI is not implemented. Do not loop output back to input.

**Set GP-180 patch tempo** and **Recall 001–200** use the existing driver paths and work in the simulator. Real GP-180 editor sessions now default to read-only inspection, so these actions are rejected before transmission unless the user explicitly enables GP-180 writes. Write unlocking applies to the USB editor session. Bluetooth editor management is disabled; use USB for these driver-based actions. Independent Bluetooth MIDI cues remain available. Other external gear can use explicit standard MIDI commands in the chart.

The standalone rhythm has adjustable BPM, tap tempo, beats per bar, gain and click/synth drum sounds. It runs independently of song transport: start/stop it separately. It does not stretch the recording or phase-lock to its drummer. MIDI Clock follows song playback, not this standalone practice rhythm.

After splitting, opening Performance automatically estimates major/minor chords from guitar. Missing or near-silent guitar falls back to piano, then other, bass, vocals or drums. The **Chord source** selector allows an explicit override: sound in a separated guitar output does not prove a guitar is present. A worker performs windowed FFT/chroma-template matching. Results can be exported or appended to the editable chart. `N` means silence/uncertainty. Dense mixes, inversions and extended chords can be misidentified. This does not detect tempo.

**Lyrics text track** starts transcription automatically when Performance opens with a usable vocals stem and no saved lyrics. **Generate/Regenerate lyrics from vocals** retries or replaces the draft. It transcribes the isolated vocals locally with multilingual Whisper base through Transformers.js. First use downloads and caches quantized model files from Hugging Face. Audio is not uploaded. A bundled WebAssembly runtime runs in a cancellable worker; transcription continues when switching tabs or songs. Cancel explicitly to stop it. Completed lyrics are stored locally and also written back to an existing saved song. The separate editable LRC text track follows song playback, persists locally, and can be exported. It does not replace existing chords or MIDI cues. Regenerate replaces the text track only after a successful result; cancellation or failure preserves prior text. Singing and instrumental leakage can produce incorrect words and timing: review the draft. No transcription is started without a usable vocals stem.
