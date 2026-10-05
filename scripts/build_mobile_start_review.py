#!/usr/bin/env python3
"""Export selected own frames and a phone-readable static review to an existing repo.

Requires explicit publication authorization; never copies media/ wholesale.
Dependencies: Pillow and Python-Markdown. Does not push or change repository access.
"""
import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil

import markdown
from PIL import Image, ImageDraw, ImageFont

from annotate_start_frame import render


ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / 'media/start-review-2026-10-04'
ASSETS = ROOT / 'reviews/assets/starts-2026-10-04'
REPORTS = [ROOT / 'reviews/2026-10-04-starts.md'] + [
    ROOT / f'reviews/athlete-{who}/2026-10-04-starts.md' for who in ('a', 'b')]

STYLE = """
:root{color-scheme:dark;--bg:#101820;--card:#18252f;--ink:#edf4f6;--muted:#b7c8d0;--accent:#8be6c7}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.65 system-ui,sans-serif}
main,header,footer{max-width:820px;margin:auto;padding:20px}header{padding-bottom:8px}
header a,nav a,.filter{display:inline-block;padding:10px 12px;margin:4px 4px 4px 0;border-radius:10px;border:1px solid #46616f}
a{color:var(--accent);text-underline-offset:3px;overflow-wrap:anywhere}h1{font-size:clamp(27px,5vw,38px);line-height:1.2}
h2{font-size:25px;line-height:1.35;margin:0 0 20px}h3{font-size:21px}.card{background:var(--card);border:1px solid #314855;border-radius:16px;padding:22px;margin:26px 0}
img{display:block;width:100%;max-width:100%;height:auto;margin:12px auto;border-radius:8px}p{margin:16px 0}
details{padding:12px;border:1px solid #46616f;border-radius:10px;margin:12px 0}summary{cursor:pointer;font-weight:600;min-height:28px}
table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse;font-size:16px}td,th{padding:10px;border:1px solid #46616f;min-width:130px;vertical-align:top}
pre{overflow:auto;max-width:100%;padding:14px;background:#091219}code{font-size:.9em;overflow-wrap:anywhere}blockquote{border-left:3px solid var(--accent);margin:16px 0;padding-left:16px}
.note,footer{color:var(--muted);font-size:15px}.filter{background:transparent;color:var(--ink);font:inherit;cursor:pointer}.filter[aria-pressed=true]{background:#285446}
[hidden]{display:none!important}:focus-visible{outline:3px solid #ffcc67;outline-offset:3px}
@media(max-width:480px){main,header,footer{padding:14px}.card{padding:16px;margin:20px 0}h2{font-size:23px}}
"""


def svg(title, drawing, lines, height=390):
    notes = ''.join(f'<text x="24" y="{height-72+i*30}">{html.escape(line)}</text>' for i,line in enumerate(lines))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 {height}" role="img" aria-label="{html.escape(title)}">
<rect width="540" height="{height}" rx="16" fill="#10242e"/>
<style>text{{font:22px sans-serif;fill:#eaf6f5}}.body{{fill:none;stroke:#ffcf6b;stroke-width:11;stroke-linecap:round}}.leg{{fill:none;stroke:#89d9ff;stroke-width:9;stroke-linecap:round}}.alt{{fill:none;stroke:#efad92;stroke-width:9;stroke-linecap:round}}.ground{{stroke:#91a5ad;stroke-width:3}}</style>
<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6" fill="#8be6c7"/></marker></defs>
<text x="24" y="34">Условная схема — цель действия</text>{drawing}{notes}</svg>'''


def prepare_assets():
    ASSETS.mkdir(parents=True, exist_ok=True)
    previous=ASSETS/'provenance.json'
    records=json.loads(previous.read_text()).get('records',[]) if previous.exists() else []
    for report in REPORTS:
        text = report.read_text()
        def substitute(match):
            source = (report.parent / match.group(1)).resolve()
            if not source.is_relative_to(MEDIA) or source.suffix.lower() not in ('.png','.jpg','.jpeg'):
                raise ValueError(f'Unexpected selected asset in {report.name}')
            relative = source.relative_to(MEDIA)
            target = ASSETS / relative
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(source,target)
            records.append({'source': str(source.relative_to(ROOT)), 'asset': str(relative),
                            'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'operation':'byte-identical copy'})
            return '(' + Path(os.path.relpath(target,report.parent)).as_posix() + ')'
        text = re.sub(r'\(([^)]+media/start-review-2026-10-04/[^)]+)\)',substitute,text)
        report.write_text(text)
    named_metadata={}
    for asset in (ASSETS/'annotations').glob('*.png'):
        metadata=MEDIA/'annotations'/asset.with_suffix('.json').name
        if not metadata.exists(): continue
        spec=json.loads(metadata.read_text())
        spec['title']=spec['title'].replace('Красный','Рамир').replace('Друг','Миша')
        # Keep exact original points; only the participant caption changes.
        identity={key:spec[key] for key in ('title','points','segments','angles','crop','notes') if key in spec}
        identity['source_sha256']=hashlib.sha256(Path(spec['source']).read_bytes()).hexdigest()
        digest=hashlib.sha256(json.dumps(identity,sort_keys=True,ensure_ascii=False).encode()).hexdigest()[:12]
        output=MEDIA/'annotations'/f'names-{digest}'/asset.name
        spec['output']=str(output)
        if not output.exists(): render(spec,ROOT/'media')
        shutil.copyfile(output,asset)
        named_metadata[asset.name]=output.with_suffix('.json')
        records.append({'asset':str(asset.relative_to(ASSETS)),
                        'source':str(Path(spec['source']).relative_to(ROOT)),
                        'source_sha256':hashlib.sha256(Path(spec['source']).read_bytes()).hexdigest(),
                        'sha256':hashlib.sha256(asset.read_bytes()).hexdigest(),
                        'operation':'same manual source points; participant caption renamed only'})
    montage=ASSETS/'red-start-comparison.jpg'
    archived=MEDIA/'publication-caption-originals'/montage.name
    archived.parent.mkdir(exist_ok=True)
    if not archived.exists(): shutil.copyfile(montage,archived)
    with Image.open(archived) as image:
        canvas=image.convert('RGB');draw=ImageDraw.Draw(canvas)
        font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22)
        for y,label in [(28,'Рамир — Falling / выход без руки'),(528,'Рамир — выбранная низкая попытка')]:
            draw.rectangle((0,y,1499,y+45),fill='#141923')
            draw.text((18,y+7),label,font=font,fill='white')
        canvas.save(montage,quality=95)
    records.append({'asset':montage.name,'source':str(archived.relative_to(ROOT)),
                    'source_sha256':hashlib.sha256(archived.read_bytes()).hexdigest(),
                    'operation':'participant captions renamed in blank panel; JPEG re-encoded'})
    for who,folder,index in [('red','3579-wall-motion-visible',8),('white','3580-wall-motion-visible',13)]:
        source=MEDIA/folder/f'{index:04d}.jpg'
        shutil.copyfile(source,ASSETS/f'{who}-wall-two-feet.jpg')
        records.append({'asset':f'{who}-wall-two-feet.jpg','source':str(source.relative_to(ROOT)),
                        'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'operation':'byte-identical own crop copy'})
        sources=[MEDIA/folder/f'{i:04d}.jpg' for i in range(24)]
        frames=[]
        for path in sources:
            with Image.open(path) as image: frames.append(image.convert('RGB'))
        frames[0].save(ASSETS/f'{who}-wall-motion.gif',save_all=True,append_images=frames[1:],duration=100,loop=0)
        records.append({'asset':f'{who}-wall-motion.gif','sources':[str(p.relative_to(ROOT)) for p in sources],
                        'operation':'existing real crops assembled; 100 ms/file-sample, physical tempo unknown'})
    for name,source,crop in [
        ('red-pushup-crop.png',MEDIA/'3588-pushup-upright/frame-0040.png',(1410,418,1595,552)),
        ('white-ready-crop.png',MEDIA/'3589-white-exit-actual/frame-0000.png',(1650,270,1920,475)),
        ('white-pushup-crop.png',MEDIA/'3588-pushup-upright/frame-0151.png',(1280,430,1540,575))]:
        with Image.open(source) as image: image.crop(crop).save(ASSETS/name)
        records.append({'asset':name,'source':str(source.relative_to(ROOT)),'crop':crop,
                        'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'operation':'crop only; no reflection or anatomy changes'})
    drawings={
        'back-axis.svg':'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 650" role="img" aria-label="Наклон туловища и форма позвоночника: разные проверки">
<rect width="540" height="650" rx="16" fill="#10242e"/>
<style>text{font:22px sans-serif;fill:#eaf6f5}.axis{stroke:#89d9ff;stroke-width:7;fill:none}.curve{stroke:#ffcf6b;stroke-width:7;fill:none}</style>
<text x="24" y="35">Условная схема, не ваш позвоночник</text>
<text x="24" y="80">1. Наклон: линия плечо–таз</text>
<path class="axis" d="M110 270 L220 110"/><circle cx="110" cy="270" r="7" fill="white"/><circle cx="220" cy="110" r="7" fill="white"/>
<path d="M110 270 L300 270" stroke="#b7c8d0" stroke-width="2"/>
<text x="278" y="155">Две точки</text><text x="278" y="190">показывают</text><text x="278" y="225">ориентацию.</text>
<text x="24" y="330">2. Форма: несколько отделов</text>
<path class="axis" d="M110 520 L220 360" stroke-dasharray="8 8"/>
<path class="curve" d="M110 520 C172 509 111 452 172 425 S232 404 220 360"/>
<text x="278" y="400">Изгибы нельзя</text><text x="278" y="435">измерить одной</text><text x="278" y="470">прямой линией.</text>
<text x="24" y="575">Жёлтая кривая — объяснение различия.</text>
<text x="24" y="610">Она не задаёт норму и угол поясницы.</text></svg>''',
        'wall-target.svg':svg('Wall: линия тела и колено вперёд',
            '<line class="ground" x1="32" y1="278" x2="510" y2="278"/><line class="ground" x1="465" y1="70" x2="465" y2="278"/>'
            '<path class="body" d="M160 273 L247 172 L327 80"/><circle cx="344" cy="60" r="18" fill="#ffcf6b"/>'
            '<path class="leg" d="M247 172 L310 228 L270 270 L294 270"/><path class="body" d="M325 82 L465 112"/>'
            '<line x1="316" y1="197" x2="405" y2="197" stroke="#8be6c7" stroke-width="5" marker-end="url(#arrow)"/>',
            ['Пояс остаётся на линии тела.','Колено вперёд, без сжатия к животу.']),
        'march-target.svg':svg('March: медленный подъём с фиксацией',
            '<path class="body" d="M125 274 L190 160 L247 80"/><path class="leg" d="M190 160 L250 205 L218 263"/>'
            '<text x="285" y="105">Поднял</text><text x="285" y="160">Удержал 1–2 с</text><text x="285" y="215">Вернул</text>'
            '<line x1="190" y1="160" x2="440" y2="160" stroke="#8be6c7" stroke-width="2" stroke-dasharray="7 7"/>',
            ['Нога меняет положение.','Корпус остаётся собранным.']),
        'switch-target.svg':svg('Switch: быстрая смена и новая фиксация',
            '<path class="body" d="M83 268 L140 165 L185 90"/><path class="leg" d="M140 165 L190 214 L160 265"/>'
            '<path class="body" d="M348 165 L393 90"/><path class="leg" d="M348 165 L291 268"/><path class="alt" d="M348 165 L399 214 L369 265"/>'
            '<line x1="205" y1="155" x2="285" y2="155" stroke="#8be6c7" stroke-width="5" marker-end="url(#arrow)"/>'
            '<text x="27" y="64">Одна нога сверху</text><text x="278" y="64">Другая сверху</text>',
            ['Сама смена — быстрая.','Новую позу удержать 1–2 с.']),
        'falling-target.svg':svg('Falling: цельный наклон с переходом в движение',
            '<line class="ground" x1="20" y1="276" x2="510" y2="276"/>'
            '<path class="body" d="M105 270 L105 170 L105 76"/><circle cx="105" cy="55" r="17" fill="#ffcf6b"/>'
            '<path class="body" d="M300 270 L350 172 L393 85"/><circle cx="405" cy="64" r="17" fill="#ffcf6b"/>'
            '<line x1="180" y1="155" x2="275" y2="155" stroke="#8be6c7" stroke-width="5" marker-end="url(#arrow)"/>',
            ['Наклон всей линии от опоры.','Затем шаг и разгон; колени живые.']),
        'forward-target.svg':svg('Ускорение: тело вперёд, действие на дорожку назад',
            '<line class="ground" x1="20" y1="273" x2="510" y2="273"/>'
            '<path class="body" d="M260 172 L220 90"/><circle cx="205" cy="70" r="18" fill="#ffcf6b"/>'
            '<path class="leg" d="M260 172 L315 220 L372 269"/><path class="alt" d="M260 172 L225 212 L252 250"/>'
            '<line x1="195" y1="150" x2="74" y2="150" stroke="#8be6c7" stroke-width="5" marker-end="url(#arrow)"/>'
            '<line x1="370" y1="291" x2="475" y2="291" stroke="#8be6c7" stroke-width="5" marker-end="url(#arrow)"/>',
            ['Стрелки показывают задачу.','Место посадки стопы не назначено.'],height=410)
    }
    for name,body in drawings.items(): (ASSETS/name).write_text(body)
    mobile=ASSETS/'mobile';mobile.mkdir(exist_ok=True)
    for name in ('red-wall','white-wall','red-contact-1','red-contact-2','red-low-contact-2','white-contact-2'):
        source=ASSETS/'annotations'/f'{name}.png'
        data=json.loads((MEDIA/'annotations'/f'{name}.json').read_text())
        x0,y0,x1,y1=data['crop'];factor=min(2,1000/(x1-x0))
        crop=(0,0,round((x1-x0)*factor),round((y1-y0)*factor))
        with Image.open(source) as image:image.crop(crop).save(mobile/f'{name}.png')
        records.append({'asset':f'mobile/{name}.png','source_asset':f'annotations/{name}.png',
                        'crop':crop,'operation':'remove text panel and blank margin only; annotated photo pixels unchanged'})
    # Deliberately excludes signed source URLs, absolute machine paths and service manifests.
    records=list({record['asset']:record for record in records}.values())
    (ASSETS/'provenance.json').write_text(json.dumps({'records':records,'schematics':'original illustrative SVGs; not measured ideal poses'},ensure_ascii=False,indent=2)+'\n')
    measurements=[]
    for image in (ASSETS/'annotations').glob('*.png'):
        metadata=named_metadata.get(image.name,MEDIA/'annotations'/image.with_suffix('.json').name)
        if not metadata.exists():continue
        record=json.loads(metadata.read_text())
        record['source']=str(Path(record['source']).relative_to(ROOT))
        record['output']=str(image.relative_to(ROOT))
        measurements.append(record)
    (ASSETS/'measurements.json').write_text(json.dumps(measurements,ensure_ascii=False,indent=2)+'\n')


def page(title,body,home,filters=False):
    if filters:
        body=re.sub(r'<p><a id="([^"]+)"></a></p>\s*<h2[^>]*>',lambda m:f'<h2 id="{m.group(1)}">',body)
        chunks=re.split(r'(?=<h2\b)',body)
        body=chunks[0]+''.join('<section class="card" data-person="'+('red' if 'id="red-start"' in chunk[:150] else 'white' if 'id="white-start"' in chunk[:150] else 'both')+'">'+chunk+'</section>' for chunk in chunks[1:])
    controls='<nav aria-label="Участник"><button class="filter" data-filter="all" aria-pressed="true">Все</button><button class="filter" data-filter="red" aria-pressed="false">Рамир</button><button class="filter" data-filter="white" aria-pressed="false">Миша</button></nav>' if filters else ''
    script='''<script>document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{const who=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('[data-person]').forEach(card=>card.hidden=who!=='all'&&card.dataset.person!=='both'&&card.dataset.person!==who)}));</script>''' if filters else ''
    return f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title><style>{STYLE}</style></head><body><header><a href="{home}">Все разборы</a><a href="{home}starts/">Старт: карточки</a><a href="https://github.com/Ramchike/athletics-reviews">GitHub</a>{controls}</header><main>{body}</main><footer>Разбор от 4 октября 2026; объяснения обновлены 5 октября. Дата занятия и замедление неизвестны. Кадры — наблюдения; схемы — объяснения и цели пробных действий.</footer>{script}</body></html>'''


def decorate_images(body,base):
    def decorate(match):
        attributes=match.group(1).rstrip().removesuffix('/').rstrip()
        url=html.unescape(match.group(2));source=(base/url).resolve()
        dimensions=''
        if source.exists():
            if source.suffix=='.svg':
                box=re.search(r'viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"',source.read_text())
                if box:
                    width,height=round(float(box.group(1))),round(float(box.group(2)))
                    dimensions=f' width="{width}" height="{height}" style="aspect-ratio:{width}/{height}"'
            else:
                with Image.open(source) as image:dimensions=f' width="{image.width}" height="{image.height}" style="aspect-ratio:{image.width}/{image.height}"'
        return f'<a href="{html.escape(url,quote=True)}"><img loading="lazy"{dimensions} {attributes}></a>'
    return re.sub(r'<img\b([^>]*src="([^"]+)"[^>]*)>',decorate,body)


def build(public):
    if not (public/'.git').exists(): raise ValueError('Destination must be an existing publication checkout')
    prepare_assets()
    materials=public/'materials'
    for directory in ('docs','plans','reviews','athletes','sessions','templates','.agents/skills','scripts','tests'):
        for source in (ROOT/directory).rglob('*'):
            if not source.is_file() or '__pycache__' in source.parts: continue
            if source.suffix not in ('.md','.py','.json','.txt','.yaml','.yml','.svg','.png','.jpg','.jpeg','.gif') and source.name not in ('LICENSE',): continue
            target=materials/source.relative_to(ROOT)
            target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
    for filename in ('README.md','AGENTS.md','RESEARCH_REQUEST.md','requirements-video-analysis.txt','requirements-review-site.txt'):
        shutil.copyfile(ROOT/filename,materials/filename)
    for source in materials.rglob('*.md'):
        body=markdown.markdown(source.read_text(),extensions=['tables','fenced_code','toc','md_in_html'])
        def local_link(match):
            attr,url=match.group(1),html.unescape(match.group(2))
            if re.match(r'^[a-zA-Z][\w+.-]*:',url) or url.startswith('#'):return match.group(0)
            path,sep,fragment=url.partition('#')
            target=(source.parent/path).resolve()
            if not target.is_relative_to(public.resolve()) or not target.exists():
                if attr=='href': return 'data-local-archive="true" title="Местный архивный файл; основные разборы доступны через меню"'
                raise ValueError(f'Missing published image: {source.relative_to(public)} {path}')
            if path.endswith('.md'):path=path[:-3]+'.html'
            return f'{attr}="{html.escape(path+(sep+fragment if sep else ""),quote=True)}"'
        body=re.sub(r'(href|src)="([^"]*)"',local_link,body)
        body=decorate_images(body,source.parent)
        home=Path(os.path.relpath(public,source.parent)).as_posix()+'/'
        source.with_suffix('.html').write_text(page(source.stem,body,home))
    phone=materials/'reviews/2026-10-04-starts-phone.html'
    body=markdown.markdown((ROOT/'reviews/2026-10-04-starts-phone.md').read_text(),extensions=['tables','fenced_code','toc','md_in_html'])
    def relocate(match):
        attr,url=match.group(1),html.unescape(match.group(2))
        if re.match(r'^[a-zA-Z][\w+.-]*:',url) or url.startswith('#'):return match.group(0)
        if url.endswith('.md'):url=url[:-3]+'.html'
        return f'{attr}="../materials/reviews/{html.escape(url,quote=True)}"'
    body=re.sub(r'(href|src)="([^"]*)"',relocate,body)
    starts=public/'starts';starts.mkdir(exist_ok=True)
    body=decorate_images(body,starts)
    (starts/'index.html').write_text(page('Старт: ваши кадры и цели движения',body,'../',filters=True))
    landing='''<h1>Рамир и Миша: разборы</h1><p>Кадры, понятные цели движения и одна команда на повторение.</p><nav><a href="starts/">Новый разбор старта: как у нас → что пробуем</a><a href="materials/plans/next-start-session.html">Следующая тренировка</a><a href="materials/reviews/2026-10-04-starts.html">Полный разбор по 14 пунктам</a><a href="materials/reviews/athlete-a/2026-10-04-starts.html">Рамир</a><a href="materials/reviews/athlete-b/2026-10-04-starts.html">Миша</a><a href="materials/docs/athletics-map.html">Карта освоения</a><a href="materials/docs/start-sources.html">Исследования и видеореференсы</a><a href="materials/docs/skill-audit.html">Какие готовые навыки нашли</a></nav><h2>Предыдущий разбор СБУ</h2><nav><a href="red/">Рамир — прежние СБУ</a><a href="white/">Миша — прежние СБУ</a></nav><p class="note">Исходные тексты, планы и навыки также доступны в папке materials на GitHub. Публичное размещение разрешено пользователем.</p>'''
    (public/'index.html').write_text(page('Ваши разборы тренировок',landing,'./'))
    (public/'README.md').write_text('# Разборы тренировок\n\n[Открыть на телефоне](https://ramchike.github.io/athletics-reviews/) · [Текущие карточки старта](https://ramchike.github.io/athletics-reviews/starts/)\n\nВ [materials](materials/README.md) опубликованы отчёты, планы, исследования и навыки. У каждой основной технической команды есть собственный кадр и пример целевого действия. Условные схемы не задают универсального эталона. Чужие видео представлены авторскими ссылками.\n\nПубличное размещение разрешено пользователем 4 октября 2026 года. Полные оригиналы и служебные сетевые manifest в эту публикацию не входят. Прежние страницы [Рамира](red/) и [Миши](white/) сохранены.\n')
    (public/'.nojekyll').touch()
    print(json.dumps({'html_pages':len(list(materials.rglob('*.html')))+2,'selected_assets':len(list(ASSETS.rglob('*')))},ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-root',type=Path,required=True)
    build(parser.parse_args().public_root.resolve())
