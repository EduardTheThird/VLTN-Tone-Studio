"""Build quantised drum patterns and feel profiles from Google's Groove MIDI Dataset."""
import argparse
import csv
import hashlib
import io
import json
import struct
import tempfile
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median

URL = "https://storage.googleapis.com/magentadata/datasets/groove/groove-v1.0.0-midionly.zip"
SHA256 = "651cbc524ffb891be1a3e46d89dc82a1cecb09a57c748c7b45b844c4841dcc1e"
PITCHES = {
    36: 36, 37: 37, 38: 38, 40: 38, 48: 50, 50: 50, 45: 47, 47: 47,
    43: 45, 58: 45, 46: 46, 26: 46, 42: 42, 22: 42, 44: 44,
    49: 49, 55: 49, 57: 49, 52: 49, 51: 51, 59: 51, 53: 51,
}
EXISTING = {"rock", "pop", "funk", "country", "reggae", "shuffle"}
CANDIDATES = {"dance", "punk", "hiphop", "soul", "latin", "jazz", "gospel", "neworleans", "afrobeat"}
HATS = {42, 44, 46, 51}


def check_archive(path):
    if hashlib.sha256(path.read_bytes()).hexdigest() != SHA256:
        raise ValueError("Groove MIDI Dataset archive checksum mismatch")


def read_varint(cursor):
    value = 0
    for _ in range(4):
        byte = cursor.read(1)[0]
        value = (value << 7) | (byte & 127)
        if byte < 128:
            return value
    raise ValueError("Invalid MIDI variable-length integer")


def read_midi(data):
    cursor = io.BytesIO(data)
    marker, length, midi_format, count, ppq = struct.unpack(">4sIHHH", cursor.read(14))
    if marker != b"MThd" or length != 6 or midi_format != 0 or count != 1 or ppq >= 32768:
        raise ValueError("Expected the dataset's merged, metrical MIDI track")
    marker, length = struct.unpack(">4sI", cursor.read(8))
    if marker != b"MTrk":
        raise ValueError("Missing MIDI track")
    cursor = io.BytesIO(cursor.read(length))
    tick = 0
    status = 0
    pedal = None
    notes = []
    while cursor.tell() < length:
        tick += read_varint(cursor)
        byte = cursor.read(1)[0]
        if byte < 128:
            cursor.seek(-1, io.SEEK_CUR)
        else:
            status = byte
        if status == 255:
            meta_type = cursor.read(1)[0]
            cursor.read(read_varint(cursor))
            if meta_type == 47:
                break
        elif status in (240, 247):
            cursor.read(read_varint(cursor))
        else:
            kind = status >> 4
            pitch = cursor.read(1)[0]
            if kind in (12, 13):
                continue
            velocity = cursor.read(1)[0]
            if kind == 11 and pitch == 4:
                pedal = velocity
            if kind == 9 and velocity and pitch in PITCHES:
                # TD-11 CC4 increases as the pedal closes. The midpoint separates open and closed bow hits.
                mapped = 46 if pitch in (22, 42) and pedal is not None and pedal < 64 else PITCHES[pitch]
                notes.append((tick, mapped, velocity))
    return ppq, notes


def swing_grid(notes, beat_ticks):
    offbeats = [tick / beat_ticks % 1 for tick, pitch, _ in notes if pitch in HATS]
    straight = sum(abs(fraction - 0.5) < 0.055 for fraction in offbeats)
    triplets = sum(abs(fraction - 2 / 3) < 0.055 for fraction in offbeats)
    return triplets >= 4 and triplets > 1.5 * straight


def grid_bars(notes, beat_ticks, beats_per_bar, steps_per_beat):
    bars = defaultdict(dict)
    steps = beats_per_bar * steps_per_beat
    for tick, pitch, velocity in notes:
        position = tick * steps_per_beat / beat_ticks
        nearest = round(position)
        bar, step = divmod(nearest, steps)
        key = (step, pitch)
        hit = bars[bar].get(key)
        if hit is None or velocity > hit[0]:
            bars[bar][key] = (velocity, (position - nearest) * 500 / steps_per_beat)
    return bars


def group(pitch):
    if pitch == 36:
        return "kick"
    if pitch in (37, 38):
        return "snare"
    return "hats" if pitch in HATS else "toms"


def cluster_grooves(instances, steps):
    clusters = defaultdict(list)
    for drummer, hits in instances:
        # Match kick, snare and timekeeping positions, with hats open/closed treated as the same voice.
        # The other hits contribute to the learned velocity and embellishment tiers.
        key = tuple(sorted({(step, group(pitch)) for step, pitch in hits
                            if pitch in (36, 37, 38, 42, 46, 51)}))
        if key:
            clusters[key].append((drummer, hits))
    grooves = []
    for members in sorted(clusters.values(), key=len, reverse=True):
        if len(members) < 3 or len({drummer for drummer, _ in members}) < 2:
            continue
        seen = defaultdict(list)
        for _, hits in members:
            for key, (velocity, _) in hits.items():
                seen[key].append(velocity)
        built = []
        for (step, pitch), velocities in sorted(seen.items()):
            share = len(velocities) / len(members)
            if share < 0.2 or (pitch in (42, 46) and len(seen.get((step, 88 - pitch), [])) > len(velocities)):
                continue
            velocity = round(sum(velocities) / len(velocities))
            hit = {"step": step, "pitch": pitch, "velocity": velocity}
            if share < 0.85:
                hit["tier"] = "lean" if share >= 0.5 else "busy"
            if pitch in (37, 38) and velocity < 50:
                hit["ghost"] = True
            built.append(hit)
        if not built:
            continue
        backbone = sum(hit["pitch"] in (36, 37, 38) for hit in built)
        density = (len(built) + backbone * 0.75) * 16 / steps
        energy = 1 + sum(density >= threshold for threshold in (9, 14, 19, 25))
        grooves.append((energy, {"steps": steps, "hits": built}))
    return grooves


def collect_data(archive):
    instances = defaultdict(list)
    fills = defaultdict(lambda: defaultdict(list))
    profiles = defaultdict(lambda: defaultdict(list))
    file_counts = Counter()
    file_totals = Counter()
    for row in csv.DictReader(io.StringIO(archive.read("groove/info.csv").decode())):
        genre = row["style"].split("/")[0]
        style = "shuffle" if genre == "blues" else genre
        if style not in EXISTING | CANDIDATES:
            file_totals[style] += 1
            continue
        file_totals[style] += 1
        ppq, notes = read_midi(archive.read("groove/" + row["midi_filename"]))
        if not notes:
            continue
        numerator, denominator = map(int, row["time_signature"].split("-"))
        compound = denominator == 8 and numerator % 3 == 0 and numerator > 3
        beats = numerator // 3 if compound else numerator
        beat_ticks = ppq * (12 if compound else 4) / denominator
        swung = compound or swing_grid(notes, beat_ticks)
        if style == "shuffle" and not swung:
            continue
        division = 3 if swung else 4
        meter = (beats, division)
        steps = beats * division
        bars = grid_bars(notes, beat_ticks, beats, division)
        file_counts[style] += 1
        if row["beat_type"] == "beat":
            # Exclude the truncated final bar and any bar without timekeeping.
            instances[style, meter].extend(
                (row["drummer"], hits) for bar, hits in bars.items()
                if bar != max(bars) and sum(pitch in HATS for _, pitch in hits) >= 2
            )
            for hits in bars.values():
                loudest = max(velocity for velocity, _ in hits.values())
                for (step, pitch), (velocity, offset) in hits.items():
                    profiles[style, meter][step, group(pitch)].append((offset, velocity / loudest))
        else:
            # The final downbeat belongs to the following bar if the fill resolves with a cymbal.
            last = max(bars)
            if last > 0 and all(step == 0 for step, _ in bars[last]):
                last -= 1
            hits = bars.get(last, {})
            if len(hits) < 2:
                continue
            first = min(step for step, _ in hits)
            # Short source files can begin at their own downbeat. Align those hits to the end of the fill.
            if last == 0 and max(step for step, _ in hits) < steps - 1:
                used = max(step for step, _ in hits) - first + 1
                span = division if used <= division else (steps + 1) // 2 if used <= (steps + 1) // 2 else steps
                shift = steps - span - first
                hits = {(step + shift, pitch): value for (step, pitch), value in hits.items()}
                first += shift
            size = "short" if first >= steps - division else "half" if first >= steps / 2 else "bar"
            fills[style, meter][size].append(hits)
    return instances, fills, profiles, file_counts, file_totals


def fill_patterns(source, steps):
    result = {}
    for size in ("short", "half", "bar"):
        patterns = defaultdict(list)
        for hits in source[size]:
            patterns[tuple(sorted(hits))].append(hits)
        result[size] = [
            {"steps": steps, "hits": [
                {"step": step, "pitch": pitch,
                 "velocity": round(sum(hits[step, pitch][0] for hits in members) / len(members))}
                for step, pitch in key
            ]}
            for key, members in sorted(patterns.items(), key=lambda item: -len(item[1]))[:40]
        ]
    return result


def extract(archive, out, report):
    instances, fills, profiles, files, totals = collect_data(archive)
    lines = [
        "# Groove MIDI Dataset extraction", "",
        "[Source, Google LLC, CC BY 4.0](https://magenta.tensorflow.org/datasets/groove).",
        "", f"Verified SHA-256 `{SHA256}`.",
        "", "| Style | Files read / available | Groove clusters kept / qualified | Fills kept / eligible | Feel cells (all meters) | Shipped |",
        "|---|---:|---:|---:|---:|---|",
    ]
    out.mkdir(parents=True, exist_ok=True)
    for style in sorted(totals):
        meter = (4, 3 if style in ("shuffle", "jazz") else 4)
        num_grooves = cluster_grooves(instances[style, meter], meter[0] * meter[1])
        captured_fills = fill_patterns(fills[style, meter], meter[0] * meter[1])
        feel = {}
        for (genre, feel_meter), samples in profiles.items():
            if style != genre:
                continue
            cells = {}
            for (step, part), values in sorted(samples.items()):
                if len(values) < 30:
                    continue
                shift = median(value[0] for value in values)
                deviation = median(abs(value[0] - shift) for value in values)
                cells[f"{step}:{part}"] = [round(shift, 2), round(deviation, 2),
                                           round(median(value[1] for value in values), 3)]
            if cells:
                feel[f"{feel_meter[0]}:{feel_meter[1]}"] = cells
        fill_count = sum(map(len, captured_fills.values()))
        qualifies = style in CANDIDATES and len(num_grooves) >= 15 and fill_count >= 10
        ship = style in EXISTING or qualifies
        kept = 0
        if ship:
            bins = {str(energy): [] for energy in range(1, 6)}
            for energy, pattern in num_grooves:
                if len(bins[str(energy)]) < 16:
                    pattern["name"] = f"Drummer {energy}.{len(bins[str(energy)]) + 1}"
                    bins[str(energy)].append(pattern)
                    kept += 1
            data = {"grooves": bins, "fills": captured_fills, "feel": feel}
            (out / f"{style}.groove.json").write_text(json.dumps(data, separators=(",", ":")) + "\n")
        lines.append(f"| {style} | {files[style]} / {totals[style]} | {kept} / {len(num_grooves)} | {fill_count if ship else 0} / {fill_count} | "
                     f"{sum(map(len, feel.values()))} | {'Yes' if ship else 'No'} |")
    lines += [
        "", "Only four-quarter grooves and fills are shipped, with triplet subdivision for shuffle and jazz.",
        "Other meters may contribute feel cells. Bars that fail the three-occurrence and two-drummer",
        "gate are dropped. At most 16 clusters per energy and 40 fills per size are shipped.",
        "CC4 position below 64 is treated as open for closed-bow/edge notes. Rim, bell and floor tom",
        "hits map to the nearest available kit voice. Velocities are averaged by hit and timing is",
        "normalized from PPQ to 120 BPM. Feel cells require 30 individual hits.",
    ]
    report.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Reuse a downloaded archive after checking its SHA-256")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "src/renderer/src/song/band/styles/data")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as scratch:
        path = args.archive
        if path is None:
            path = Path(scratch) / "groove.zip"
            urllib.request.urlretrieve(URL, path)
        check_archive(path)
        with zipfile.ZipFile(path) as archive:
            extract(archive, args.out, args.report)


if __name__ == "__main__":
    main()
