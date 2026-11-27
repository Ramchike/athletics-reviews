"""Measure a Stvor start beep and a manually bracketed finish on one recording."""
import argparse
import array
import json
import math
import re
import subprocess
import sys
from pathlib import Path

RATE = 16_000
TONE_HZ = 970
WINDOW = 128
STEP = 32


def frame_times(clip):
    raw = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames",
        "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", str(clip),
    ])
    times = [float(frame["best_effort_timestamp_time"]) for frame in json.loads(raw)["frames"]]
    if not times or not all(math.isfinite(time) for time in times):
        raise ValueError("Recording has no usable video timestamps")
    if any(b <= a for a, b in zip(times, times[1:])):
        raise ValueError("Video timestamps are not strictly increasing")
    return times


def audio_window(clip, begin, end):
    result = subprocess.run([
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "info", "-copyts", "-i", str(clip),
        "-map", "0:a:0", "-af", f"atrim=start={begin:.8f}:end={end:.8f},"
        f"aresample={RATE},aformat=sample_fmts=s16:channel_layouts=mono,ashowinfo",
        "-f", "s16le", "pipe:1",
    ], check=True, capture_output=True)
    chunks = re.findall(rb"pts_time:([^ ]+) .*?nb_samples:(\d+)", result.stderr)
    samples = array.array("h")
    samples.frombytes(result.stdout)
    if sys.byteorder != "little":
        samples.byteswap()
    if not chunks or sum(int(count) for _, count in chunks) != len(samples):
        raise ValueError("Unable to align audio samples to the recording timestamps")
    origin = float(chunks[0][0])
    cursor = 0
    for stamp, count in chunks:
        if abs(float(stamp) - origin - cursor / RATE) > 0.002:
            raise ValueError("Audio timestamps are discontinuous in the search window")
        cursor += int(count)
    return origin, samples


def locate_tone(samples):
    sine = [math.sin(2 * math.pi * TONE_HZ * i / RATE) for i in range(WINDOW)]
    cosine = [math.cos(2 * math.pi * TONE_HZ * i / RATE) for i in range(WINDOW)]
    levels = []
    for offset in range(0, len(samples) - WINDOW + 1, STEP):
        block = samples[offset:offset + WINDOW]
        power = sum(value * value for value in block)
        real = sum(a * b for a, b in zip(block, cosine))
        imag = sum(a * b for a, b in zip(block, sine))
        tone = real * real + imag * imag
        # Normalized spectral power near 970 Hz rejects the countdown tones.
        levels.append(math.sqrt(tone) * 2 / WINDOW if power and tone > 0.3 * WINDOW * power else 0)
    if not levels or max(levels) < 100:
        raise ValueError("No clear 970 Hz start signal in the supplied window")
    threshold = 0.20 * max(levels)
    for index in range(len(levels) - 4):
        if min(levels[index:index + 5]) >= threshold:
            if index == 0:
                raise ValueError("Start signal already present at window start. Use an earlier bound.")
            return ((index * STEP) + WINDOW / 2) / RATE
    raise ValueError("No sustained 970 Hz start signal in the supplied window")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("clip", type=Path)
    parser.add_argument("--start-window", nargs=2, type=float, required=True,
                        metavar=("FROM", "TO"), help="Seconds from the first video frame")
    parser.add_argument("--finish-frames", nargs=2, type=int, required=True,
                        metavar=("BEFORE", "AFTER"), help="Consecutive zero-based frame indices")
    args = parser.parse_args()
    try:
        clip = args.clip.resolve(strict=True)
        video = frame_times(clip)
        before, after = args.finish_frames
        start, stop = args.start_window
        if not 0 <= before < after < len(video) or after - before != 1:
            raise ValueError("Select consecutive finish frames within the recording")
        if not 0 <= start < stop <= video[before] - video[0] or stop - start > 5:
            raise ValueError("Supply a start search window of up to five seconds before the finish")
        origin, samples = audio_window(clip, video[0] + start, video[0] + stop)
        beep = origin + locate_tone(samples)
    except (KeyError, OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.error(str(error))

    bounds = [round((video[frame] - beep) * 1000, 2) for frame in (before, after)]
    print(json.dumps({
        "start_beep_ms_from_first_frame": round((beep - video[0]) * 1000, 2),
        "referenceMs": round(sum(bounds) / 2, 2),
        "finish_frame_interval_ms": bounds,
        "audio_window_ms": WINDOW / RATE * 1000,
    }, indent=2))


if __name__ == "__main__":
    main()
