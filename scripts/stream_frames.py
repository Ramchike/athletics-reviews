#!/usr/bin/env python3
"""Read selected video frames over bounded HTTP ranges; never save original video.

Dependencies: av, requests, pillow. Output stays in ignored media/.
Timestamps are presentation time in the file, not inferred physical time.
"""
import argparse
from collections import OrderedDict
import hashlib
import io
import json
import math
from pathlib import Path
import re

import av
from PIL import Image, ImageDraw, ImageOps
import requests


class RangeReader(io.RawIOBase):
    """Seekable bounded reader with at most eight 1 MiB blocks in RAM."""
    def __init__(self, url, block_size=1024 * 1024, max_blocks=8):
        self.url = url
        self.position = 0
        self.block_size = block_size
        self.max_blocks = max_blocks
        self.cache = OrderedDict()
        self.session = requests.Session()
        self.bytes_read = 0
        self.requests_made = 0
        self.size = None
        self._block(0)

    def _block(self, index):
        if index in self.cache:
            self.cache.move_to_end(index)
            return self.cache[index]
        start = index * self.block_size
        end = start + self.block_size - 1
        if self.size is not None:
            end = min(end, self.size - 1)
        for attempt in range(4):
            try:
                data = self._fetch(start, end)
                break
            except requests.RequestException:
                if attempt == 3:
                    raise
        end = start + len(data) - 1
        self.bytes_read += len(data)
        self.requests_made += 1
        self.cache[index] = data
        while len(self.cache) > self.max_blocks:
            self.cache.popitem(last=False)
        return data

    def _fetch(self, start, end):
        with self.session.get(self.url, headers={"Range": f"bytes={start}-{end}"},
                              timeout=60, stream=True) as response:
            response.raise_for_status()
            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)",
                                 response.headers.get("Content-Range", ""))
            if response.status_code != 206 or not match:
                raise ValueError("Server did not honor bounded Range; refusing full download")
            first, last, size = map(int, match.groups())
            end=min(end,size-1)
            if first != start or last != end or (self.size is not None and self.size != size):
                raise ValueError("Unexpected Content-Range or changed remote file size")
            self.size = size
            data = response.raw.read(end - start + 2)
            if len(data) != end - start + 1:
                raise requests.RequestException("Incomplete HTTP range")
        return data

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        position = offset + (0 if whence == 0 else self.position if whence == 1 else self.size)
        if position < 0:
            raise ValueError("Negative position")
        self.position = position
        return position

    def read(self, size=-1):
        size = self.size - self.position if size < 0 else size
        size = min(size, self.size - self.position)
        parts = []
        while size > 0:
            index, offset = divmod(self.position, self.block_size)
            block = self._block(index)
            count = min(size, len(block) - offset)
            parts.append(block[offset:offset + count])
            self.position += count
            size -= count
        return b"".join(parts)

    def close(self):
        self.session.close()
        super().close()


def sheet(paths, labels, output, columns=4, cell=(320, 210)):
    width, height = cell
    canvas = Image.new("RGB", (columns * width, math.ceil(len(paths) / columns) * height), "#151922")
    draw = ImageDraw.Draw(canvas)
    for i, (path, label) in enumerate(zip(paths, labels)):
        x, y = (i % columns) * width, (i // columns) * height
        with Image.open(path) as image:
            tile = ImageOps.contain(image, (width, height - 24))
            canvas.paste(tile, (x + (width - tile.width) // 2, y))
        draw.text((x + 6, y + height - 21), label, fill="white")
    canvas.save(output, quality=90)


def drive_url(file_id):
    return f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t"


def readable_time(seconds):
    """File position for people, rounded to tenths with correct minute carry."""
    tenths = round(seconds * 10)
    minutes, remaining = divmod(tenths, 600)
    whole, fraction = divmod(remaining, 10)
    return f"{minutes}:{whole:02d},{fraction}"


def extract(url, output, times=None, count=12, max_side=1280, lossless=False):
    output = Path(output).resolve()
    media = Path(__file__).resolve().parents[1] / "media"
    if not output.is_relative_to(media.resolve()) or output == media.resolve() or output.exists():
        raise ValueError("Output must be a new directory within media/")
    output.mkdir(parents=True)
    reader = RangeReader(url)
    manifest = {"status": "in_progress", "source_url": url,
                "original_saved": False, "original_sha256": None,
                "time_basis": "source presentation timestamps; slow-motion factor unknown",
                "frames": []}
    try:
        with av.open(reader) as container:
            stream = container.streams.video[0]
            stream.thread_type = "AUTO"
            duration = float(stream.duration * stream.time_base) if stream.duration else container.duration / 1e6
            start = float((stream.start_time or 0) * stream.time_base)
            rotation = stream.metadata.get("rotate", "0")
            manifest.update(duration_seconds=duration, start_seconds=start,
                            average_rate=str(stream.average_rate), codec=stream.codec_context.name,
                            width=stream.width, height=stream.height,
                            stream_metadata=stream.metadata, rotation_metadata=rotation,
                            source_size_bytes=reader.size)
            times = times if times is not None else [start + (i + 0.5) * duration / count for i in range(count)]
            if any(not math.isfinite(t) or t < start or t >= start + duration for t in times):
                raise ValueError("Requested timestamp outside source")
            previous_target = None
            decoded = None
            previous_frame = None
            for i, target in enumerate(times):
                # Decode nearby targets in order, instead of repeatedly decoding
                # the same keyframe group. Never infer an event from sampling rate.
                if previous_target is None or target < previous_target or target - previous_target > 1:
                    container.seek(int(target / stream.time_base), stream=stream, backward=True)
                    decoded = iter(container.decode(stream))
                    previous_frame = None
                if previous_frame is not None and float(previous_frame.pts * previous_frame.time_base) + 1e-9 >= target:
                    candidates = iter([previous_frame])
                else:
                    candidates = decoded
                for frame in candidates:
                    if frame.pts is None:
                        continue
                    pts = float(frame.pts * frame.time_base)
                    if pts + 1e-9 < target:
                        continue
                    image = frame.to_image()
                    rotation = int(round(getattr(frame, "rotation", 0)))
                    if rotation:
                        image = image.rotate(rotation, expand=True)
                    image.thumbnail((max_side, max_side))
                    path = output / f"frame-{i:04d}.{'png' if lossless else 'jpg'}"
                    image.save(path, **({} if lossless else {"quality":93}))
                    manifest["frames"].append({"requested_seconds": target, "pts_seconds": pts,
                                               "rotation_applied": rotation, "file": path.name,
                                               "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
                    previous_frame = frame
                    break
                else:
                    raise ValueError(f"No frame for {target}")
                previous_target = target
        manifest["status"] = "complete"
        sheet([output / f["file"] for f in manifest["frames"]],
              [readable_time(f["pts_seconds"]) for f in manifest["frames"]], output / "contact-sheet.jpg")
    except Exception as exc:
        manifest.update(status="failed", error=str(exc))
        raise
    finally:
        manifest.update(network_bytes=reader.bytes_read, http_range_requests=reader.requests_made)
        (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        reader.close()
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--url")
    source.add_argument("--drive", help="Google Drive file id (file must be shared by link)")
    parser.add_argument("--out", required=True)
    parser.add_argument("--at", nargs="+", type=float)
    parser.add_argument("--span", nargs=3, type=float, metavar=("FROM", "TO", "STEP"),
                        help="Dense frames from FROM to TO seconds every STEP seconds")
    parser.add_argument("--count", type=int, default=12)
    parser.add_argument("--lossless",action="store_true",help="Save PNG instead of JPEG")
    args = parser.parse_args()
    if args.count < 1:
        parser.error("count must be positive")
    url = args.url or drive_url(args.drive)
    times = args.at
    if args.span:
        first, last, step = args.span
        if step <= 0 or last <= first:
            parser.error("span needs FROM < TO and STEP > 0")
        times = [first + i * step for i in range(int((last - first) / step + 1e-9) + 1)]
    result = extract(url, args.out, times, args.count, lossless=args.lossless)
    print(json.dumps({k: v for k, v in result.items() if k not in {"frames", "source_url", "stream_metadata"}}))


if __name__ == "__main__":
    main()
