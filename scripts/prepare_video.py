#!/usr/bin/env python3
"""Extract local video frames and their file timestamps; never infer biomechanics."""
import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
from pathlib import Path


def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--at", required=True, type=float, nargs="+")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    source = args.input.resolve()
    output = args.out.resolve()
    media = Path(__file__).resolve().parents[1] / "media"
    if not source.is_file():
        parser.error("Исходное видео не найдено")
    if not output.is_relative_to(media.resolve()) or output == media.resolve():
        parser.error("Результаты должны находиться в новой вложенной папке media/")
    if output.exists():
        parser.error("Папка результата уже существует; выберите новую, чтобы не перезаписать файлы")
    if any(not math.isfinite(t) or t < 0 for t in args.at):
        parser.error("Время должно быть конечным неотрицательным числом")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        parser.error("Нужны локальные ffmpeg и ffprobe")
    metadata = json.loads(run([
        "ffprobe", "-v", "error", "-show_format", "-show_streams",
        "-of", "json", str(source),
    ]).stdout)
    streams = [s for s in metadata["streams"] if s.get("codec_type") == "video"]
    if not streams:
        parser.error("В файле нет видеодорожки")
    original_hash = digest(source)
    output.mkdir(parents=True)
    result = {
        "source": str(source), "sha256": original_hash,
        "status": "in_progress", "metadata": metadata, "frames": [],
        "time_basis": "Decoded source presentation timestamps in seconds; not inferred real-world time.",
        "limitations": "Slow-motion factor is unknown. No pose, forces, joint angles or injury assessment.",
    }
    manifest = output / "manifest.json"

    def save():
        manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")

    save()
    try:
        for index, timestamp in enumerate(args.at):
            frame = output / f"frame-{index + 1:03d}.png"
            proc = run([
                "ffmpeg", "-hide_banner", "-nostdin", "-n", "-copyts",
                "-i", str(source), "-map", "0:v:0", "-an",
                "-vf", f"select=gte(t\\,{timestamp:.9f}),showinfo",
                "-frames:v", "1", "-fps_mode", "vfr", str(frame),
            ])
            match = re.search(r"\bn:\s*0\s+pts:.*?pts_time:([\d.eE+-]+)", proc.stderr)
            if not frame.is_file() or not match:
                raise ValueError(f"Кадр на времени {timestamp} не найден; проверьте длительность и временную шкалу")
            result["frames"].append({
                "requested_timestamp_seconds": timestamp,
                "decoded_frame_pts_seconds": float(match.group(1)),
                "file": frame.name,
            })
            save()
        if digest(source) != original_hash:
            raise RuntimeError("Исходный файл изменился во время работы")
        result["status"] = "complete"
        save()
        print(manifest)
    except Exception as exc:
        result["status"] = "failed"
        result["error"] = str(exc)
        save()
        raise


if __name__ == "__main__":
    main()
