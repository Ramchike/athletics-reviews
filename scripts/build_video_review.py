#!/usr/bin/env python3
"""Build separate UTF-8 manual frame viewers; preserve source anatomy and side labels."""
import argparse
import base64
import html
import io
import json
from pathlib import Path

from PIL import Image

CONNECTIONS=[(11,12),(11,13),(13,15),(12,14),(14,16),(11,23),(12,24),(23,24),(23,25),(25,27),(24,26),(26,28),(27,29),(29,31),(28,30),(30,32)]
REFERENCES=[('Лайлс · A-skip','reference-A','full-v2'),('Лайлс · B-skip','reference-B-active','tracked-v2'),('Лайлс · C-skip','reference-C','full')]
SPECS={
 'red':[('Красный · подъёмы коленей · IMG_8466','red-8466-active','red-located-v4'),('Красный · проход влево · IMG_8468','red-8468','red-located'),('Красный · движения рук · IMG_8471','red-8471','tracked')],
 'white':[('Белое поло · подъёмы коленей · IMG_8467','8467-sequence','tracked-v2'),('Белое поло · IMG_8466','8466-sequence','tracked-v2'),('Белое поло · IMG_8468','8468-sequence','tracked-v2'),('Белое поло · движения рук · IMG_8471','8471-sequence','tracked-v2')]
}


def encode(image):
    buffer=io.BytesIO();image.save(buffer,format='JPEG',quality=92)
    return 'data:image/jpeg;base64,'+base64.b64encode(buffer.getvalue()).decode()


def dataset(root,label,folder,suffix,person):
    poses=json.loads((root/folder/f'pose-{suffix}'/'poses.json').read_text(encoding='utf-8'))
    frames=[]
    for index,f in enumerate(poses['frames']):
        # Keep every extracted frame, including frames where recognition failed.
        if folder=='red-8471' and f['pts_seconds']>88.4:continue
        if folder=='red-8468' and f['pts_seconds']>350.8:continue
        points=f['poses'][f['selected_candidate']]['pixels'] if f['selected_candidate'] is not None else []
        image=Image.open(root/folder/f['file']).convert('RGB')
        if f.get('rotation_applied'):image=image.rotate(f['rotation_applied'],expand=True)
        if folder.startswith('reference'):
            visible=[p for p in points if p[3]>=.7]
            if visible:
                box=[max(0,int(min(p[0] for p in visible)-45)),max(0,int(min(p[1] for p in visible)-45)),min(image.width,int(max(p[0] for p in visible)+45)),min(image.height,int(max(p[1] for p in visible)+45))]
            else:box=[0,0,image.width,image.height]
        else:box=f.get('crop_box') or [0,350,image.width,image.height]
        image=image.crop(tuple(box))
        coords=[[p[0]-box[0],p[1]-box[1],*p[2:]] for p in points]
        frames.append({'t':f['pts_seconds'],'image':encode(image),'w':image.width,'h':image.height,'points':coords,'sourceIndex':index,'sourceFile':f['file'],'detected':bool(points)})
    return {'label':label,'folder':folder,'person':person,'frames':frames}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,required=True);parser.add_argument('--person',choices=['red','white'],default='red')
    parser.add_argument('--out',type=Path);parser.add_argument('--config',type=Path,required=True)
    args=parser.parse_args();config=json.loads(args.config.read_text(encoding='utf-8'))[args.person]
    specs=SPECS[args.person]+REFERENCES
    # A manually selected additional sequence may be supplied without changing code.
    for s in config.get('extra_sequences',[]):specs.insert(len(SPECS[args.person]),tuple(s))
    data={'datasets':[dataset(args.root,*s,args.person if not s[1].startswith('reference') else 'reference') for s in specs],
          'connections':CONNECTIONS,'pairs':config.get('pairs',[]),'default':config['default']}
    payload=json.dumps(data,ensure_ascii=False,allow_nan=False).replace('<','\\u003c')
    observations=''.join('<li>'+html.escape(t)+'</li>' for t in config['observations'])
    title=html.escape(config['title']);intro=html.escape(config['intro'])
    coaching=config.get('coaching')
    feedback=''
    if coaching:
        paragraphs=''.join('<p>'+html.escape(t)+'</p>' for t in coaching['paragraphs'])
        feedback='<section id="simple-feedback"><h2 style="font-size:1.3rem">Что делать простыми словами</h2>'+paragraphs
        image_path=args.root/'simple-feedback'/f'{args.person}-feedback.png'
        image_data='data:image/png;base64,'+base64.b64encode(image_path.read_bytes()).decode()
        feedback+='<img style="width:100%;height:auto" src="'+image_data+'" alt="'+html.escape(coaching['image_alt'],quote=True)+'">'
        feedback+='<p class="muted">Общие ориентиры для A-skip: <a href="https://www.ucalgary.ca/shred-injuries/all-sports/soccer/a-skips">University of Calgary</a>, <a href="https://www.saptstrength.com/blog/2015/04/22/the-a-skip">SAPT</a>. По этим кадрам влияние на время спринта не установлено.</p></section>'
    document=TEMPLATE.replace('TITLE',title).replace('INTRO',intro).replace('OBSERVATIONS',observations).replace('LIMITATIONS',html.escape(config['limitations'])).replace('FEEDBACK',feedback).replace('PAYLOAD',payload)
    output=args.out or args.root/('review.html' if args.person=='red' else 'review-white.html')
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(document,encoding='utf-8')
    print(json.dumps({'path':str(output),'bytes':output.stat().st_size,'frames':{d['folder']:len(d['frames']) for d in data['datasets']}},ensure_ascii=False))


TEMPLATE='''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Отдельный ручной разбор скипов с покадровым просмотром"><title>TITLE</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;margin:auto;padding:24px;max-width:1250px;background:#101823;color:#edf3fa}h1{font-size:1.8rem;margin:0 0 8px}p{max-width:1000px}a{color:#80ddc2}button,select{font:inherit;background:#26364b;color:#fff;border:1px solid #697b91;border-radius:8px;padding:10px;min-height:44px}button{cursor:pointer}select{width:100%}.panels{display:grid;grid-template-columns:1fr 1fr;gap:18px}.panel,section,details{background:#1b2737;border-radius:12px;padding:18px;margin:16px 0}canvas{width:100%;height:390px;background:#0b111b;display:block;margin:12px 0}input[type=range]{width:100%;min-height:32px}.controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.controls label{display:flex;gap:8px;align-items:center}.metadata{font-size:.9rem;color:#b9c6d8;min-height:3rem}.candidate{border-left:4px solid #efbf61}#pairNote{margin:10px 0 0}#pairButtons{display:flex;gap:10px;flex-wrap:wrap}li{margin:10px 0}.badge{font-size:.9rem;color:#efbf61}.muted{color:#b9c6d8}details p{margin-bottom:0}@media(max-width:760px){body{padding:14px}.panels{grid-template-columns:1fr}canvas{height:350px}.panel{margin:0}h1{font-size:1.5rem}}@media(min-width:761px){.panel{margin:0}}button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #80ddc2;outline-offset:2px}
</style></head><body><h1>TITLE</h1><p>INTRO</p>
<div class="controls"><label><input id="skeleton" type="checkbox"> Суставы модели</label><label>Видимость <output id="thresholdValue">0.70</output></label><input style="max-width:170px" aria-label="Порог видимости суставов" id="threshold" type="range" min="0.5" max="0.95" step="0.05" value="0.7"></div>
<div class="panels"><div class="panel"><label for="sel0">Участник</label><select id="sel0"></select><canvas aria-label="Кадр участника" id="canvas0" width="600" height="470"></canvas><input aria-label="Кадр участника" id="range0" type="range" min="0" value="0"><div class="controls"><button id="prev0">Предыдущий</button><button id="next0">Следующий</button></div><p class="metadata" id="info0"></p></div>
<div class="panel"><label for="sel1">Демонстрация</label><select id="sel1"></select><canvas aria-label="Кадр демонстрации" id="canvas1" width="600" height="470"></canvas><input aria-label="Кадр демонстрации" id="range1" type="range" min="0" value="0"><div class="controls"><button id="prev1">Предыдущий</button><button id="next1">Следующий</button></div><p class="metadata" id="info1"></p></div></div>
FEEDBACK
<section class="candidate"><h2 style="font-size:1.15rem;margin:0 0 12px">Ручной выбор фазы</h2><div id="pairButtons"></div><p id="pairNote"></p><p class="muted">Левую и правую сторону не меняем местами. Изображения не отражены. Сходный подъём колена ещё не подтверждает совпадение ноги, руки и всего упражнения.</p></section>
<section><h2 style="font-size:1.3rem">Наблюдения по этому участнику</h2><ul>OBSERVATIONS</ul><p class="muted">LIMITATIONS</p></section>
<details><summary>Как читать кадры и разметку</summary><p>Все извлечённые кадры выбранного фрагмента идут подряд, включая нераспознанные. Шаг обычно около 0,067 секунды файла: сохранено примерно 15 кадров на секунду, а не каждый исходный кадр. Метки времени не подтверждают реальную скорость движения. Суставы — непроверенные подсказки модели; скрытая за перилами точка не становится видимой от наложения линии. По этим изображениям нельзя точно измерить контакт стопы или назначить исправление техники.</p><p>Для экрана используются вырезки из сохранённых кадров; исходные файлы не изменены. Нет итогового балла и выводов о силе, травмах или мышечной активации.</p></details>
<p class="muted">Ручная проверка: 4 октября 2026 года, Sol, Astra, Luna и основной ассистент. Дата съёмки неизвестна. <a href="https://www.youtube.com/watch?v=xiYTMBLqp8c" target="_blank" rel="noopener">Видео демонстраций Лайлса</a> · A: 1:34–1:37, B: 2:36–2:40, C: 3:06–3:11.</p>
<script id="data" type="application/json">PAYLOAD</script><script>
const data=JSON.parse(document.getElementById('data').textContent),get=id=>document.getElementById(id);let generation=[0,0],activePair=null;
function datasetIndex(folder){return data.datasets.findIndex(d=>d.folder===folder)}
function invalidatePair(){activePair=null;get('pairNote').textContent='Кадры выбраны вручную. Совпадение анатомической стороны и положения рук для этой комбинации не подтверждено.'}
function setFrame(side,folder,time){const sel=get('sel'+side),r=get('range'+side);sel.value=datasetIndex(folder);const frames=data.datasets[+sel.value].frames;r.max=frames.length-1;r.value=frames.reduce((best,f,i)=>Math.abs(f.t-time)<Math.abs(frames[best].t-time)?i:best,0);draw(side)}
function applyPair(p){activePair=p;setFrame(0,p.student_folder,p.student_time);setFrame(1,p.reference_folder,p.reference_time);get('pairNote').textContent=p.note}
for(let side=0;side<2;side++){
 const sel=get('sel'+side),r=get('range'+side);
 data.datasets.forEach((d,i)=>{if((side===1)!==(d.person==='reference'))return;const o=document.createElement('option');o.value=i;o.textContent=d.label;sel.append(o)});
 sel.onchange=()=>{r.max=data.datasets[+sel.value].frames.length-1;r.value=0;invalidatePair();draw(side)};
 r.oninput=()=>{invalidatePair();draw(side)};
 for(const [id,step]of [['prev',-1],['next',1]])get(id+side).onclick=()=>{r.value=Math.min(+r.max,Math.max(0,+r.value+step));invalidatePair();draw(side)};
}
function draw(side){
 const d=data.datasets[+get('sel'+side).value],f=d.frames[+get('range'+side).value],c=get('canvas'+side),ctx=c.getContext('2d'),version=++generation[side],th=+get('threshold').value;
 const im=new Image();im.onload=()=>{if(version!==generation[side])return;ctx.clearRect(0,0,c.width,c.height);const scale=Math.min(c.width/f.w,c.height/f.h),x=(c.width-f.w*scale)/2,y=(c.height-f.h*scale)/2;ctx.drawImage(im,x,y,f.w*scale,f.h*scale);
 if(get('skeleton').checked&&f.points.length){ctx.strokeStyle='#48e7ba';ctx.fillStyle='#ffe278';ctx.lineWidth=2;for(const[a,b]of data.connections){const p=f.points[a],q=f.points[b];if(p[3]<th||q[3]<th)continue;ctx.beginPath();ctx.moveTo(x+p[0]*scale,y+p[1]*scale);ctx.lineTo(x+q[0]*scale,y+q[1]*scale);ctx.stroke()}for(let j=11;j<33;j++){const p=f.points[j];if(p[3]<th)continue;ctx.beginPath();ctx.arc(x+p[0]*scale,y+p[1]*scale,3,0,2*Math.PI);ctx.fill()}}
 get('info'+side).textContent=f.t.toFixed(3)+' с файла · '+(+get('range'+side).value+1)+'/'+d.frames.length+' · '+(f.detected?'есть подсказка модели':'модель не распознала участника');};im.onerror=()=>{get('info'+side).textContent='Кадр не загрузился; переключите кадр или обновите страницу.'};im.src=f.image;
}
for(const id of ['skeleton','threshold'])get(id).oninput=()=>{get('thresholdValue').textContent=(+get('threshold').value).toFixed(2);draw(0);draw(1)};
for(const p of data.pairs){const b=document.createElement('button');b.textContent=p.label;b.onclick=()=>applyPair(p);get('pairButtons').append(b)}
applyPair(data.default);
</script></body></html>'''
if __name__=='__main__':main()
