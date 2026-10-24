# Performance

Play a song or a whole set from one screen: stems, a metronome, lyrics and chords, and timed MIDI commands for your GP-150 or GP-180 and the pedals behind it.

- [Prepare a song](#prepare-a-song)
- [Lyrics and chords](#lyrics-and-chords)
- [MIDI cues](#midi-cues)
- [Pedal commands](#pedal-commands)
- [Bluetooth](#bluetooth)
- [Playlists](#playlists)
- [Stage mode](#stage-mode)
- [Troubleshooting](#troubleshooting)
- [Limits](#limits)

## Overview

Open **Song → Performance**. It needs audio loaded in **Stems**; splitting into stems is optional. After a split, Performance plays the stems together with a mute switch and volume slider for each one.

Everything here works in the desktop app. The browser build can play a song and send USB MIDI, but has no song library and no sleep prevention. Saved songs, backups and playlists are covered in the [song library guide](SONG-LIBRARY.md).

## Prepare a song

1. Load the audio in **Stems** and split it if you want the stems.
2. Set **Song BPM** to the recording's tempo while stopped. It is a label for the metronome and tempo commands, not a speed control, and the app does not detect it for you.
3. Add lyrics, chords and MIDI cues (below).
4. Enter a title and artist and choose **Save song to library**. Use **Save song changes** after later edits.

**Key.** Performance estimates the song's major or minor key in the background, from the guitar stem first and the original mix as a last resort. It shows **Unknown** rather than guess. Use **Key override** to save a correction. The key only changes how chords are displayed, never the audio or any MIDI.

**Metronome.** The **Metronome** switch is remembered globally and follows playback. To line it up with a recording that has an intro, pause on the first downbeat and choose **Metronome settings → Set first beat here**. Fine-tune with **First beat (seconds)**, or **Reset first beat**. The grid is fixed, so it cannot follow a recording that speeds up or slows down. It does not move lyrics or MIDI cues.

## Lyrics and chords

The reader shows the lyrics with the chords above them and follows playback. Turn **Follow playback** off to scroll freely, use **A− / A+** for text size, or **Expand performance view** for a larger reader with transport buttons. Click any chord for guitar tabs in standard tuning (`x` is muted, `0` is open); they follow the displayed transposition.

To edit, choose **Edit chords, lyrics & MIDI**. Each row has a time, chords, lyrics, MIDI commands and an optional label. Playback pauses while you edit, and invalid MIDI is rejected when you save. You can also paste or import TXT, LRC or bracket-chord text under **Separate lyrics and chart editors**, and export the chart.

Give every line a timestamp so it follows playback:

```text
[00:00.00] [C]**Verse**
[00:12.50] [Am]Words here {midi:pc 1 0}
[00:24.00] [F]Chorus {midi:cc 1 64 127}
```

Untimed lines stay visible for manual reading. `**bold**` and `*italic*` work; full ChordPro directives do not. Transposing changes chord symbols (slash basses included) but not the audio.

**Automatic drafts.** After a split, Performance estimates chords from the guitar stem and, when the song has none, transcribes lyrics from the vocals with a local Whisper model. Choose **Lyrics language** first if you know it. The first run downloads the model; nothing is uploaded. Chord estimates cover major and minor triads only. Treat both as drafts and check them before you play, because dense mixes and backing vocals cause mistakes. Anything in your own chart takes priority over a draft.

## MIDI cues

A cue is a MIDI message sent at a time in the song. Write them in the chart as `{midi:…}` tokens, or build them with **Song MIDI cues**.

| Token | Message | Notes |
| --- | --- | --- |
| `{midi:pc ch n}` | Program change | Channel 1–16, program 0–127. |
| `{midi:cc ch n v}` | Control change | Controller and value 0–127. |
| `{midi:note ch n v}` | Note on | Needs a matching `off` later. |
| `{midi:off ch n 0}` | Note off | |
| `{midi:sysex F0 … F7}` | System exclusive | Hex bytes. |

Empty or incomplete tokens are rejected instead of being dropped silently.

To send cues, pick an output, then switch on **Send cues**. This is called arming, and it is never saved with a song. Reopening a song starts disarmed.

- Pause, seek, leaving Performance or changing the output clears anything queued.
- Seeking pauses; pressing Play starts cues from the new position. Earlier cues are not played as cues, but the pedals are brought to the state they would be in: just before the song starts, the app sends the latest bank select and program change for each channel, then the latest value of each controller. It does the same if a stall drops a patch or controller change.
- Looper, tap tempo, footswitch and similar trigger controllers are never replayed this way. Notes and clock are not either, and SysEx is replayed only when the cue has `{chase}`.
- Add `{chase}` to a cue to always replay its commands, or `{nochase}` to never replay them. Cues built from a pedal's trigger commands get `{nochase}` automatically. Preflight warns about a controller that is pressed and released within half a second without `{nochase}`.
- Removing the port disarms.
- Cues past the end of the audio are not scheduled.

**MIDI preflight & timing** (collapsible) lists cues beyond the audio, conflicting or dense commands, missing note-offs and channel clashes. Warnings are advice; they never change or disable a cue. The app cannot read a pedal's receive channel, so check those yourself.

### Tempo and clock

For the GP-180, send the tempo once and let the pedal generate the clock. Apply the **GP-150 / GP-180 + pedals** setup preset (below), or add **Valeton GP-180 → Set tempo (BPM)** at time zero. On the pedal, set Clock Source to Internal and TRS clock output to On. Update a saved tempo cue by hand if you change the Song BPM. The preset uses the current BPM (40–300) automatically.

**Send MIDI Clock** (24 pulses per beat, with Start and Stop) is available for receivers that handle it, is remembered per song, and is switched off while automatic tempo is on. It was not stable on the tested rig, see [Hardware results](#hardware-results). Do not route output back into an input.

External **Start/Continue/Stop**, or CC 80 with a value of 64–127 on any channel, plays and pauses the song. A GP-180 MIDI footswitch can send CC 80.

### Setup presets

Choose one under Performance and apply it:

- **GP-150 / GP-180 + pedals** (Bluetooth or USB): sends the song BPM once on playback start, with the clock left off. The tempo goes on channel 16 by default; match the pedal's receive channel, or OMNI.
- **MIDI commands only**: plays saved cues with no automatic tempo or clock.
- **Continuous clock**: turns on song MIDI clock.

The app remembers port choices, the preset, the selected pedal and command, pedal channels and assigned CCs on this computer. Bluetooth always needs a manual connection. **Show MIDI commands** hides or shows cue markers and the builder without affecting playback.

## Pedal commands

**Song MIDI cues** has named commands for the Strymon TimeLine, BOSS RC-10R, IR-200 and SY-200, and the GP-150 and GP-180. Choose the pedal, its receive channel and a memory or function, then **Add pedal command** to save it in the chart or **Send pedal command now** to test it. Search by memory number or function. Bank select is added where a pedal needs it, and **Raw MIDI command** is always available.

The channel you pick addresses the pedal; it does not change the pedal's own setting. Starting channels are TimeLine 1, RC-10R 2, IR-200 3 and SY-200 4, and your saved choices take precedence. BOSS assignable controls need the matching **Assigned CC** from the pedal. For the full list of profiles, community pedals and custom JSON, see [MIDI pedal command presets](MIDI-PEDALS.md).

Exported charts carry readable labels and the MIDI messages, so another computer can play the chart without your pedal profiles.

## Bluetooth

Bluetooth MIDI carries performance cues, transport input and clock. If the link drops, the app shows "Reconnecting… (attempt n)" and retries by itself (after 0.5, 1, 2, 4 s and so on, up to 30 s between attempts) without asking you to pick the device again. Choose **Stop reconnecting** to give up. After it reconnects the song stays disarmed: check the pedal, rearm and choose where to resume. Bluetooth editor management is off, so use USB to read or write presets and settings. Bluetooth audio and Bluetooth MIDI are separate services.

To send cues from Performance to a GP-180 and on to pedals on its MIDI OUT:

1. Open **Performance MIDI controller**, choose **Connect Bluetooth MIDI** and pick the pedal's MIDI service. This also selects it as the output.
2. On the pedal, set **MIDI IN Source** to **BT Only** or **Mixed**, and set **EXP/FS jack 2** to MIDI OUT. Set each downstream pedal's channel and check the GP-180's channel filtering.
3. In **Song MIDI cues**, add a command with its time, channel and PC or CC.
4. Switch on **Send cues** and use **Send MIDI now** to check the pedal responds. A finished write does not prove the message came out of the MIDI OUT.
5. Play the song.

Valeton's documents do not clearly describe Bluetooth-to-TRS forwarding, so test your own rig. A pedal's Bluetooth service must be a standard BLE-MIDI service. Keep the pedal's phone app disconnected and the pedal nearby.

### Hardware results

All results are from a GP-180 (firmware 1.1.1) with a Strymon TimeLine on its MIDI OUT. GP-150 has not been tested on hardware.

| Date | Test | Result |
| --- | --- | --- |
| 21 Oct 2026 | USB read-only inspection and full 200-preset backup | Passed. No writes were tested. |
| 21 Oct 2026 | Bluetooth editor handshake | Connected but no replies, so editor use over Bluetooth is disabled. |
| 22 Oct 2026 | Timed patch changes over Bluetooth, 15 → 16 → 13 | Passed. The TimeLine followed, and a seek did not replay cues. |
| 22 Oct 2026 | One-time tempo command (120 and 141 BPM) over Bluetooth | Held steady on both pedals. |
| 22 Oct 2026 | One-time tempo command (90 and 120 BPM) over USB | Held steady on both pedals. |
| 22 Oct 2026 | Continuous clock over Bluetooth | Failed: large tempo jumps. |
| 22 Oct 2026 | Continuous clock over USB | Failed: drift of about 3 BPM (119–122 at 120). |

The rig had the GP-180 receiving OMNI and the TimeLine on channel 1, so tempo on channel 16 reached only the GP-180. To keep downstream program changes from recalling GP-180 patches, consider setting the GP-180 to receive on 16 as well; that has not been confirmed on hardware.

## Playlists

Under **Song → Songs & playlists**, make a playlist from saved songs. Entries can repeat, and edits save at once. Choose **Check playlist** to review every entry before the set (it reads saved songs, so save first), **Load set paused** to prepare, or **Play playlist** / **Play from here** to go.

The set loads and starts each next song, then stops after the last one. Performance shows the position, the next title, **Previous song / Next song** and **Stop playlist**. Songs load one after another, so there is a short gap between them.

An armed MIDI output stays armed across songs while the same device stays connected. For cues from the first second, choose **Load set paused**, connect and switch on **Send cues**, then press **Play playlist** in Performance. Starting a playlist again from the library starts a new disarmed session.

Before a set:

1. Save each song with its audio, chart and BPM, and check any draft lyrics and chords.
2. **Load set paused**, connect the output, apply the setup preset and check each pedal's receive channel.
3. Read **MIDI preflight & timing** per song and **Check playlist** for the set.
4. Arm with **Send cues**, then play.
5. After a disconnect or timing fault, pause, check what the pedals are actually set to, reconnect, rearm and choose where to resume.

Finish analysis and backups before you start. Heavy work during playback can hurt timing.

## Stage mode

Choose **Enter stage mode** in Performance. The window fills with large lyrics and transport buttons, and MIDI status and faults stay visible. Setup, the mixer, editors, seeking, rewind and chord popups are locked, and Escape or clicking outside does not exit.

- **Play/Pause** and **Stop playback** stay available.
- **Panic / stop MIDI** pauses playback, clears queued MIDI and disarms. It cannot undo commands a pedal already received.
- **Exit stage mode** unlocks everything. Leaving the Performance screen also exits.
- Stage mode does not arm MIDI or change the BPM, and it stays on across playlist songs.

On the desktop, playback in stage mode keeps the computer and display awake. It lets go on pause, at the end of the set, on exit or if the app closes. It does not override a closed lid or a deliberate sleep.

## Troubleshooting

- **Nothing reaches the pedal.** Check that **Send cues** is on, the right output is selected and the channel matches the pedal. Use **Send MIDI now** to test one command.
- **"N late MIDI commands dropped" notice.** A stall (a busy window, a slow driver) never disarms the song. A program change, controller or SysEx more than 250 ms late is dropped instead of played out of place, late clock pulses are skipped, and the schedule re-syncs to the audio. Note-offs are always sent. The notice shows where it happened, and the dropped commands are counted in Diagnostics. Check the pedal if a patch looks wrong.
- **Bluetooth: "late messages dropped".** A Bluetooth command that is more than 250 ms late when it reaches the radio is dropped, counted under the Bluetooth status and never closes the link. The link closes only on a write error, a write timeout or a Bluetooth disconnect, and it then reconnects automatically.
- **Cues stopped and the output disarmed.** This now only happens when timing cannot recover: the scheduler worker failed, the audio clock stopped advancing, three re-syncs happened within five seconds, or the output disconnected. Queued commands are cleared and audio keeps playing. Check the pedal, rearm and choose where to resume.
- **Bluetooth closed by itself.** A write that waits more than 250 ms, or takes more than a second, closes the connection and is not retried, because the pedal may already have got it.
- **Tempo jumps.** Turn **Send MIDI Clock** off and use the one-time tempo command.
- **A pedal answers the wrong command.** Two pedals share a channel, or the pedal is on OMNI. Give each its own channel.
- **A looper stops by itself.** Pause and panic only release channels that sent notes, because blanket CC 64 is the GP-180 looper Stop.
- **USB editor does not connect.** Connect the powered pedal by USB and use **Look for the pedal**. Make sure its MIDI input allows USB and close other MIDI apps.
- **Bug reports.** **Copy diagnostic report** and **Save log** in Diagnostics include Bluetooth state, write and notification counts and MIDI traffic. The **Bluetooth clock timing** and **Reset timing counters** controls show queue lateness.

## Limits

- Timing is best effort. The cue scheduler runs in its own worker. USB and system MIDI cues are handed to Web MIDI up to a second ahead with exact timestamps, so a busy window cannot delay them; Bluetooth cues are held about 120 ms ahead because Bluetooth cannot timestamp on the receiving side. Delivery still goes through Web MIDI or Bluetooth and the operating system, and delivery goes through Web MIDI or Bluetooth and the operating system. A queued command is not an acknowledgement from the pedal.
- The app cannot read a pedal's channel, routing or state. Missed commands are never reconstructed.
- Playlists are not gapless. Audio is never stretched or pitch-shifted.
- Chord estimates cover major and minor triads, and key estimates are ambiguous for modal music, relative keys and key changes. Lyrics from Whisper can be wrong. Accuracy on real songs has not been measured.
- Pedal profiles come from manuals and are tested at byte level. Only the GP-180 and TimeLine results above come from real hardware.
- Bluetooth editor management and RTP-MIDI are not supported.
