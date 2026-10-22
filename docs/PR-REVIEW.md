# PR review — 22 October 2026

## Scope

Reviewed the changes against upstream main across desktop Bluetooth selection/permissions and IPC, managed song/audio storage, playlist transitions, performance audio/MIDI scheduling, pedal profiles and OpenMIDI import, GP-180 inspection/write guards, recognition workers, documentation and dependency/build changes. Existing protocol and regression tests supplement source review; this review did not send commands to physical pedals.

## Issues corrected in this pass

- Untimed bracket chords were removed from the combined reader. They now remain visible, transposable and clickable; their tooltips do not show invalid timestamps. Timed MIDI rows sort consistently before untimed reading text.
- Incomplete/empty MIDI tokens were silently omitted. The chart parser now rejects them so playback cannot give a false impression that a malformed cue will execute.
- Background transcription/key updates finishing during the first audio save could be overwritten by the earlier settings snapshot. The saved song now receives the latest local settings after the audio copy completes.
- Reopening Performance cleared a saved automatic key while its worker ran. The previous same-source estimate now remains available until replacement, including if the worker fails.
- Pause/panic sent sustain-off CC64 on every channel, conflicting with the GP-180 looper Stop mapping. Note release is now limited to channels where the app actually queued note messages. Pending output is still cleared and enabled MIDI clock still sends Stop.

Each behavioural fix has regression coverage. Final local checks on Windows:

- `npm --prefix app test -- --maxWorkers=2 --testTimeout=20000`: **756 passed, 3 skipped**, across 95 files.
- `npm --prefix app run test:toolkit`: **159 passed**.
- `npm --prefix app run typecheck` and `npm --prefix app run build`: passed.
- Local guide links: no missing targets. Generic browser captures were visually checked.

The extended test timeout accommodates the protocol simulators on this Windows host. These are local results, not a claim of packaged-release or new physical-pedal verification.

### Portable library backup validation

The subsequent backup feature passed the full Windows suite: **770 passed, 3 skipped**, across 97 files. An additional publication-failure rollback test was added afterward; all **11 backup archive tests** passed, including exact PCM/settings/playlist round trips, repeated imports, highly compressed silence, corrupt/truncated archives, unsafe paths/links, and cleanup after a failed index publication. Typechecking and the production build passed. Native file-picker cancellation and renderer progress/listener handling have automated coverage; packaged cross-platform transfer testing remains a release check.

## Generic previews

The subsequent [MIDI reliability review](MIDI-RELIABILITY-REVIEW.md) documents fault-injection findings, queue/transport fixes and remaining live-performance work. It supersedes the earlier MIDI cleanup implementation details above where noted; the physical-pedal evidence remains unchanged.

[Performance, command builder and guitar tabs](screenshots/README.md) use fictional text and synthetic audio. Playback was paused; MIDI was disarmed. The captures show real UI components, not connected-device results. No reference application, user song text, preset names or device identifiers are included.

## Recommended follow-ups

1. **First-beat offset:** allow the recording's first real downbeat to anchor the metronome when there is silence or an unmetered intro. Current beat zero is audio time zero.
2. **Seek lock during playback:** guard against accidental progress-slider movement on stage, while keeping deliberate stopped seeks available.
3. **Recognition evaluation:** compare keys/chords/lyrics with reviewed real-song annotations, including relative minor, modes, detuned guitars and key changes. Existing synthetic tests are not an accuracy benchmark.
4. **Storage management:** portable library export/restore is now implemented; automatic cleanup of abandoned audio revisions and resumable transfers remain follow-ups. See [the library guide](../SONG-LIBRARY.md#portable-backup-and-restore).

These are recommendations, not features implemented in this review. Cross-platform packaged builds, GP-180 editor writes and the full pedal-action catalogue still need their own hardware/release verification. Continuous app MIDI clock remains unsuitable for the tested GP-180/TimeLine rig; use the documented one-time tempo setup.
