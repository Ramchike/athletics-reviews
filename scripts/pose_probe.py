#!/usr/bin/env python3
"""Experimental pose extraction. Keep detections and visibility; no technique score.

Dependencies: mediapipe, numpy, pillow. Crop coordinates refer to stored frames.
The model is an estimate, including its world coordinates and segmentation.
"""
import argparse
import json
from pathlib import Path

import mediapipe as mp
import cv2
import numpy as np
from PIL import Image, ImageDraw

from stream_frames import sheet

CONNECTIONS = [(11,12),(11,13),(13,15),(12,14),(14,16),(11,23),(12,24),
               (23,24),(23,25),(25,27),(27,29),(29,31),(27,31),
               (24,26),(26,28),(28,30),(30,32),(28,32)]


def probe(folder, model, crop_y=0, suffix="full", threshold=.7, rotate=0, centers=None, red_shirt=False, red_identity=False):
    folder = Path(folder)
    manifest = json.loads((folder / "manifest.json").read_text())
    output = folder / ("pose-" + suffix)
    output.mkdir(exist_ok=False)
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_poses=4, min_pose_detection_confidence=.4,
        min_pose_presence_confidence=.4, output_segmentation_masks=True)
    records, previews = [], []
    with mp.tasks.vision.PoseLandmarker.create_from_options(options) as detector:
        for i, item in enumerate(manifest["frames"]):
            original = Image.open(folder / item["file"]).convert("RGB")
            if rotate:
                original = original.rotate(rotate, expand=True)
            w, h = original.size
            x0, x1 = 0, w
            shirt_box=None
            if red_shirt or red_identity:
                rgb=np.asarray(original).astype(np.int16)
                color=((rgb[:,:,0]>110)&(rgb[:,:,0]-rgb[:,:,1]>65)&(rgb[:,:,0]-rgb[:,:,2]>55)).astype(np.uint8)
                color[:400]=0
                color=cv2.morphologyEx(color,cv2.MORPH_CLOSE,np.ones((7,7),np.uint8))
                _,_,components,_=cv2.connectedComponentsWithStats(color)
                candidates=[(x,y,bw,bh,area) for x,y,bw,bh,area in components[1:] if 12<=bw<=140 and 20<=bh<=210 and .45<bh/bw<5 and area>150]
                if not candidates:
                    records.append({"file":item["file"],"pts_seconds":item["pts_seconds"],"width":w,"height":h,"crop_y":crop_y,
                                    "crop_box":[0,crop_y,w,h],"rotation_applied":rotate,"selected_candidate":None,"poses":[],"reason":"red shirt not located"})
                    continue
                shirt_box=max(candidates,key=lambda box:box[4])
                if red_shirt:
                    center=shirt_box[0]+shirt_box[2]/2
                    center=min(max(center,200),max(200,w-200))
                    x0,x1=max(0,int(center-200)),min(w,int(center+200))
            if centers is not None:
                center = centers[0] + (centers[1]-centers[0])*i/max(1,len(manifest["frames"])-1)
                center = min(max(center,200),max(200,w-200))
                x0, x1 = max(0, int(center-200)), min(w, int(center+200))
            cw = x1-x0
            crop = original.crop((x0, crop_y, x1, h))
            result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB,
                                             data=np.asarray(crop)))
            poses = []
            for landmarks, world in zip(result.pose_landmarks, result.pose_world_landmarks):
                pts = [[p.x*cw+x0, p.y*(h-crop_y)+crop_y, p.z*cw,
                        p.visibility, p.presence] for p in landmarks]
                poses.append({"pixels": pts,
                              "world": [[p.x,p.y,p.z,p.visibility,p.presence] for p in world]})
            # Largest estimated vertical extent. This is a candidate, not an identity.
            selected = max(range(len(poses)), key=lambda k:
                           np.ptp(np.asarray(poses[k]["pixels"])[[0,11,12,23,24,25,26,27,28],1]),
                           default=None)
            if shirt_box and poses:
                shirt_center_x=shirt_box[0]+shirt_box[2]/2
                selected=min(range(len(poses)),key=lambda k:
                             abs(np.mean(np.asarray(poses[k]['pixels'])[[11,12],0])-shirt_center_x)+
                             .5*abs(np.mean(np.asarray(poses[k]['pixels'])[[11,12],1])-(shirt_box[1]+12)))
                if abs(np.mean(np.asarray(poses[selected]['pixels'])[[11,12],0])-shirt_center_x)>90:
                    selected=None
                if selected is not None:
                    candidate=np.asarray(poses[selected]['pixels'])
                    shoulder=np.mean(candidate[[11,12],:2],axis=0)
                    hip=np.mean(candidate[[23,24],:2],axis=0)
                    fractions=[]
                    for alpha in [.15,.3,.5,.65,.8]:
                        xx,yy=np.round(shoulder*(1-alpha)+hip*alpha).astype(int)
                        patch=rgb[max(0,yy-5):min(h,yy+6),max(0,xx-5):min(w,xx+6)]
                        if patch.size:
                            fractions.append(float(np.mean((patch[:,:,0]>90)&(patch[:,:,0]-patch[:,:,1]>50)&(patch[:,:,0]-patch[:,:,2]>40))))
                    if not fractions or np.median(fractions)<.1:
                        selected=None
            record = {"file": item["file"], "pts_seconds": item["pts_seconds"],
                      "width": w, "height": h, "crop_y": crop_y,
                      "crop_box": [x0,crop_y,x1,h],
                      "red_shirt_box": list(map(int,shirt_box)) if shirt_box else None,
                      "rotation_applied": rotate, "selected_candidate": selected, "poses": poses}
            if selected is not None:
                pts = np.asarray(poses[selected]["pixels"])
                record["visible_body_fraction"] = float(np.mean(pts[11:33,3] >= threshold))
                record["bbox_height_pixels"] = float(np.ptp(pts[[0,11,12,23,24,25,26,27,28],1]))
                if result.segmentation_masks:
                    mask = result.segmentation_masks[selected].numpy_view().squeeze()
                    Image.fromarray((np.clip(mask,0,1)*255).astype("uint8")).save(output / f"mask-{i:04d}.png")
            records.append(record)
            if i % max(1,len(manifest["frames"])//16) == 0:
                draw = ImageDraw.Draw(original)
                if selected is not None:
                    pts = poses[selected]["pixels"]
                    for a,b in CONNECTIONS:
                        if min(pts[a][3],pts[b][3]) >= threshold:
                            draw.line((tuple(pts[a][:2]),tuple(pts[b][:2])), fill="#00ffb3", width=3)
                    for j in range(11,33):
                        x,y,_,v,_=pts[j]
                        if v >= threshold:
                            draw.ellipse((x-3,y-3,x+3,y+3), fill="#ffff00")
                lossless=Path(item['file']).suffix.lower()=='.png'
                path = output / f"overlay-{i:04d}.{'png' if lossless else 'jpg'}"
                original.save(path, **({} if lossless else {"quality":92}))
                previews.append((path, f'{item["pts_seconds"]:.3f}s; {len(poses)} candidates'))
    payload = {"model": Path(model).name, "mediapipe_version":mp.__version__, "mode": "IMAGE", "threshold": threshold,
               "selection": "nearest shoulder to located red shirt" if (red_shirt or red_identity) else "largest estimated body height, manually validate identity",
               "crop_y": crop_y, "frames": records}
    (output / "poses.json").write_text(json.dumps(payload, ensure_ascii=False) + "\n")
    sheet([p for p,_ in previews],[s for _,s in previews],output / "overlays.jpg")
    print(json.dumps({"output":str(output),"frames":len(records),
                      "detected":sum(x["selected_candidate"] is not None for x in records),
                      "mean_visible_body_fraction":float(np.mean([x.get("visible_body_fraction",0) for x in records]))}), flush=True)
    return payload


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder")
    parser.add_argument("--model",required=True)
    parser.add_argument("--crop-y",type=int,default=0)
    parser.add_argument("--suffix",default="full")
    parser.add_argument("--rotate",type=int,default=0)
    parser.add_argument("--centers",nargs=2,type=float)
    parser.add_argument("--red-shirt",action="store_true")
    parser.add_argument("--red-identity",action="store_true")
    args=parser.parse_args()
    probe(args.folder,args.model,args.crop_y,args.suffix,rotate=args.rotate,centers=args.centers,red_shirt=args.red_shirt,red_identity=args.red_identity)


if __name__ == "__main__":
    main()
