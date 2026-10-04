#!/usr/bin/env python3
"""Annotate manually verified source points; never infer joints or medical angles.

Specification contains source/output paths within ignored media/, title, points,
segments, angles (vertex or inclination), notes, and optional crop. Measurements
use source pixels before crop. Inclination is the acute angle to image horizontal.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def vertex_angle(a, b, c):
    u, v = (a[0] - b[0], a[1] - b[1]), (c[0] - b[0], c[1] - b[1])
    lengths = math.hypot(*u) * math.hypot(*v)
    if lengths == 0:
        raise ValueError("Coincident points do not define an angle")
    return math.degrees(math.acos(max(-1, min(1, (u[0]*v[0]+u[1]*v[1])/lengths))))


def inclination(a, b):
    dx, dy = abs(b[0]-a[0]), abs(b[1]-a[1])
    if dx == dy == 0:
        raise ValueError("Coincident points do not define inclination")
    return math.degrees(math.atan2(dy, dx))


def render(spec, media_root):
    source, output = Path(spec['source']).resolve(), Path(spec['output']).resolve()
    for path in (source, output):
        if not path.is_relative_to(media_root.resolve()):
            raise ValueError("Personal frames and overlays must stay in media/")
    if output.exists() or source == output:
        raise ValueError("Never overwrite source or existing annotation")
    with Image.open(source) as im:
        original = im.convert('RGB')
    points = spec['points']
    for name, (x, y) in points.items():
        if not 0 <= x < original.width or not 0 <= y < original.height:
            raise ValueError(f"Point {name} lies outside source")
    draw = ImageDraw.Draw(original)
    for a, b, color in spec['segments']:
        draw.line([tuple(points[a]), tuple(points[b])], fill=color, width=4)
    for point in points.values():
        x, y = point
        draw.ellipse((x-4,y-4,x+4,y+4),fill='white',outline='black',width=1)
    results = []
    for angle in spec['angles']:
        names = angle['points']; p = [points[n] for n in names]
        value = vertex_angle(*p) if len(p) == 3 else inclination(*p)
        if len(p) == 3:
            b = p[1]
            directions = [math.degrees(math.atan2(q[1]-b[1],q[0]-b[0])) % 360 for q in (p[0],p[2])]
            start, end = directions
            if (end-start) % 360 > 180: start, end = end, start
            draw.arc((b[0]-24,b[1]-24,b[0]+24,b[1]+24),start,start+(end-start)%360,fill=angle['color'],width=3)
        else:
            a, b = p
            draw.line((a[0],a[1],a[0]+75,a[1]),fill=angle['color'],width=2)
        results.append({**angle,'degrees':value})
    crop = spec.get('crop',(0,0,original.width,original.height))
    original = original.crop(crop)
    factor = min(2, 1000/original.width)
    if factor > 1:
        original = original.resize((round(original.width*factor),round(original.height*factor)))
    lines = [spec['title']] + [f"{a['label']}: ≈{round(a['degrees'])}°" for a in results] + spec.get('notes',[])
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
    panel_width = max(1000,original.width)
    canvas = Image.new('RGB',(panel_width,original.height+36+len(lines)*28),'#141923')
    canvas.paste(original,(0,0));d=ImageDraw.Draw(canvas)
    for i,line in enumerate(lines):
        color=results[i-1]['color'] if 1 <= i <= len(results) else 'white'
        d.text((12,original.height+14+i*28),line,font=font,fill=color)
    output.parent.mkdir(parents=True,exist_ok=True);canvas.save(output)
    record={**spec,'results':results,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
            'output_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),
            'measurement_basis':'manual source pixels, 2D projection; perspective uncertainty not calibrated'}
    output.with_suffix('.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    return results


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('spec')
    args=parser.parse_args()
    render(json.loads(Path(args.spec).read_text()),Path(__file__).resolve().parents[1]/'media')
