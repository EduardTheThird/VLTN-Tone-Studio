# Saved songs and live playlists

In the desktop app, open **Songs & sets**.

## Play your first backing track

1. Choose **Import audio…** and pick a recording. **Open player** takes the original mix to **Performance → Play**. Choose **Play song** to hear it.
2. To keep it for later, return to **Songs & sets** and enter a title and artist. Choose **Save song to library**, or select an existing set or **Create a new set** under **Add to set** and choose **Save and add to set**.
3. For an arrangement, open the saved song and choose **Check timing and audition band**. Use **Split stems** first if you want to replace a recorded part. [Prepare a Band arrangement](PERFORMANCE.md#prepare-a-band-arrangement).
4. In the playlist, use **Load set paused** to prepare, **Play playlist** to start from the top, or **Play from here** to start on an entry. After reordering or editing an existing playlist, choose **Save playlist** so those changes apply the next time you load it.

Songs restore their saved tempo, clock preference, chart, lyrics and mix. The app prepares the next recording while the current one plays. If it is ready, songs can join without a gap or with your selected crossfade. If it is still loading, the next song starts once it is ready. On a load error, read the message and reopen the affected song before resuming. Switching to another tab within **Songs & sets** keeps playback running. Leaving that screen pauses the set.

## What is saved

Each saved song has a unique ID independent of its filename. The library copies decoded source audio and all available stems as lossless 24-bit FLAC, one file per track; the original MP3 and NAS files are not modified or needed to reopen the song. It also saves the editable chord/MIDI chart, separate lyrics text track, BPM, transpose, chord-source override, metronome settings (including first-beat alignment) and stem mixer volume/mute/solo state. Stems and Performance share the saved mix. Imported tracks ([multitrack import](PERFORMANCE.md#multitrack-import)) are saved too, each as its own FLAC file, with their name, colour, bus, gain, pan, pitch choice and mute groups. Song-key estimates and manual key corrections are included in the performance options. Background lyrics/key updates that complete while audio is being saved are promoted into the saved song rather than replaced with the earlier settings snapshot.

MIDI port preferences are remembered globally on this computer; they are not part of a saved song or exported chart. Active playback is never saved to disk. **Send cues** is remembered globally for the output it was switched on for, so a song opened by hand, a tab switch or a restart arms that output again while it is connected, and again when it reconnects. A fault disarms at once, and **Disarm** or **Panic / stop MIDI** turns Send cues off. To send MIDI cues from the first instant of the set, choose **Load set paused**, connect and enable **Send cues** once, then press **Play playlist** in Performance. GP-150 and GP-180 USB editor sessions allow changes without a write-unlock switch. Bluetooth MIDI remains available for performance controls; Bluetooth editor management is disabled. Text/settings edits of a saved song are captured when moving to another saved song; use **Save song changes** before quitting to explicitly save all edits and newly generated audio. Completed automatic lyrics are written back to the saved song even if you switch tabs during transcription.

The data lives under `%APPDATA%\VLTN Tone Studio\song-library` on Windows. `library.json` holds the song and playlist metadata. UUID-named directories hold the audio revisions, each with files such as `source.flac` and `vocals.flac`. Do not rename files inside this folder. Use the portable backup controls below, or close the app and copy the complete folder; metadata-only copies do not contain audio. FLAC is lossless at 24 bits and typically takes about half the space of raw audio. A song's tracks are read straight from disk and decoded in the background, so nothing large is copied between processes when a song loads.

Songs saved by an earlier version used raw float32 files. The first time you start a newer version, the app converts them to FLAC in the background, one song at a time, with progress shown. The old files are removed only after the converted audio has been decoded and compared sample for sample, so an interrupted or failed conversion leaves the song as it was and is retried at the next start. A song that is still waiting to be converted shows a message if you try to open it. After conversion the library can no longer be opened by an older version of the app.

A save writes every audio asset before atomically replacing the index. Incomplete saves do not replace a previously saved song. Interrupted operations may leave unreferenced audio directories that the app cleans up later. Deleting a song removes it from playlists and deletes its managed audio; it never deletes the imported source. The UI requires a second confirmation for song/playlist deletion. Deleting a playlist keeps its songs.

## Portable backup and restore

In **Songs & sets**, use **Export library backup…**. Choose where to save the `.tar.gz` archive. It includes every saved song's copied source audio, available stems, every imported track, any PDF chart with its annotations, chord/MIDI chart, separate lyrics, BPM, key estimate/manual correction, mixer/performance options, and all playlists with their order and repeated entries intact. Original audio/NAS files are not needed to restore it.

Save a newly imported song or new stem split before exporting. Current local text/settings edits to an already-saved song are flushed before the backup begins. Audio and metadata are then exported as one consistent snapshot. Later edits and transcription results belong to a subsequent backup. The UI shows file-based progress while the main process streams the audio; the whole library is not copied into renderer memory.

### Restore a set offline

1. On the first computer, save playlist and song edits. Open **Playlist menu → Export this set…**. The backup includes saved audio, rendered parts, charts, mixes, cues, and any recorded rig or dependency information. For a smart playlist, it includes the songs that match at export time.
2. Copy the archive to the destination computer. With Tone Studio open, go to **Songs & sets → Restore backup…** and choose the local file.
3. Review the song and playlist counts. When the same recording has a different chart, mix, or tracks, the preview lists it as a separate arrangement. Choose **Restore and reuse identical songs** to reuse matching arrangements, or **Import all as copies** to keep independent copies. Older backups without audio checksums are restored as copies.
4. The destination rig and macros take precedence. For a set archive, **Add missing pedal settings** fills in gaps and **Import missing MIDI macros** adds available definitions. The preview lists macro conflicts and any tone files to relink for regeneration.
5. Open the restored playlist, choose **Load set paused**, and check its chart, mix and output routes. Existing cues keep their saved commands and channels. Playback and cue arming are separate actions.

The same restore flow opens a whole-library backup. Archives carry a manifest with byte lengths and SHA-256 checksums. Restore validates declared files and paths before publishing the new library index. Earlier backups with raw audio still restore and are converted to FLAC. Application-wide audio and MIDI port preferences, credentials, downloaded models and physical pedal memory are separate from a library backup.

## PDF charts

A saved song can have one PDF chart. It is stored as `chart.pdf` in the song's revision folder, next to its audio, and its annotations are stored as `chart-annotations.json` beside it. Both are checked by size and digest in the backup manifest, like the audio. A PDF over 50 MB is refused. Annotation files are kept as JSON, and a file that cannot be read is shown without its marks rather than stopping the PDF. Removing the PDF removes its annotations; replacing it also removes the annotations, since they belong to the old pages. Re-saving the song keeps its PDF. The library index is version 4, with the PDF's size and digest on each song. See [Performance](PERFORMANCE.md#pdf-charts).

## Where a saved song's settings live

A saved song's chart, BPM, lyrics, options and chart view (PDF or text) are kept in the library only, and are written back a moment after you stop editing. Songs you have not saved keep theirs in the browser's local storage. Settings that an earlier version left in local storage for saved songs are moved into the library the first time the library opens, and the old entries are removed. A song's MIDI trigger, if it has one, is one of these options.

The first archive format supports up to 50,000 declared files, 512 GiB of uncompressed content, and 8 MiB each for metadata/manifest. PDF charts and their annotations count toward the file and size limits. Backups can still be large because they include the full lossless audio. Allow free space for the compressed archive when exporting, and for all restored audio when importing. Keep the app open until completion. An interrupted save, restore or conversion can leave an unreferenced folder in the library. The app removes such folders, and abandoned save sessions, once they are more than an hour old, at start and every 10 minutes after. An interrupted export can still leave a temporary archive beside the destination.

## Organising songs

Each saved song has details you set in **Songs & sets**: its key, year, keywords, notes and a colour. The tempo is the song's saved BPM and follows it. The play count and last-played time are kept by the library.

- **Search and sort.** Search matches the title, artist, notes and keywords, and every word you type must match. Sort by title, artist, date added, last played, play count, BPM, year or key. A list of more than 20 songs shows an A to Z index.
- **Folders.** Folders nest to any depth. A song is in one folder or in the library root. Only an empty folder can be deleted.
- **Filters.** Choose **Filter the list** and add rules on title, artist, notes, key, keyword, colour, folder, BPM, year, play count, length, date added or last played. A song must match all the rules, or any of them, as you choose. A rule that is incomplete, or cannot run, shows no songs and says why. Recent filters are remembered on this computer only.
- **Batch edit.** Select songs to add them to a playlist, make a new playlist from them with **New playlist from selected…**, set their colour, replace their keywords, move them to a folder, or delete them. Deleting asks first, and removes the songs from every playlist.

## Playlist sets and smart playlists

A regular playlist can be split into headed sets, such as "Set 1" and "Encore". Each set shows its song count and running time, and the playlist shows its total. **Add songs to this set…** adds songs at the end of that set. **Play set** plays only that set and stops at its end. A set heading moves with the songs around it; removing the only song of a set removes its heading. A song's running time is its trimmed length at its saved speed, so a set's total is the time it will actually take to play.

Each entry of a regular playlist also has two settings, shown beside it: **Song's own end** (or **Play the next song**, **Stop the playlist**, **Loop the song**) and **Starts by itself**. They override the song's own end setting and whether it starts when it becomes the playing song, for this playlist only. A stop entry ends the set there, a loop entry repeats its song until Next is pressed, and an entry that does not start by itself loads and waits for Play. The entry that is playing keeps its settings for as long as it plays.

A smart playlist holds no songs of its own. It picks songs from the library by its rules, sorted and optionally limited to a number of songs. Saving the rules changes what it picks the next time. Playing it takes a snapshot of the songs it picks at that moment, so a change to the library never reorders a set that is already playing.

## Queue

The queue is the list of what plays next. **Play next** puts a song straight after the one playing, **Add to queue** adds it at the end, and **Queue from here** adds the rest of a playlist from one of its entries. In the queue panel you can drag an upcoming song, move it up or down, send it to the top or bottom, or remove it. The song playing, and the songs before it, are locked.

Each upcoming queue entry has the same two settings, which apply to that queue only and never change the playlist. Editing the queue never stops or changes the song that is playing. If an edit changes the next song, a join already prepared for the old one is undone, the outgoing song runs to its own end, and the new next song is prepared. An edit that leaves the next song as it was keeps the join. Adding songs to a single song that is loaded on its own starts a queue, which then plays on when the song ends. The queue holds up to 128 songs, counting the songs already played.

## History

A song is counted as played once it reaches its halfway point. Each play records the time and, when it was part of a set, the set. History shows the playlist and set next to a play made in a set, for example "Gig › Set 1". The count and the last-played time follow. The history keeps the most recent 500 plays. You can clear it, or make a playlist from the plays since a date. Removing a song removes its plays from the history.

## Analysing saved songs

**New songs.** A song that is split or imported is analysed on its own, in one run, as soon as its audio is ready. Choose the steps on the Stems tab, under **After the split**: tempo and beat, key, chords, sections, loudness and silence, the drums and bass check, and lyrics. Lyrics use the model and quality you choose there, and make a chart from the vocals of a split song. An imported song with no split vocals gets no lyrics; split it to get them. The run keeps going while you use other screens, pauses while a song or playlist plays, and shows its progress in the status bar. **Analyse this song now** runs the chosen steps again for a song that is already split, and keeps a tempo you set by hand.

A lyrics chart is replaced by a new run only when the audio changed (a re-split), and only if the run made it. Your own lyrics, lyrics you timed from pasted text, and lyrics from before 0.9.2 are kept.

The analysis finds a song's tempo and meter, key, chords, loudness, missing drums or bass, silence at each end, and suggested sections (intro, verse, chorus and so on) on the bar lines. A song that has no sections takes the suggested ones. A song that already has its own keeps them, and the section editor offers **Replace with detected sections**, with **Undo**. Songs saved before it existed have no analysis, and often a wrong tempo of 120.

- **One song.** On the Performance screen, **Detect** beside the BPM finds the tempo and meter again, even if you set them by hand. If the beat was counted as half or double the real tempo, **Use** the half or the double. **Undo** puts back the tempo, meter and beat grid from before. **Analyse again** runs every step again and replaces the tempo and meter; your key, trims, sections and chart are kept.
- **Many songs.** Select songs and choose **Analyse selected…**, or choose **Analyse all songs…** for the whole library. Choose which steps to run. **Only songs that need it** skips songs whose analysis is current. **Replace tempos I set by hand** is off by default, so a tempo you set, tapped or took from a chart is kept.
- The analysis runs without opening the songs, one at a time. A song open on the Performance screen is skipped. Nothing runs while a song or playlist plays, and a batch pauses when playback starts. **Stop** leaves the songs not yet reached as they were. The summary lists the tempos that changed, and each one can be opened to check it.
- **In the background.** A run keeps going when you close the dialog or leave the Song screen. **Run in background** closes the dialog. The status bar shows the song count, the current song and step, a bar and the time left, on every screen. The Library shows the same line with **Show**, which opens the dialog on the run: a bar, the song and step, a line for each song as it finishes, and **Stop**. When the run ends, the status bar shows the summary for 15 seconds, or until you click it, and the dialog keeps it until **Done**.
- **Lyrics.** The Lyrics step (off by default) transcribes the vocals of each song that has no lyrics, or times your pasted lyrics again. Under **Which lyrics to replace** choose songs with no lyrics, songs whose lyrics Tone Studio made, or lyrics made with a different model than the one picked. Your own charts are never replaced. Lyrics from before version 0.9.2 are kept unless **Include lyrics from before version 0.9.2** is ticked, since Tone Studio cannot tell whether you typed them. The dialog says before the run how many songs get new lyrics and why the others are skipped. Each song's line in the list says what happened to its lyrics, and the summary counts them. A song's previous lyrics can be restored from its Performance screen.
- **Waiting.** The status bar and the dialog say why a run has paused: waiting for playback to stop, or loading a song. If a playlist still counts as playing when no song plays, the dialog offers **Run anyway**, which clears that mark and lets the run go on. A playlist can pause between songs, so use it only when nothing is playing.

## Format versions

Library index version 4 added the details, folders, history, sets, smart playlists and PDF charts above. Earlier libraries open and are upgraded in memory, with no saved value changed; the upgrade is written on the next save. Once a library is version 4, apps that support only earlier index versions refuse to open it, so keep a backup from before the upgrade if you may need to go back. Backups from earlier versions restore into this one; their songs start with no folder, a play count of zero and no history.

## Whole-playlist preflight

Select a saved playlist in **Songs & sets**. Save any newly split tracks or song changes before running a check.

- **Check playlist** quickly checks saved file sizes, charts, settings, cue preparation and MIDI command conflicts. It shows the estimated memory needed by each song and its next preload.
- **Verify for show** also reads the saved audio and chart files to compare checksums, and reports current audio routes and MIDI connection state. Run it with the show rig plugged in and after changing a cable or output. Large libraries take longer to read.

Both checks work without playback or MIDI messages. The report is advisory. Rehearse the transitions and listen to the backing and click on the actual outputs before the show.

## Stage mode

Prepare the song or playlist, check the output and arm MIDI as needed, then choose **Enter stage mode** in Performance. Stage mode fills the window with larger lyrics and transport buttons. It keeps MIDI status and faults visible, hides setup/mixer/editor controls, and disables seeking, rewind and chord popups. It does not arm MIDI or change the song BPM. The stage view stays active across automatic playlist transitions.

**Play/Pause**, **Stop playback** and **Panic / stop MIDI** remain accessible. Panic pauses playback/the set, clears queued MIDI and disarms cues using the existing cleanup rules. It cannot reverse commands already received by a pedal. Use **Exit Stage** to seek, edit, change the mix or reconnect/rearm; Escape and outside clicks do not accidentally unlock the stage view. Leaving the Performance screen resets stage mode.

In the desktop app, active stage playback requests system/display sleep prevention. Pausing, finishing the set, exiting stage mode or leaving the Song screen releases it. Switching to another Song tab does not. Requests renew during playback and expire after 15 seconds without renewal; closing the window or a renderer crash also clears them. The browser build reports that sleep prevention is unavailable. This does not override deliberate sleep, lid-close behavior or system power policy.
