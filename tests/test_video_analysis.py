"""Geometry and bounded streaming checks for the optional analysis environment."""
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
try:
    import numpy as np
    from stream_frames import RangeReader
    from analyze_pose_experiments import angle, dtw, same_side_peak
    OPTIONAL_ENV=True
except (ModuleNotFoundError, OSError):
    OPTIONAL_ENV=False


class Response:
    status_code=206
    def __init__(self,data,start,end,status=206):
        self.status_code=status
        self.headers={'Content-Range':f'bytes {start}-{end}/{len(data)}'}
        self.raw=io.BytesIO(data[start:end+1])
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def raise_for_status(self):pass


class Session:
    def __init__(self,status=206):self.data=b'0123456789';self.calls=[];self.status=status
    def get(self,url,headers,**kwargs):
        start,end=map(int,headers['Range'][6:].split('-'));end=min(end,len(self.data)-1)
        self.calls.append((start,end));return Response(self.data,start,end,self.status)
    def close(self):pass


@unittest.skipUnless(OPTIONAL_ENV,'Optional video-analysis environment required')
class StreamingTests(unittest.TestCase):
    def test_seek_across_blocks_and_cache_limit(self):
        session=Session()
        with patch('stream_frames.requests.Session',return_value=session):
            reader=RangeReader('https://example.invalid/video',block_size=4,max_blocks=2)
            self.assertEqual(reader.read(6),b'012345');reader.seek(-3,2)
            self.assertEqual(reader.read(9),b'789');reader.seek(0)
            self.assertEqual(reader.read(2),b'01');self.assertLessEqual(len(reader.cache),2)
            self.assertTrue(all(end-start<4 for start,end in session.calls))
            self.assertEqual(reader.read(0),b'')
        with patch('stream_frames.requests.Session',return_value=Session()):
            tiny=RangeReader('https://example.invalid/tiny-video',block_size=16)
            self.assertEqual(tiny.read(),b'0123456789')
    def test_full_download_is_refused(self):
        with patch('stream_frames.requests.Session',return_value=Session(status=200)):
            with self.assertRaisesRegex(ValueError,'refusing full download'):RangeReader('https://example.invalid/video',block_size=4)


@unittest.skipUnless(OPTIONAL_ENV,'Optional video-analysis environment required')
class GeometryTests(unittest.TestCase):
    def test_phase_matching_does_not_exchange_left_and_right(self):
        student={'leglift':np.array([[0.,1.]]),'lift':np.array([1.])}
        reference={'leglift':np.array([[1.,0.],[0.,.8]]),'lift':np.array([1.,.8]),'peaks':[0,1]}
        self.assertEqual(same_side_peak(student,reference,0),1)
        reference['peaks']=[0]
        with self.assertRaisesRegex(ValueError,'No same-side'):same_side_peak(student,reference,0)
    def test_knee_angle_uses_vectors_not_coordinate_origin(self):
        a=np.array([10.,20.]);b=np.array([10.,10.]);c=np.array([20.,10.])
        self.assertAlmostEqual(angle(a,b,c),90)
        self.assertAlmostEqual(angle(a+100,b+100,c+100),90)
    def test_dtw_aligns_repeated_phase_without_distance(self):
        a=np.array([[0.],[1.],[0.]]);b=np.array([[0.],[0.],[1.],[1.],[0.]])
        cost,path=dtw(a,b);self.assertEqual(cost,0);self.assertEqual(path[0],(0,0));self.assertEqual(path[-1],(2,4))


if __name__=='__main__':unittest.main()
