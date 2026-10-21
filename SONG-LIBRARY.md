# Saved songs and live playlists

In the desktop app, open **Song → Songs & playlists**.

1. **Import audio**, then prepare stems and the Performance chart/lyrics as needed.
2. Enter the song title and artist and choose **Save song to library**. Use **Save song changes** after subsequent edits or a new split.
3. Create a playlist and add songs from the library. Entries can repeat. Use the up/down buttons to set the order. Playlist edits save immediately; removing an entry does not remove the song.
4. Choose **Load set**, or **Load** on a particular entry. Performance shows the current position, next title, and **Previous song / Next song** controls. Every load is paused; press Play when ready. Playback stops at the end of each song. The queue uses a snapshot of the selected playlist order.

## What is saved

Each saved song has a unique ID independent of its filename. The library copies decoded source audio and all available stems as lossless planar float32 PCM; the original MP3 and NAS files are not modified or needed to reopen the song. It also saves the editable chord/MIDI chart, separate lyrics text track, BPM, transpose, chord-source override, rhythm settings and stem mixer volume/mute/solo state. Stems and Performance share the saved mix.

MIDI output selection, cue arming, active playback and a running rhythm are not restored. Reopening a song cannot automatically send cues to the pedal. Live GP-180 sessions remain read-only. Text/settings edits of a saved song are captured when moving to another saved song; use **Save song changes** before quitting to explicitly save all edits and newly generated audio.

The data lives under `%APPDATA%\VLTN Tone Studio\song-library` on Windows. `library.json` holds the song and playlist metadata. UUID-named directories hold the audio revisions. Do not rename files inside this folder. To back up this first implementation, close the app and copy the complete folder; metadata-only copies do not contain audio. Float32 storage is large: a 4:28 stereo song with six stems uses approximately 661 MB.

A save writes every audio asset before atomically replacing the index. Incomplete saves do not replace a previously saved song. Interrupted operations can leave unreferenced audio directories; automatic recovery/garbage collection is not implemented. Deleting a song removes it from playlists and deletes its managed audio; it never deletes the imported source. The UI requires a second confirmation for song/playlist deletion. Deleting a playlist keeps its songs.
