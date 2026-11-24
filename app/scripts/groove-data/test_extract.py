import struct
import tempfile
import unittest
from pathlib import Path

from extract import check_archive, cluster_grooves, grid_bars, read_midi


def midi(track):
    return struct.pack(">4sIHHH4sI", b"MThd", 6, 0, 1, 480, b"MTrk", len(track)) + track


class GrooveExtractionTest(unittest.TestCase):
    def test_two_measures_with_late_hats(self):
        bar = bytes([0, 0x99, 36, 100, 0x81, 0, 42, 80])
        track = bar + bytes([0x8E, 0]) + bar[1:] + bytes([0, 0xFF, 47, 0])
        ppq, notes = read_midi(midi(track))
        bars = grid_bars(notes, ppq, 4, 4)
        self.assertEqual(bars[0].keys(), bars[1].keys())
        self.assertAlmostEqual(bars[0][1, 42][1], bars[1][1, 42][1])
        self.assertAlmostEqual(bars[0][1, 42][1], 1000 / 120)
        instances = [("first", bars[0]), ("first", bars[1]), ("second", bars[0])]
        self.assertEqual(len(cluster_grooves(instances, 16)), 1)
        self.assertEqual(cluster_grooves(instances[:2], 16), [])

    def test_map_and_pedal(self):
        track = bytes([
            0, 0xB9, 4, 0, 0, 0x99, 22, 90,
            0, 0xB9, 4, 127, 0, 0x99, 22, 90,
            0, 40, 90, 0, 58, 90, 0, 53, 90,
            0, 0xFF, 47, 0,
        ])
        _, notes = read_midi(midi(track))
        self.assertEqual([pitch for _, pitch, _ in notes], [46, 42, 38, 45, 51])

    def test_reject_wrong_checksum(self):
        with tempfile.TemporaryDirectory() as scratch:
            path = Path(scratch) / "fake.zip"
            path.write_bytes(b"invalid")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                check_archive(path)
