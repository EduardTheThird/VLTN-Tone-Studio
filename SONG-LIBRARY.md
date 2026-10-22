# Saved songs and live playlists

In the desktop app, open **Song → Songs & playlists**.

1. **Import audio**, then prepare stems and the Performance chart/lyrics as needed.
2. Enter the song title and artist and choose **Save song to library**. Use **Save song changes** after subsequent edits or a new split.
3. Create a playlist and add songs from the library. Entries can repeat. Use the up/down buttons to set the order. Playlist edits save immediately; removing an entry does not remove the song.
4. Choose **Play playlist** to perform the whole set, or **Play from here** on an entry to start partway through. Performance loads and starts each next song automatically, then stops after the last entry. It shows the current position, next title, **Previous song / Next song**, and **Stop playlist**. Pause/resume controls the set; skipping while paused loads the destination paused. **Load set paused** remains available for preparation. The queue uses a snapshot of the selected playlist order.

Songs restore their saved BPM, MIDI Clock preference, chart, lyrics and mix. The global metronome follows each song. Audio loads between songs, so this is automatic sequential playback rather than gapless playback. Stop can cancel a pending next-song load; loading errors stop the set and show a message. Leaving Performance pauses the playlist.

## What is saved

Each saved song has a unique ID independent of its filename. The library copies decoded source audio and all available stems as lossless planar float32 PCM; the original MP3 and NAS files are not modified or needed to reopen the song. It also saves the editable chord/MIDI chart, separate lyrics text track, BPM, transpose, chord-source override, metronome settings and stem mixer volume/mute/solo state. Stems and Performance share the saved mix.

MIDI output selection, cue arming and active playback are never saved to disk. Manually reopening a song starts disarmed. During a running playlist, an explicitly armed MIDI output carries across songs for that set, provided the same output remains connected. A disconnected or replacement device stays disarmed until enabled again. To send MIDI cues from the first instant of the set, choose **Load set paused**, connect and enable **Send cues** once, then press **Play playlist**. GP-180 USB editor sessions default to read-only and require explicit write unlocking for changes. Bluetooth MIDI remains available for performance controls; Bluetooth editor management is disabled. Text/settings edits of a saved song are captured when moving to another saved song; use **Save song changes** before quitting to explicitly save all edits and newly generated audio. Completed automatic lyrics are written back to the saved song even if you switch tabs during transcription.

The data lives under `%APPDATA%\VLTN Tone Studio\song-library` on Windows. `library.json` holds the song and playlist metadata. UUID-named directories hold the audio revisions. Do not rename files inside this folder. To back up this first implementation, close the app and copy the complete folder; metadata-only copies do not contain audio. Float32 storage is large: a 4:28 stereo song with six stems uses approximately 661 MB.

A save writes every audio asset before atomically replacing the index. Incomplete saves do not replace a previously saved song. Interrupted operations can leave unreferenced audio directories; automatic recovery/garbage collection is not implemented. Deleting a song removes it from playlists and deletes its managed audio; it never deletes the imported source. The UI requires a second confirmation for song/playlist deletion. Deleting a playlist keeps its songs.
