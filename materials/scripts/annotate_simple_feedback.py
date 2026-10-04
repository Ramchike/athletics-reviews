#!/usr/bin/env python3
"""Render observations on original crops; no anatomy synthesis or joint estimation."""
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]/'media/review-2026-10-04'
OUT=ROOT/'simple-feedback';OUT.mkdir(exist_ok=True)
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':13,'text.color':'#edf3fa','axes.titlecolor':'#edf3fa','figure.facecolor':'#101823'})

def panel(ax,path,box,title):
    image=Image.open(path).convert('RGB').crop(box)
    ax.imshow(image,extent=(box[0],box[2],box[3],box[1]),interpolation='nearest')
    ax.set_xlim(box[0],box[2]);ax.set_ylim(box[3],box[1]);ax.axis('off');ax.set_title(title,pad=12,fontsize=14)

def note(ax,text,point,position,color='#efbf61'):
    ax.annotate(text,xy=point,xytext=position,fontsize=12,ha='left',va='center',color=color,
                bbox={'boxstyle':'round,pad=.5','fc':'#101823','ec':color,'alpha':.97},
                arrowprops={'arrowstyle':'->','color':color,'lw':2})

fig,axes=plt.subplots(1,2,figsize=(12,6.8));fig.subplots_adjust(top=.81,bottom=.11,left=.03,right=.97,wspace=.09)
fig.suptitle('Ты в красном: крупную ошибку здесь не подтверждаю',fontsize=19,y=.97)
fig.text(.5,.905,'Это две разные ноги твоего цикла. С чужой стороной их не сравниваем.',ha='center',fontsize=12,color='#b9c6d8')
panel(axes[0],ROOT/'evidence-user/frame-0000.png',(530,410,780,720),'IMG_8466 · 194,400 с')
# Callouts identify visible regions, not measured joint centres.
note(axes[0],'Колено согнуто,\nподъём виден',(675,563),(552,440),'#80ddc2')
note(axes[0],'Корпус: проверять\nустойчивость',(625,532),(548,636))
panel(axes[1],ROOT/'evidence-user/frame-0001.png',(750,410,1000,720),'IMG_8466 · 195,133 с')
note(axes[1],'Следующий подъём:\nдругая нога',(885,570),(772,435),'#80ddc2')
note(axes[1],'Перила скрывают низ ноги.\nКонтакт стопы не оценён.',(838,681),(770,640),'#d4dcec')
fig.text(.5,.025,'Ориентир: «колено поднимается, корпус остаётся спокойным». Это пробная подсказка, не диагноз.',ha='center',fontsize=12)
fig.savefig(OUT/'red-feedback.png',dpi=140,facecolor=fig.get_facecolor());plt.close(fig)

fig,axes=plt.subplots(2,2,figsize=(11,10.5));fig.subplots_adjust(top=.85,bottom=.11,left=.04,right=.96,wspace=.12,hspace=.21)
fig.suptitle('Белое поло: проверить повторяемость работы рук',fontsize=19,y=.975)
fig.text(.5,.922,'Слева и справа — разные половины своего цикла, с разными поднятыми ногами.',ha='center',fontsize=12,color='#b9c6d8')
fig.text(.5,.891,'Внутри каждого столбца показан повтор той же фазы. Анатомические стороны не переименованы.',ha='center',fontsize=11,color='#b9c6d8')
entries=[(5,84.333,(995,440,1200,710),(1105,510),(1007,461),'Передняя кисть\nближе к лицу'),
         (15,85.0,(915,440,1120,710),(999,542),(930,467),'Передняя кисть\nзаметно ниже'),
         (27,85.8,(815,440,1020,710),(928,519),(828,461),'Похожее положение\nв следующем цикле'),
         (39,86.6,(735,440,940,710),(815,534),(747,465),'Повтор другой\nполовины цикла')]
for ax,(idx,time,box,point,pos,text) in zip(axes.flat,entries):
    panel(ax,ROOT/f'8467-sequence/frame-{idx:04d}.jpg',box,f'IMG_8467 · {time:.3f} с')
    note(ax,text,point,pos)
fig.text(.5,.066,'Разная высота кистей видна; её причина и влияние на бег не установлены. Дальняя рука видна хуже.',ha='center',fontsize=11,color='#b9c6d8')
fig.text(.5,.028,'Пробный ориентир: «две руки — один спокойный ритм», без силового размахивания.',ha='center',fontsize=12)
fig.savefig(OUT/'white-feedback.png',dpi=140,facecolor=fig.get_facecolor());plt.close(fig)
print(OUT/'red-feedback.png');print(OUT/'white-feedback.png')
