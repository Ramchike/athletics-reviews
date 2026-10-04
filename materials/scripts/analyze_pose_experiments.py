#!/usr/bin/env python3
"""Reproduce exploratory comparisons, with visibility gates and file-time labels.

Run after stream_frames.py and pose_probe.py. No coaching score or calibrated 3D.
"""
import argparse
import json
from pathlib import Path

import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image, ImageDraw, ImageOps
from scipy.signal import find_peaks

from pose_probe import CONNECTIONS


def angle(a,b,c):
    u,v=a-b,c-b
    return float(np.degrees(np.arccos(np.clip(np.dot(u,v)/(np.linalg.norm(u)*np.linalg.norm(v)),-1,1))))


def dtw(a,b):
    """Dynamic alignment of feature vectors; distance is not a technique grade."""
    costs=np.full((len(a)+1,len(b)+1),np.inf);costs[0,0]=0
    previous={}
    for i in range(1,len(a)+1):
        for j in range(1,len(b)+1):
            options=[(costs[i-1,j-1],(i-1,j-1)),(costs[i-1,j],(i-1,j)),(costs[i,j-1],(i,j-1))]
            cost,prev=min(options,key=lambda x:x[0])
            costs[i,j]=cost+np.linalg.norm(a[i-1]-b[j-1]);previous[i,j]=prev
    path=[];i,j=len(a),len(b)
    while i and j:
        path.append((i-1,j-1));i,j=previous[i,j]
    path.reverse()
    return float(costs[-1,-1]/len(path)),path


def load(folder,suffix):
    payload=json.loads((folder/f'pose-{suffix}'/'poses.json').read_text())
    n=len(payload['frames']);pts=np.full((n,33,5),np.nan);world=np.full((n,33,5),np.nan)
    for i,f in enumerate(payload['frames']):
        if f['selected_candidate'] is not None:
            pose=f['poses'][f['selected_candidate']];pts[i]=pose['pixels'];world[i]=pose['world']
    hips=np.mean(pts[:,[23,24],:2],axis=1);shoulders=np.mean(pts[:,[11,12],:2],axis=1)
    torso=np.linalg.norm(hips-shoulders,axis=1)
    normalized=(pts[:,:,:2]-hips[:,None,:])/torso[:,None,None]
    valid=pts[:,:,3]>=.7
    lift=np.full(n,np.nan);knee_angles=np.full((n,2),np.nan)
    lean=np.degrees(np.arctan2(shoulders[:,0]-hips[:,0],hips[:,1]-shoulders[:,1]))
    lean[~np.all(valid[:,[11,12,23,24]],axis=1)]=np.nan
    leglift=np.full((n,2),np.nan)
    for i in range(n):
        for side,(hip,knee,ankle) in enumerate([(23,25,27),(24,26,28)]):
            if valid[i,hip] and valid[i,knee]:leglift[i,side]=(pts[i,hip,1]-pts[i,knee,1])/torso[i]
            if all(valid[i,[hip,knee,ankle]]):knee_angles[i,side]=angle(pts[i,hip,:2],pts[i,knee,:2],pts[i,ankle,:2])
        if np.any(np.isfinite(leglift[i])):lift[i]=np.nanmax(leglift[i])
    times=np.array([f['pts_seconds'] for f in payload['frames']])
    known=np.flatnonzero(np.isfinite(lift));peaks=[]
    if len(known)>3:
        interp=np.interp(np.arange(n),known,lift[known])
        candidates,_=find_peaks(interp,distance=4,prominence=.15)
        peaks=[int(i) for i in candidates if np.isfinite(lift[i])]
    return dict(folder=folder,suffix=suffix,payload=payload,pts=pts,world=world,valid=valid,
                normalized=normalized,torso=torso,lift=lift,leglift=leglift,lean=lean,
                knee_angles=knee_angles,times=times,peaks=peaks)


def plain(data,index):
    f=data['payload']['frames'][index]
    image=Image.open(data['folder']/f['file']).convert('RGB')
    if f.get('rotation_applied'):image=image.rotate(f['rotation_applied'],expand=True)
    return image


def body_image(data,index,mirror=False,overlay=False):
    image=plain(data,index);pts=data['pts'][index];valid=data['valid'][index]
    if overlay:
        draw=ImageDraw.Draw(image)
        for a,b in CONNECTIONS:
            if valid[a] and valid[b]:draw.line((tuple(pts[a,:2]),tuple(pts[b,:2])),fill='#00efab',width=3)
    indices=[j for j in [0,11,12,13,14,15,16,23,24,25,26,27,28,29,30,31,32] if valid[j]]
    xy=pts[indices,:2];left,top=np.min(xy,axis=0)-30;right,bottom=np.max(xy,axis=0)+30
    image=image.crop((max(0,int(left)),max(0,int(top)),min(image.width,int(right)),min(image.height,int(bottom))))
    return ImageOps.mirror(image) if mirror else image


def normalized_mask(data,index):
    path=data['folder']/f'pose-{data["suffix"]}'/f'mask-{index:04d}.png'
    mask=np.array(Image.open(path))>=128
    y,x=np.where(mask)
    if len(x)==0:return np.zeros((256,128),np.uint8)
    crop=mask[y.min():y.max()+1,x.min():x.max()+1].astype(np.uint8)
    return cv2.resize(crop,(128,256),interpolation=cv2.INTER_NEAREST)


def rigid_distance(a,b):
    a=a-a.mean(axis=0);b=b-b.mean(axis=0)
    u,_,vt=np.linalg.svd(b.T@a);r=u@vt
    if np.linalg.det(r)<0:u[:,-1]*=-1;r=u@vt
    return float(np.sqrt(np.mean(np.sum((a-b@r)**2,axis=1))))


def same_side_peak(student, reference, student_index):
    """Choose only peaks with the same model-labelled leg; never relabel anatomy.

    Model side labels still need manual verification in the original frames.
    """
    side=int(np.nanargmax(student['leglift'][student_index]))
    candidates=[k for k in reference['peaks']
                if np.isfinite(reference['leglift'][k]).any()
                and int(np.nanargmax(reference['leglift'][k])) == side]
    if not candidates:
        raise ValueError('No same-side reference peak; choose and review another sequence')
    return min(candidates,key=lambda k:abs(student['lift'][student_index]-reference['lift'][k]))


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--student',default='8467-sequence')
    parser.add_argument('--reference',default='reference-A')
    parser.add_argument('--out-name',default='experiments')
    parser.add_argument('--sensitivity-source',default='8466-sequence')
    parser.add_argument('--sensitivity-suffixes',nargs='+',default=['whole','crop-v2','lite-crop','tracked-v2'])
    parser.add_argument('--mirror-reference',action=argparse.BooleanOptionalAction,default=False)
    parser.add_argument('--student-time',type=float)
    parser.add_argument('--reference-time',type=float)
    args=parser.parse_args();root=args.root;out=root/args.out_name;out.mkdir(exist_ok=False)
    sets={name:load(root/name,suffix) for name,suffix in [
        ('8466-sequence','tracked-v2'),('8467-sequence','tracked-v2'),
        ('8468-sequence','tracked-v2'),('8471-sequence','tracked-v2'),
        ('reference-A','full-v2'),('reference-B-active','tracked-v2'),('reference-C','full')]}
    for folder in sorted(root.glob('red-*')):
        if (folder/'pose-red-located-v4'/'poses.json').exists():sets[folder.name]=load(folder,'red-located-v4')
        elif (folder/'pose-red-located-v3'/'poses.json').exists():sets[folder.name]=load(folder,'red-located-v3')
        elif (folder/'pose-red-located-v2'/'poses.json').exists():sets[folder.name]=load(folder,'red-located-v2')
        elif (folder/'pose-red-located'/'poses.json').exists():sets[folder.name]=load(folder,'red-located')
        elif (folder/'pose-tracked'/'poses.json').exists():sets[folder.name]=load(folder,'tracked')
    stats={}
    for name,d in sets.items():
        pts,valid=d['pts'],d['valid'];detected=np.isfinite(pts[:,0,0]);
        bone2=[];bone3=[]
        for a,b in [(23,25),(25,27),(24,26),(26,28)]:
            gate=valid[:,a]&valid[:,b]
            if gate.sum()>2:
                b2=np.linalg.norm(pts[gate,a,:2]-pts[gate,b,:2],axis=1)/d['torso'][gate]
                b3=np.linalg.norm(d['world'][gate,a,:3]-d['world'][gate,b,:3],axis=1)
                bone2.append(float(np.std(b2)/np.mean(b2)));bone3.append(float(np.std(b3)/np.mean(b3)))
        stats[name]={
            'sampled_frames':len(pts),'detected_candidates':int(detected.sum()),
            'fraction_body_points_visibility_ge_0_7':float(np.mean(valid[:,11:33])),
            'both_knees_visible_frames':int(np.all(valid[:,[23,24,25,26]],axis=1).sum()),
            'both_ankles_visible_frames':int(np.all(valid[:,[23,24,27,28]],axis=1).sum()),
            'both_feet_visible_frames':int(np.all(valid[:,[27,28,29,30,31,32]],axis=1).sum()),
            'valid_knee_angle_frames_per_side':np.isfinite(d['knee_angles']).sum(axis=0).tolist(),
            'lift_peak_file_times':[float(d['times'][i]) for i in d['peaks']],
            'lift_peak_intervals_file_seconds':np.diff(d['times'][d['peaks']]).tolist(),
            'bone_length_cv_2d_by_segment':bone2,'bone_length_cv_inferred_3d_by_segment':bone3,
            'lean_2d_quantiles_degrees':np.nanquantile(d['lean'],[.1,.5,.9]).tolist() if np.isfinite(d['lean']).any() else [],
            'side_label_warning':'Side visibility and identity swaps prevent a symmetry verdict',
            'model_side_knee_lift_valid_frames':np.isfinite(d['leglift']).sum(axis=0).tolist(),
            'model_side_knee_lift_90th_percentile':[float(np.nanquantile(d['leglift'][:,s],.9)) if np.isfinite(d['leglift'][:,s]).any() else None for s in range(2)],
        }
    # Pixel diff and camera compensation on two actual source frames, excluding foreground.
    d=sets[args.student];a=np.array(plain(d,0));b=np.array(plain(d,30));gray_a=cv2.cvtColor(a,cv2.COLOR_RGB2GRAY);gray_b=cv2.cvtColor(b,cv2.COLOR_RGB2GRAY)
    mask=np.zeros(gray_a.shape,np.uint8);mask[:350]=255
    orb=cv2.ORB_create(nfeatures=2000);k1,q1=orb.detectAndCompute(gray_a,mask);k2,q2=orb.detectAndCompute(gray_b,mask)
    matches=cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(q2,q1,k=2)
    good=[m for pair in matches if len(pair)==2 for m,n in [pair] if m.distance<.75*n.distance]
    affine,inliers=cv2.estimateAffinePartial2D(np.float32([k2[m.queryIdx].pt for m in good]),np.float32([k1[m.trainIdx].pt for m in good]),method=cv2.RANSAC)
    warped=cv2.warpAffine(b,affine,(a.shape[1],a.shape[0]));raw=np.abs(a.astype(float)-b.astype(float));comp=np.abs(a.astype(float)-warped.astype(float))
    Image.fromarray(np.clip(raw*4,0,255).astype(np.uint8)).save(out/'pixel-diff.jpg')
    Image.fromarray(np.clip(comp*4,0,255).astype(np.uint8)).save(out/'stabilized-diff.jpg')
    stats['camera_and_pixel_diff']={'times':[float(d['times'][0]),float(d['times'][30])],'raw_background_mean_absolute_difference_0_255':float(raw[:350].mean()),
        'stabilized_background_mean_absolute_difference_0_255':float(comp[10:340,10:-10].mean()),
        'background_affine':affine.tolist(),'inlier_matches':int(inliers.sum()),
        'relative_background_rotation_degrees':float(np.degrees(np.arctan2(affine[1,0],affine[0,0]))),
        'camera_yaw_degrees':None,'note':'Relative image alignment is not camera calibration'}
    # Preserve anatomical side labels. Explicit times require manual phase review.
    student=sets[args.student];reference=sets[args.reference]
    candidates=[i for i in student['peaks'] if np.all(student['valid'][i,[11,12,23,24]])]
    i=(int(np.argmin(abs(student['times']-args.student_time))) if args.student_time is not None
       else max(candidates,key=lambda k:student['valid'][k,11:33].sum()))
    j=(int(np.argmin(abs(reference['times']-args.reference_time))) if args.reference_time is not None
       else same_side_peak(student,reference,i))
    board=Image.new('RGB',(1200,650),'#151922');draw=ImageDraw.Draw(board)
    for x,data,idx,mirror,label in [(0,student,i,False,'Your recording'),(600,reference,j,args.mirror_reference,'Noah Lyles'+('; mirrored' if args.mirror_reference else ''))]:
        im=body_image(data,idx,mirror,True);im=ImageOps.contain(im,(570,590));board.paste(im,(x+(600-im.width)//2,35));draw.text((x+20,10),f'{label}: {data["times"][idx]:.3f}s',fill='white')
    board.save(out/'phase-comparison.jpg',quality=93)
    sn=student['normalized'][i];rn=reference['normalized'][j].copy()
    if args.mirror_reference:rn[:,0]*=-1
    rv=reference['valid'][j]
    common=student['valid'][i]&rv;common[:11]=False
    direct=float(np.sqrt(np.mean(np.sum((sn[common]-rn[common])**2,axis=1))))
    core=common.copy();core[:]=False
    core[[11,12,23,24,25,26,27,28]]=common[[11,12,23,24,25,26,27,28]]
    core_distance=float(np.sqrt(np.mean(np.sum((sn[core]-rn[core])**2,axis=1))))
    procrustes=rigid_distance(sn[common],rn[common])
    sm=normalized_mask(student,i);rm=normalized_mask(reference,j)
    if args.mirror_reference:rm=np.fliplr(rm)
    iou=float(np.sum(sm&rm)/np.sum(sm|rm))
    fig,ax=plt.subplots(figsize=(6,7))
    for pts,visibility,color,label in [(sn,student['valid'][i],'tab:blue','Recording'),(rn,rv,'tab:orange','Reference (original side labels)')]:
        ax.scatter(pts[visibility,0],-pts[visibility,1],c=color,s=18,label=label)
        for aa,bb in CONNECTIONS:
            if visibility[aa] and visibility[bb]:ax.plot(pts[[aa,bb],0],-pts[[aa,bb],1],color=color)
    ax.axis('equal');ax.legend();ax.set_xlabel('Torso lengths');ax.set_title('Hip-centered 2D pose, matched knee-lift phase');fig.tight_layout();fig.savefig(out/'normalized-pose.png',dpi=140);plt.close(fig)
    stats['matched_phase']={'student_file_seconds':float(student['times'][i]),'reference_file_seconds':float(reference['times'][j]),
        'student_frame_index':i,'reference_frame_index':j,'common_visible_body_points':int(common.sum()),
        'reference_side_labels_swapped_for_phase':False,
        'manual_anatomical_side_verified':False,
        'reference_horizontally_mirrored':args.mirror_reference,
        'normalized_joint_rms_torso_lengths':direct,'procrustes_rms_torso_lengths':procrustes,
        'core_joint_rms_torso_lengths':core_distance,
        'bbox_normalized_mask_iou':iou,'student_projected_knee_angles':student['knee_angles'][i].tolist(),
        'reference_projected_knee_angles':reference['knee_angles'][j].tolist(),
        'note':'Illustrative descriptors, different viewpoints and body proportions; no quality score'}
    # Curves, candidate phases, ankle trajectories, and DTW on trusted samples only.
    fig,axes=plt.subplots(3,1,figsize=(11,10))
    curve_names=[args.student,args.reference]
    for name in curve_names:
        v=sets[name];t=v['times']-v['times'][0]
        axes[0].plot(t,v['lift'],label=name);axes[0].scatter(t[v['peaks']],v['lift'][v['peaks']],s=20)
        axes[1].plot(t,v['lean'],label=name)
    axes[0].set_ylabel('Knee lift / torso');axes[1].set_ylabel('2D trunk lean (degrees)')
    for side,k in [('Model left',27),('Model right',28)]:
        gate=student['valid'][:,k]&np.all(student['valid'][:,[23,24]],axis=1)
        axes[2].scatter(student['normalized'][gate,k,0],-student['normalized'][gate,k,1],s=12,label=side)
    axes[2].set_xlabel('Ankle relative to hips / torso');axes[2].set_ylabel('Relative vertical coordinate')
    for ax in axes:ax.legend();ax.grid(alpha=.2)
    axes[0].set_xlabel('File elapsed seconds; physical time unconfirmed');fig.tight_layout();fig.savefig(out/'trajectories-and-phases.png',dpi=130);plt.close(fig)
    gate1=np.isfinite(student['lift'])&np.isfinite(student['lean']);gate2=np.isfinite(reference['lift'])&np.isfinite(reference['lean'])
    f1=np.column_stack((student['lift'][gate1],student['lean'][gate1]/90));f2=np.column_stack((reference['lift'][gate2],(-1 if args.mirror_reference else 1)*reference['lean'][gate2]/90))
    dist,path=dtw(f1,f2)
    linear1=np.column_stack([np.interp(np.linspace(0,1,50),np.linspace(0,1,len(f1)),f1[:,k]) for k in range(2)])
    linear2=np.column_stack([np.interp(np.linspace(0,1,50),np.linspace(0,1,len(f2)),f2[:,k]) for k in range(2)])
    stats['temporal_alignment']={'features':['visible knee lift / torso','projected trunk lean / 90'],
        'valid_frames':[len(f1),len(f2)],'linear_resampling_mean_feature_distance':float(np.mean(np.linalg.norm(linear1-linear2,axis=1))),
        'dtw_mean_feature_distance':dist,'dtw_path_length':len(path),'warning':'Missing frames omitted; partial clip boundaries, cadence and viewpoint differ'}
    fig,ax=plt.subplots(figsize=(7,5));ax.plot(*np.array(path).T);ax.set_xlabel('Valid recording frame index');ax.set_ylabel('Valid reference frame index');ax.set_title('DTW alignment, descriptive only');fig.tight_layout();fig.savefig(out/'dtw-path.png',dpi=120);plt.close(fig)
    # Sensitivity to crop/model and visibility threshold, not independent ground truth.
    variants={suffix:load(root/args.sensitivity_source,suffix) for suffix in args.sensitivity_suffixes}
    sensitivity={}
    base=variants[args.sensitivity_suffixes[0]]
    for suffix,v in variants.items():
        gate=base['valid']&v['valid'];gate[:,:11]=False
        difference=np.linalg.norm(base['pts'][:,:,:2]-v['pts'][:,:,:2],axis=2)/base['torso'][:,None]
        sensitivity[suffix]={'detected_frames':int(np.isfinite(v['pts'][:,0,0]).sum()),'visible_fraction':float(v['valid'][:,11:33].mean()),
            'median_common_point_delta_torso_lengths':float(np.nanmedian(difference[gate])) if gate.any() else None}
    thresholds={str(th):int(np.all(student['pts'][:,[23,24,25,26,27,28],3]>=th,axis=1).sum()) for th in [.5,.7,.9]}
    stats['model_crop_sensitivity']=sensitivity;stats['complete_leg_frames_by_threshold']=thresholds
    def clean(value):
        if isinstance(value,float) and not np.isfinite(value):return None
        if isinstance(value,dict):return {k:clean(v) for k,v in value.items()}
        if isinstance(value,list):return [clean(v) for v in value]
        return value
    (out/'results.json').write_text(json.dumps(clean(stats),ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    print(json.dumps(clean(stats),ensure_ascii=False,indent=2,allow_nan=False))


if __name__=='__main__':main()
