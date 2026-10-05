#!/usr/bin/env python3
"""Build small authorized own frame replays, never save or alter source videos.

Run only in athletics-lab, with selected frames already in ignored media/. Native
MP4 playback is for visual order, not a real-time measurement or original audio.
"""
import argparse,hashlib,json,shutil,subprocess,tempfile
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'reviews/assets/program-2026-10-05'

def selected(folder,start,end,crop):
 directory=ROOT/'media'/folder
 manifest=json.loads((directory/'manifest.json').read_text())
 frames=[f for f in manifest['frames'] if start<=f['pts_seconds']<=end]
 if len(frames)<8:raise ValueError('Insufficient observed frames')
 return [(directory/f['file'],crop) for f in frames],dict(source=str(directory.relative_to(ROOT)),file_interval=[start,end],frames=[f['file'] for f in frames],crop=crop)

def build(ffmpeg):
 OUT.mkdir(parents=True,exist_ok=True)
 measures=json.loads((ROOT/'reviews/assets/starts-2026-10-04/measurements.json').read_text())
 def union(prefix):
  crops=[m['crop'] for m in measures if Path(m['output']).name.startswith(prefix)]
  return (max(0,min(c[0] for c in crops)-120),max(0,min(c[1] for c in crops)-80),min(1920,max(c[2] for c in crops)+80),min(1080,max(c[3] for c in crops)+100))
 jobs={
 'ramir-a-skip':selected('review-2026-10-04/red-8466-active',194,195.85,(380,420,1280,720)),
 'misha-a-skip':selected('review-2026-10-04/8467-sequence',84,86.8,(550,410,1280,720)),
 'ramir-falling':selected('start-review-2026-10-04/3587-first-contacts',95.1,97.02,union('red-contact-')),
 'ramir-three-point':selected('start-review-2026-10-04/3589-red-low-actual',235.8,238.02,union('red-low-contact-')),
 'misha-three-point':selected('start-review-2026-10-04/3589-white-exit-actual',65.55,67.32,union('white-contact-')),
 'ramir-push-up':selected('start-review-2026-10-04/3588-pushup-upright',116.8,118.7,(680,210,1850,750)),
 'misha-push-up':selected('start-review-2026-10-04/3588-pushup-upright',119.4,121.62,(540,210,1710,750)),
 }
 for person,dirname in [('ramir','3579-wall-motion-visible'),('misha','3580-wall-motion-visible')]:
  folder=ROOT/'media/start-review-2026-10-04'/dirname
  jobs[person+'-wall']=([(folder/f'{i:04d}.jpg',None) for i in range(24)],dict(source=str(folder.relative_to(ROOT)),frames=[f'{i:04d}.jpg' for i in range(24)],crop=None))
 records=[]
 for name,(frames,record) in jobs.items():
  with tempfile.TemporaryDirectory(prefix='athletics-frame-replay-') as temp:
   for index,(source,crop) in enumerate(frames):
    im=Image.open(source).convert('RGB')
    if crop:im=im.crop(crop)
    im.thumbnail((960,540));im=im.crop((0,0,im.width//2*2,im.height//2*2))
    im.save(Path(temp)/f'{index:04d}.png')
    if index==0:im.save(OUT/(name+'.jpg'),quality=90)
   # Deliberately slowed frame replay; explicit caption on the site. No original
   # audio or synthetic anatomy; fps is playback only, not a physiological rate.
   fps=10 if name.endswith('wall') or 'a-skip' in name else 24
   subprocess.run([str(ffmpeg),'-hide_banner','-loglevel','error','-y','-framerate',str(fps),'-i',str(Path(temp)/'%04d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-crf','23','-movflags','+faststart','-an',str(OUT/(name+'.mp4'))],check=True)
  record.update(asset=name+'.mp4',poster=name+'.jpg',operation='exact own frames, fixed crop and resize only; no mirroring',playback_fps=fps,real_time_scale='unknown; do not measure physical speed or frequency',source_frame_sha256=[hashlib.sha256(p.read_bytes()).hexdigest() for p,_ in frames],output_sha256=hashlib.sha256((OUT/(name+'.mp4')).read_bytes()).hexdigest())
  records.append(record)
 private=ROOT/'media/program-reference-2026-10-05';private.mkdir(parents=True,exist_ok=True)
 (private/'own-replay-manifest.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
 public=[{key:record[key] for key in ('asset','poster','operation','playback_fps','real_time_scale','output_sha256')} | {'frame_count':len(record['frames'])} for record in records]
 (OUT/'provenance.json').write_text(json.dumps(public,ensure_ascii=False,indent=2)+'\n')
 print(f'Built {len(records)} own MP4 frame replays and posters')
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--ffmpeg',type=Path,required=True);build(parser.parse_args().ffmpeg)
