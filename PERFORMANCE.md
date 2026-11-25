# Performance

Play a song or a whole set from one screen. You get stems, a metronome, lyrics and chords, and timed MIDI commands for your GP-150 or GP-180 and the pedals behind it.

## Overview

Open **Song → Performance**. You need audio in **Stems** first. Splitting into stems is optional.

The play controls and tempo stay at the top. Pick a view below them:

- **Play**: sections, the mixer and the lyrics reader. Use this on stage.
- **This song**: speed and pitch, trim and fades, key, imported tracks, generated drums and bass, sections and cues. Saved with the song.
- **Lyrics & chords**: lyrics, the chart editor and chords.
- **MIDI**: the MIDI check, controller setup and the song's cues.
- **Setup**: audio outputs, audience display, band sync, remote control. These apply to every song.

The desktop app has everything here. The browser build can play a song and send USB MIDI, but has no song library and no sleep prevention.

Related guides: [song library](SONG-LIBRARY.md) (saving, playlists, backups), [MIDI pedals](MIDI-PEDALS.md) (pedal profiles, triggers, macros) and [song maps](SONG-MAP.md).

## Prepare a song

1. Load the audio in **Stems** and split it if you want stems.
2. Set **Song BPM** to the recording's tempo while stopped.
3. Add lyrics, chords and cues.
4. Choose **Save song to library**. Use **Save song changes** after later edits.

### Tempo and beat

- The analysis detects the tempo. **Detect** finds it again and offers the half or double if the beat was counted wrong.
- If you set the tempo by hand, **Find the beat at N BPM** finds the beat from your number. Tick **Keep exactly N** to keep your number.
- **Tap tempo** (or the **T** key) sets the BPM while stopped. **Undo** puts back the previous tempo and grid.

### Key and sections

- The analysis estimates the major or minor key. **Key override** saves a correction. The key only changes how chords are shown.
- Sections are suggested on the bar lines: intro, verse, chorus, bridge, solo and outro. Name and edit them in the section editor.
- Each section has an end mode: **Continue**, **Repeat once**, **Loop until released**, **Skip** or **Pause at end**.
- Older songs have no suggested sections. Press **Analyse again** to get them.

### Metronome and count-in

- **Metronome** is **Off**, **While stopped**, **While playing** or **Both**. Each song keeps its choice.
- Pause on the first downbeat and choose **Set first beat here** to line up the click.
- A count-in of one or two bars, a pre-roll and a start delay (up to 10 s) are set in **Metronome settings**.
- **Sound** picks the click, sticks, hi-hat, kick and hat, or ride. **My samples** loads your own WAV, FLAC or MP3 (2 seconds at most).
- **Send the click as MIDI** sends each beat as a drum note on channel 10, or the channel you choose. The MIDI click does not need **Send cues**.

### Audio outputs

Open **Audio outputs** to route four buses: **Main**, **Click**, **Aux 1** and **Aux 2**. Each has an output pair, a gain and a **Test** button. Each track's **Bus** in the mixer decides its route. Changes apply without stopping the song.

The **Rig audio check** in Audio outputs and MIDI health lists the active routes. A missing Main device falls back to the system default when available. A private click mutes if its dedicated device or pair drops out and resumes when the route returns. The panel warns when the metronome or count-in shares Main. Use **Test backing level** with playback stopped and the monitor turned down. It sends two seconds of pink noise at −18 dBFS RMS before applying Main gain.

### Speed and pitch

- **Speed** runs from 50% to 150%. **Pitch** shifts up to ±6 semitones, with ±50 cents of fine tune.
- **Follows pitch** is set per track. Drums start off.
- **Apply pitch to chords** and **Capo** change the chord names shown, not the audio.
- Changes while playing render in the background and start on the next beat.
- The metronome is never stretched.

### Multitrack import

- **Add tracks…** or **Add folder…** adds up to 32 extra audio tracks to a song.
- Put options in the file name, such as `01 Keys L [bus=Aux1] (color=blue) (group=1,2).wav`. Use `bus=`, `gain=`, `pan=`, `pitch=`, `group=` and `color=`.
- Tracks within 5 s of the set's median length are padded or cut. Longer differences are refused.
- **Normalise song volume to −14 LUFS** applies one gain to the whole song.

### Solo scales

- **Solo scale** shows where to solo on the neck for the song's key. It starts on the minor pentatonic.
- Pick another scale, a root, and **Whole neck** or a box position. The diagram follows transpose, pitch and capo.

### Generated drums and bass

Open the Band panel with **Generate drums & bass…**. It writes drum and bass tracks that follow the grid, chords and sections.

- Check the beat grid first. Fix it with **Half tempo**, **Double tempo**, the downbeat and nudge buttons, or **Use fixed BPM**.
- Pick a style (Rock, Pop, Ballad, Country, Funk, Half-time, Reggae, Shuffle, Metal or 6/8) and tune the sliders.
- Each section sets its energy, fill and bass part. Bass parts include **Ring out**, **Root pulse**, **Groove**, **Melodic**, **Walking**, **Pedal** and **Rest**.
- **Generate** adds **Drums (generated)** and **Bass (generated)**. **Try another** makes a new take. **Remove generated parts** takes them out.
- **What plays** picks Original, Generated or Both for each part. Fix a wrong bass note by clicking its beat in the strip.
- **Use my rendered drums…** or **Use my rendered bass…** plays your own WAV, FLAC, MP3, M4A or OGG render instead.
- **Drum tone** and **Bass tone** run a chain of up to six NAM captures or IRs. The web build cannot use them.
- **Export MIDI…** saves the parts as a MIDI file. **Export for BOSS RC-10R…** exports six rhythm passages for the pedal.
- Preview a few sections before a show.

### Practice mute

On the Play tab, tick **Guitar**, **Vocals**, **Bass**, **Drums**, **Piano** or **Other** under **Practice mute**. Every song that loads is muted for that instrument. Songs keep their own mix, and the setting comes back after a restart.

## Lyrics and chords

- **Generate lyrics from vocals** writes lyrics with a local Whisper model. Nothing is uploaded. Set **Lyrics language** first if you know it.
- After a split, the app drafts chords from the stems. Check drafts before you play. Your own chart always wins.
- The reader follows playback when **Follow playback** is on. Click a chord for a guitar shape. **A− / A+** changes the text size.
- **Edit chords, lyrics & MIDI** edits each row. Playback pauses while you edit.

Give lines a timestamp so they follow playback:

```text
[00:00.00] [C]**Verse**
[00:12.50] [Am]Words here {midi:pc 1 0}
[00:24.00] [F]Chorus {midi:cc 1 64 127}
```

- Untimed lines stay on screen but do not move.
- `**bold**`, `*italic*`, `# heading` and `{color:red}…{/color}` work. A `// ` line is for the editor only.
- **Autoscroll** moves **Line by line**, **Between timed lines** or at a **Constant speed**. A manual scroll pauses it for six seconds.
- **Import** reads ChordPro and chords-above-lyrics text (`.cho`, `.chordpro`, `.pro`, `.crd`, `.txt`). Import replaces the chart, so remove its MIDI commands first.

### PDF charts

- **Attach PDF chart** adds a lead sheet or score. **Show PDF chart** and **Show text chart** switch between them.
- Pen, highlighter and text notes are saved with the song. **Turn page at this time** records page turns while you rehearse.
- A PDF over 50 MB is refused.

## MIDI cues

A cue is a MIDI message at a time in the song. Write it as a chart token, or build it in **Song MIDI cues**.

| Token | Message | Notes |
| --- | --- | --- |
| `{midi:pc ch n}` | Program change | Channel 1–16, program 0–127. |
| `{midi:cc ch n v}` | Control change | Controller and value 0–127. |
| `{midi:note ch n v}` | Note on | Needs a matching `off` later. |
| `{midi:off ch n 0}` | Note off | |
| `{midi:sysex F0 … F7}` | System exclusive | Hex bytes. |

Empty or incomplete tokens are rejected. Triggers, cues on a section, macros and song MIDI files are in the [MIDI pedal guide](MIDI-PEDALS.md#triggers-macros-and-song-midi-files).

### Arming

- Pick an output and switch on **Send cues**. This is called arming. It is remembered for that output across songs and restarts.
- **Disarm** or **Panic / stop MIDI** turns it off. Removing the port disarms.
- Pausing, seeking or leaving the Song screen clears queued cues.
- After a seek, the app first sends the latest bank, program change and controller values, so the pedals match the new position.
- Looper, tap tempo and trigger controllers are not replayed. Add `{chase}` or `{nochase}` to change that for one cue.
- **MIDI preflight & timing** warns about cues past the audio, conflicts and missing note-offs. Warnings never block a cue.

### Before song preparation

Some pedals need time to load a preset before the music starts.

- **Prepare pedals** runs the setup and stops at **Ready to play**. Press **Play** when you are ready.
- In **Song MIDI cues**, set **When → Before song**. In a chart, use `{midi@prepare:pc 1 5}`.
- Set the **Preset loading wait** and **Gap between setup commands** per song, or with **Use these as defaults**. Each line can add its own **Wait after (s)**.
- **Next preparation sequence** shows the exact order. The preview sends nothing.
- **Cancel start** stops the remaining commands. It cannot undo commands a pedal already received.
- **Ready** means the commands were sent. It does not confirm the pedal's settings.

#### Preparation command repeat rules

| Repeat | Behaviour |
| --- | --- |
| **Every start** | Runs on each new preparation, including resumes. This is the default. |
| **Only from beginning** | Runs only when preparing from the song's start. |
| **Once per song load** | Runs once after a load. Pausing or seeking does not re-enable it. |

**Reset once commands** clears this history without sending anything.

### Tempo and clock

- **GP-180 tempo:** send the tempo once and let the pedal make the clock. Use the **GP-150 / GP-180 + pedals** preset, or add **Valeton GP-180 → Set tempo (BPM)** at time zero.
- **Send MIDI Clock** was not stable on the tested rig. See [hardware results](#hardware-results).
- **MIDI timecode** sends 24, 25 or 30 fps (non-drop), with an offset per song. It replaces app clock. Use USB.

### Setup presets

- **GP-150 / GP-180 + pedals**: sends the song BPM once at start, with no clock. Tempo goes on channel 16 by default.
- **MIDI commands only**: plays cues with no tempo or clock.
- **Continuous clock**: turns on song MIDI clock.

## Pedal commands

**Song MIDI cues** has named commands for the Strymon TimeLine, BOSS RC-10R, IR-200 and SY-200, and the GP-150 and GP-180. Pick the pedal and channel, then **Add pedal command** or **Send pedal command now**. Pedal profiles and custom pedals are in the [MIDI pedal guide](MIDI-PEDALS.md).

The channel addresses the pedal. It does not change the pedal's own setting.

### Automatic RC-10R rhythm cues

- **Automatic RC-10R drums** in **MIDI** plans memory recalls, pattern changes and the ending for a song or playlist. **Preview automatic cues** first.
- Match the receive channel and the four CC assignments to the pedal's MIDI menu.
- **Save automatic cues** adds a marked block to each song.
- Test the whole song, including the last chorus, before a show.

### Remote control

Every live action can run from a MIDI message, a key or a Bluetooth page-turner. Choose **Edit remote control** to see the bindings.

- **Defaults:** **Start** and **Continue** play, **Stop** pauses, and **CC 80** (64–127) plays or pauses. **Page Down** and **Page Up** move between sections, or turn PDF pages. **T** taps tempo.
- **Learn MIDI** or **Learn key** binds the next message. Controllers can be **Momentary**, **Threshold** or **Toggle**.
- Tick **Double press** for risky actions such as Stop or Panic.
- Keys do nothing while you type in a field.

### Load songs from MIDI

A program change or Song Select on the selected input can load a saved song.

- Turn it on under **Load songs from MIDI**. In a song's **Song trigger** panel, choose **Learn trigger**.
- **While a song plays** is **Ignore** (default), **Arm as next** or **Stop and load now**.
- The song waits for Play unless **Start a song as soon as a trigger loads it** is on.

## Playlists

Make playlists under **Song → Songs & playlists**. Sets, smart playlists, the queue and history are in the [song library guide](SONG-LIBRARY.md#playlist-sets-and-smart-playlists).

- **Check playlist** reviews every entry before a set. Save first.
- **Load set paused** prepares the set. **Play playlist** or **Play from here** starts it.
- Each next song loads in the background. Most joins are gapless.
- Switching to another Song tab keeps the set playing. Leaving the Song screen pauses it.

### Gapless and crossfade

- **Crossfade (s)** runs from 0 to 10 seconds. At 0 the join is gapless. **Crossfade to next** starts the next song early.
- **Trim start** and **Trim end** cut the ends. **Auto** trims to the audible part.
- **Fade in** and **Fade out** run from 0 to 10 seconds.
- **At the end** is **Play the next song**, **Stop the playlist** or **Loop the song**.

### Live jumps and loops

- **Tap a section** to arm a jump. **Double-tap** to jump now.
- **Loop** repeats the current section until you tap **Exit loop**.
- Jumps keep the metronome on the bar grid. Cues in a skipped section are not sent.

## Stage mode

Prepare the song or set, arm MIDI, then choose **Enter stage mode**.

- Large lyrics, a status strip (section, bars left, what is next) and a timeline. Setup, the mixer and seeking are locked.
- **Play/Pause** is always there. **Stop playback** and **Panic / stop MIDI** need a 0.6 s hold or a second press.
- **Panic / stop MIDI** pauses, clears queued MIDI, disarms and turns Send cues off.
- Stage mode does not arm MIDI or change the BPM. It stays on across playlist songs.
- Scheduled cues show the chart plan. Rig state distinguishes preset commands sent by the app from incoming pedal reports. The status strip shows audio warnings, MIDI drops and a clean resync. **Exit Stage** returns to the editor.
- On the desktop, stage playback keeps the screen awake until you pause or exit.

### Audience display

- **Open audience display** opens a second window for the lyrics, chords or a PDF page. Choose **Show on** to pick the display.
- If the display is unplugged, the window moves to the main screen. Playback continues.
- **Black between songs** and **Blackout** blank the screen.

### Band sync

Band sync lets bandmates follow on phones or tablets. It is off until you start it.

- Choose a private network address and port (8787 by default), then **Start band sync**.
- Bandmates open the address or scan the QR code, then type the six-digit PIN.
- **Allow followers to play, pause and stop** is off by default. **Stop band sync** disconnects everyone.
- The traffic is not encrypted. Use it on a network you trust.

## Bluetooth

Bluetooth MIDI carries cues, transport input and clock. It cannot edit the pedal. Use USB for presets and settings. Bluetooth audio and Bluetooth MIDI are separate. Pairing the pedal as a speaker does not give you MIDI.

### Connect on Mac

1. In the Device screen, choose **Open macOS MIDI setup**.
2. In Audio MIDI Setup, choose **Window → Show MIDI Studio**, then **MIDI Studio → Open Bluetooth Configuration**.
3. Connect the pedal. Return to Tone Studio.
4. Enable USB / system MIDI if needed, select the pedal's **MIDI output**, then switch on **Send cues**.

### Connect on Windows or in a browser

1. Keep Valeton's phone app disconnected, and keep the pedal close by.
2. In the Device screen header, choose **Connect Bluetooth MIDI** and pick the pedal.
3. If the pedal asks for a PIN, pair it in your system's Bluetooth settings first.

The chooser lists GP-150, GP-180 and Valeton devices, and any device with the standard Bluetooth MIDI service.

### Send cues over Bluetooth

1. On the pedal, set **MIDI IN Source** to **BT Only** or **Mixed**. For pedals downstream, set **EXP/FS jack 2** to MIDI OUT.
2. Set each downstream pedal's channel. Check the GP-180's channel filter.
3. Add a timed command in **Song MIDI cues**, switch on **Send cues**, then use **Send MIDI now** to check the pedal responds.
4. Play the song.

### Reconnects and diagnostics

- If the link drops, the app shows **Reconnecting… (attempt n)** and retries by itself, up to every 30 seconds. **Stop reconnecting** gives up.
- A reconnect never starts playback. The song stays disarmed. Check the pedal, then rearm.
- A timed command more than 250 ms late is dropped and counted. The link stays open.
- A write that fails or takes over a second closes the link. It is not retried.
- **Copy diagnostic report** and **Save log** include Bluetooth state and counters.

### Hardware results

Rig: Valeton GP-180, firmware 1.1.1, with a Strymon TimeLine on its MIDI OUT. GP-150 has not been tested on hardware.

| Date | Rig and link | Result |
| --- | --- | --- |
| 21 Oct 2026 | GP-180, USB | Inspection and full 200-preset backup: passed. |
| 26 Oct 2026 | GP-180, USB | Editor writes: passed. |
| 21 Oct 2026 | GP-180, Bluetooth | Editor hello connected but got no reply. Editor use over Bluetooth stays off. |
| 22 Oct 2026 | GP-180 + TimeLine, Bluetooth | Timed patch changes passed. One-time tempo (120 and 141 BPM) held steady. |
| 22 Oct 2026 | GP-180 + TimeLine, USB | One-time tempo (90 and 120 BPM) held steady. |
| 22 Oct 2026 | GP-180 + TimeLine | Continuous clock failed: large jumps over Bluetooth, about 3 BPM drift over USB. |
| 28 Oct 2026 | GP-180, Bluetooth | Packed writes out of order (2 of 17 pairs). Passed after the ordering fix (17 of 17). |

## Troubleshooting

- **Nothing reaches the pedal.** Check that **Send cues** is on, the output is right and the channel matches the pedal. Use **Send MIDI now** to test one command.
- **"N late MIDI commands dropped".** A stall never disarms the song. A message more than 250 ms late is dropped rather than played out of place. Note-offs are always sent. Check the pedal if a patch looks wrong.
- **Cues stopped and the output disarmed.** Timing could not recover. Check the pedal, rearm and choose where to resume.
- **Tempo jumps.** Turn **Send MIDI Clock** off and use the one-time tempo command.
- **A pedal answers the wrong command.** Two pedals share a channel, or the pedal is on OMNI. Give each its own channel.
- **USB output silent after the Mac sleeps.** The app requests the ports again on wake. Send cues arms the pedal again if it returns.
- **USB editor does not connect.** Connect the powered pedal by USB and use **Look for the pedal**. Close other MIDI apps.
- **Bug reports.** Use **Copy diagnostic report** or **Save log** in Diagnostics.

## Limits

- Timing is best effort. USB and system MIDI cues go to Web MIDI up to a second ahead. Bluetooth cues go about 120 ms ahead. A queued command is not an acknowledgement from the pedal.
- The app cannot read a pedal's channel, routing or state. Missed commands are never rebuilt.
- Gapless joins happen only when the next song is ready in time.
- Audio outputs, speed and pitch, gapless joins, multitrack import and MIDI timecode are not yet tested on hardware.
- Chord estimates cover common chord types only. Key estimates are less certain for modal music and key changes. Whisper lyrics can be wrong.
- Pedal profiles come from manuals. Only the GP-180 and TimeLine results above come from real hardware.
- Bluetooth editor management and RTP-MIDI are not supported.
