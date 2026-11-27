"""Measure torso visibility and line-side decisions on generated contact sheets."""
import argparse
import json
import time
from collections import Counter
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

LABELS = {
    "side": (1, ["before", "before", "boundary", "after", "after", "after"]),
    "oblique": (-1, ["before", "before", "before", "after", "after", "after"]),
    "clutter": (1, ["empty", "before", "before", "before", "after", "after"]),
}

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("folder", type=Path)
parser.add_argument("--model", type=Path, default=Path("sprint-timer/public/pose.task"))
parser.add_argument("--export", type=Path, required=True)
args = parser.parse_args()
args.export.mkdir(parents=True, exist_ok=True)
cv2.setNumThreads(1)


def variants(frame):
    yield "original", frame, 82
    yield "dim", cv2.convertScaleAbs(frame, alpha=0.56), 70
    yield "blur", cv2.GaussianBlur(frame, (5, 5), 1.2), 75
    yield "compressed", frame, 42
    yield "small", cv2.resize(frame, None, fx=0.64, fy=0.64), 65
    yield "bright", cv2.convertScaleAbs(frame, alpha=1.2, beta=13), 78


def stripe_x(frame):
    height, width = frame.shape[:2]
    region = frame[int(height * 0.66):int(height * 0.95)]
    white = (region.min(axis=2) > 160) & ((region.max(axis=2) - region.min(axis=2)) < 58)
    score = np.mean(white, axis=0)
    lo, hi = round(width * 0.25), round(width * 0.75)
    best = lo + int(np.argmax(score[lo:hi]))
    if score[best] < 0.15:
        return None
    return round((best + 0.5) / width, 4)


options = vision.PoseLandmarkerOptions(
    base_options=python.BaseOptions(model_asset_path=str(args.model)),
    running_mode=vision.RunningMode.IMAGE,
    num_poses=1,
)
rows = []
with vision.PoseLandmarker.create_from_options(options) as detector:
    for scene, (direction, labels) in LABELS.items():
        sheet = cv2.imread(str(args.folder / f"{scene}.png"))
        if sheet is None:
            raise ValueError(f"Could not decode {scene}.png")
        height, width = sheet.shape[:2]
        for index, expected in enumerate(labels):
            row, col = divmod(index, 3)
            frame = sheet[row * height // 2:(row + 1) * height // 2, col * width // 3:(col + 1) * width // 3]
            for variant, altered, quality in variants(frame):
                _, jpeg = cv2.imencode(".jpg", altered, [cv2.IMWRITE_JPEG_QUALITY, quality])
                name = f"{scene}-{index + 1:02d}-{variant}.jpg"
                (args.export / name).write_bytes(jpeg.tobytes())
                decoded = cv2.imdecode(jpeg, cv2.IMREAD_COLOR)
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB))
                started = time.perf_counter()
                result = detector.detect(image)
                inference_ms = (time.perf_counter() - started) * 1000
                pose = result.pose_landmarks[0] if result.pose_landmarks else []
                torso = [pose[i] for i in (11, 12, 23, 24)] if pose else []
                edge = None
                if torso and all(p.visibility >= 0.45 for p in torso):
                    edge = (max if direction == 1 else min)(p.x for p in torso)
                outcome = "no-pose" if edge is None else ("after" if (edge - 0.5) * direction >= 0 else "before")
                rows.append({
                    "file": name, "scene": scene, "variant": variant, "keyframe": index + 1,
                    "expected": expected, "outcome": outcome, "edge_x": edge, "stripe_x": stripe_x(decoded),
                    "jpeg_bytes": len(jpeg), "inference_ms": round(inference_ms, 2),
                })

print(json.dumps({
    "frames": len(rows),
    "median_jpeg_bytes": int(np.median([row["jpeg_bytes"] for row in rows])),
    "p95_jpeg_bytes": int(np.percentile([row["jpeg_bytes"] for row in rows], 95)),
    "p95_inference_ms": round(float(np.percentile([row["inference_ms"] for row in rows], 95)), 2),
    "decisions": [{"expected": a, "outcome": b, "count": n}
                  for (a, b), n in sorted(Counter((r["expected"], r["outcome"]) for r in rows).items())],
    "results": rows,
}, indent=2))
