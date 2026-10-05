import unittest
import io
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

import av
import numpy as np
from PIL import Image

from scripts.annotate_start_frame import inclination, vertex_angle
from scripts.stream_frames import readable_time
from scripts import stream_frames


class StartGeometryTests(unittest.TestCase):
    def test_straight_and_right_joint(self):
        self.assertAlmostEqual(vertex_angle((0,0),(1,0),(2,0)),180)
        self.assertAlmostEqual(vertex_angle((0,1),(0,0),(1,0)),90)

    def test_image_direction_does_not_change_inclination(self):
        self.assertAlmostEqual(inclination((0,0),(1,-1)),45)
        self.assertAlmostEqual(inclination((1,-1),(0,0)),45)
        self.assertAlmostEqual(inclination((0,0),(0,3)),90)

    def test_occluded_or_missing_points_cannot_be_zero_vectors(self):
        with self.assertRaises(ValueError): vertex_angle((1,1),(1,1),(2,2))
        with self.assertRaises(ValueError): inclination((1,1),(1,1))

    def test_timestamp_carries_to_next_minute(self):
        self.assertEqual(readable_time(59.98),'1:00,0')
        self.assertEqual(readable_time(85.03),'1:25,0')

    def test_sequential_sampling_keeps_correct_frames_after_duplicate_and_seek(self):
        # A separate full decode is the oracle; no HTTP or personal media needed.
        buffer = io.BytesIO()
        with av.open(buffer, 'w', format='mp4') as container:
            stream = container.add_stream('mpeg4', rate=30)
            stream.width, stream.height, stream.pix_fmt = 64, 48, 'yuv420p'
            for i in range(60):
                rgb = np.full((48, 64, 3), (i * 3, 40, 180-i), dtype=np.uint8)
                frame = av.VideoFrame.from_ndarray(rgb, format='rgb24')
                for packet in stream.encode(frame): container.mux(packet)
            for packet in stream.encode(): container.mux(packet)
        data = buffer.getvalue()
        with av.open(io.BytesIO(data)) as container:
            expected = [(float(f.pts*f.time_base), f.to_ndarray(format='rgb24'))
                        for f in container.decode(video=0)]

        class MemorySource(io.BytesIO):
            def __init__(self, url):
                super().__init__(data)
                self.size, self.bytes_read, self.requests_made = len(data), 0, 0

        targets = [.01, .04, .04, .06, .39, 1.7, .2]
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)/'media'/'sample'
            with patch.object(stream_frames, '__file__', str(Path(tmp)/'scripts'/'stream_frames.py')), \
                 patch.object(stream_frames, 'RangeReader', MemorySource):
                result = stream_frames.extract('memory', output, targets, lossless=True)
            self.assertEqual(result['status'], 'complete')
            for target, record in zip(targets, result['frames']):
                pts, pixels = next((p, a) for p, a in expected if p+1e-9 >= target)
                self.assertAlmostEqual(record['pts_seconds'], pts)
                with Image.open(output/record['file']) as image:
                    np.testing.assert_array_equal(np.asarray(image), pixels)
            self.assertFalse(json.loads((output/'manifest.json').read_text())['original_saved'])
