"""Compare MediaPipe Pose Landmarker variants on the same video frames."""
import argparse
import json
from pathlib import Path
from time import perf_counter

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--models", type=Path, nargs="+", required=True)
parser.add_argument("--clips", type=Path, nargs="+", required=True)
parser.add_argument("--crossings", type=Path, help="Optional manually labelled image-plane crossings")
args = parser.parse_args()
cv2.setNumThreads(1)
references = json.loads(args.crossings.read_text()) if args.crossings else {}


def compare_crossings(torso_edges, fps, labels):
    comparisons = []
    for label in labels:
        line, direction = label["line"], label["direction"]
        predicted = None
        if 1000 / fps <= 85:
            for frame, (first, second) in enumerate(zip(torso_edges, torso_edges[1:])):
                if first is None or second is None:
                    continue
                a, b = first[direction], second[direction]
                if (a - line) * direction < 0 <= (b - line) * direction:
                    predicted = frame + (line - a) / (b - a)
                    break
        lo, hi = label["reference_frames"]
        comparisons.append({
            **label,
            "predicted_frame": round(predicted, 2) if predicted is not None else None,
            "within_reference": predicted is not None and lo <= predicted <= hi,
        })
    return comparisons

for model in args.models:
    for clip in args.clips:
        cap = cv2.VideoCapture(str(clip))
        fps = cap.get(cv2.CAP_PROP_FPS)
        if not fps:
            raise RuntimeError(f"Could not decode {clip}")
        options = vision.PoseLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=str(model)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
        )
        times = []
        all_torso = 0
        frames = 0
        torso_edges = []
        with vision.PoseLandmarker.create_from_options(options) as detector:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                h, w = frame.shape[:2]
                if w > 640:
                    frame = cv2.resize(frame, (640, round(h * 640 / w)))
                image = mp.Image(
                    image_format=mp.ImageFormat.SRGB,
                    data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB),
                )
                start = perf_counter()
                result = detector.detect_for_video(image, round(frames * 1000 / fps))
                elapsed = (perf_counter() - start) * 1000
                points = ([result.pose_landmarks[0][i] for i in (11, 12, 23, 24)]
                          if result.pose_landmarks else [])
                visible = bool(points) and all(point.visibility >= 0.45 for point in points)
                if clip.name in references:
                    torso_edges.append({
                        -1: min(point.x for point in points), 1: max(point.x for point in points),
                    } if visible else None)
                frames += 1
                if frames > 5:
                    times.append(elapsed)
                    all_torso += int(visible)
        cap.release()
        if not times:
            raise RuntimeError(f"Need at least six frames in {clip}")
        report = {
            "model": model.stem, "clip": clip.name, "frames": len(times), "torso_frames": all_torso,
            "p50_ms": round(float(np.percentile(times, 50)), 1),
            "p95_ms": round(float(np.percentile(times, 95)), 1),
        }
        if clip.name in references:
            report["crossings"] = compare_crossings(torso_edges, fps, references[clip.name])
        print(json.dumps(report), flush=True)
