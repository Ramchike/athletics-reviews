"""JPEG inference worker for the loopback stream benchmark."""
import base64
import json
import sys
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

model = Path(__file__).parent / "public" / "pose.task"
cv2.setNumThreads(1)
options = vision.PoseLandmarkerOptions(
    base_options=python.BaseOptions(model_asset_path=str(model)),
    running_mode=vision.RunningMode.IMAGE,
    num_poses=1,
)
with vision.PoseLandmarker.create_from_options(options) as detector:
    print("ready", flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        jpeg = base64.b64decode(request["jpeg"])
        frame = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        result = detector.detect(image)
        print(json.dumps({"id": request["id"], "pose": bool(result.pose_landmarks)}), flush=True)
