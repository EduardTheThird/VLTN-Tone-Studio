# Drum pattern extraction

Run from the repository root with Python 3. No external libraries are needed.

```sh
python3 app/scripts/groove-data/extract.py --report /tmp/groove-data-report.md
python3 -m unittest discover -s app/scripts/groove-data
```

The script verifies the published SHA-256 before opening the MIDI-only archive.
To reuse the zip, pass `--archive /path/to/groove-v1.0.0-midionly.zip`.
The generated JSON contains averaged hit patterns and timing and velocity
statistics. The archive and raw MIDI are used only by this offline script.
See the Band [notice](../../src/renderer/src/song/band/NOTICE.md) for attribution.
