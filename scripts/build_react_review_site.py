#!/usr/bin/env python3
"""Build the authorized React publication from project records into a checkout.

Keeps legacy reports and original route links. Copies owned selected assets only.
The visible skills bundle preserves imported references, licenses and provenance.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
from PIL import Image

from build_mobile_start_review import build as build_archive

ROOT=Path(__file__).resolve().parents[1]
WEBSITE=ROOT/'website'
ROUTES=('starts','skills','map','research','learning','tasks','plan','exercises')
SKILL_LABELS={
 'athletics-assistant':'Ассистент проекта',
 'sprint-video-review':'Видео и реальные углы',
 'sprint-technique-learning':'Обучение технике',
 'sprint-load-planning':'Объём и восстановление',
 'coaching-assumptions':'Проверка предположений',
 'athletics-progress-map':'Карта освоения',
 'scientific-literature-review':'Поиск научных работ',
 'scientific-critical-thinking':'Оценка доказательств',
}

def table(text,heading):
 section=text.split(heading,1)[1].split('\n## ',1)[0]
 rows=[]
 for line in section.splitlines():
  if not line.startswith('|'):continue
  cells=[x.strip() for x in line.strip().strip('|').split('|')]
  if all(re.fullmatch(r'[-: ]+',c) for c in cells):continue
  rows.append(cells)
 return rows[1:]


def export_data(public):
 data=json.loads((ROOT/'reviews/start-cards.json').read_text())
 audit=(ROOT/'docs/skill-audit.md').read_text()
 decision_rows=table(audit,'## Решение для каждого направления')
 data['skills']=[]
 bundle=public/'skills';bundle.mkdir(exist_ok=True)
 operational=public/'.agents/skills'
 operational.mkdir(parents=True,exist_ok=True)
 for skill,label in SKILL_LABELS.items():
  source=ROOT/'.agents/skills'/skill
  target=operational/skill
  if source.resolve()!=target.resolve():
   shutil.copytree(source,target,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
  row=next(r for r in decision_rows if skill in r[0] or (skill=='scientific-literature-review' and 'литературой' in r[0]) or (skill=='scientific-critical-thinking' and 'доказательств' in r[0]))
  provenance=source/'PROVENANCE.md'
  provenance_text=provenance.read_text() if provenance.exists() else ''
  upstream=re.search(r'https://github\.com/[^\s]+',provenance_text)
  license_file=source/'LICENSE.txt'
  data['skills'].append(dict(id=skill,title=label,kind='imported' if provenance.exists() else 'local',
    candidates=row[1],decision=row[2],upstream=upstream[0] if upstream else None,
    license='MIT' if license_file.exists() else 'Местные инструкции проекта',
    licenseFile=f'.agents/skills/{skill}/LICENSE.txt' if license_file.exists() else None,
    hash=hashlib.sha256((source/'SKILL.md').read_bytes()).hexdigest(),
    instructions=(source/'SKILL.md').read_text(),provenance=provenance_text,
    files=[str(p.relative_to(source)) for p in source.rglob('*') if p.is_file() and '__pycache__' not in p.parts]))
 data['map']=[dict(area=r[0],ramir=r[1],misha=r[2],next=r[3]) for r in table((ROOT/'docs/athletics-map.md').read_text(),'# Карта освоения 60 и 100 м')]
 data['tasks']=[dict(request=r[0],done=r[1],next=r[2]) for r in table((ROOT/'docs/start-task-status.md').read_text(),'# Запросы о стартах: результат и незакрытые проверки')]
 data['assumptions']=[dict(idea=r[0],finding=r[1],check=r[2]) for r in table((ROOT/'docs/assumptions.md').read_text(),'# Предположения, которые проверяем')]
 data['documents']={name:(ROOT/f'docs/{file}.md').read_text() for name,file in [('audit','skill-audit'),('sources','start-sources'),('research','start-research'),('pipeline','start-analysis-pipeline')]}
 data['documents']['plan']=(ROOT/'plans/next-start-session.md').read_text()
 data['dimensions']={}
 # Verify every displayed own asset, including full annotation links.
 for card in data['cards']:
  for person in card['people'].values():
   for image in person['photos']:
    for path in (image['file'],image.get('full')):
     if path and not (ROOT/'reviews/assets/starts-2026-10-04'/path).exists():raise ValueError(f'Missing own asset {path}')
     if path:
      with Image.open(ROOT/'reviews/assets/starts-2026-10-04'/path) as image:data['dimensions'][path]=[image.width,image.height]
  if not (ROOT/'reviews/assets/starts-2026-10-04'/card['target']).exists():raise ValueError('Missing target scheme')
  text=(ROOT/'reviews/assets/starts-2026-10-04'/card['target']).read_text()
  match=re.search(r'viewBox="\d+ \d+ (\d+) (\d+)"',text)
  if match:data['dimensions'][card['target']]=list(map(int,match.groups()))
 (WEBSITE/'src/project-data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
 (public/'skills/catalog.json').write_text(json.dumps([dict(id=s['id'],kind=s['kind'],sha256=s['hash'],upstream=s['upstream']) for s in data['skills']],ensure_ascii=False,indent=2)+'\n')
 lines=['# Навыки анализа и обучения спринту','',
 '[Открыть каталог на телефоне](https://ramchike.github.io/athletics-reviews/skills/)','',
    'Полные файлы восьми навыков находятся в корневой .agents/skills/: два готовых научных и шесть местных, включая координатор. Корневой AGENTS.md даёт агенту вход в проект; docs/, reviews/, plans/ и другие рабочие записи доступны по ссылкам из навыков. Справочники, лицензии и происхождение сохранены. materials/ оставлен для совместимости старых ссылок. Навык — инструкция ассистенту, не автоматический анализатор или аттестация тренера.','',
 '| Навык | Происхождение | Файл |','| --- | --- | --- |']
 lines += [f"| {s['title']} | {'Готовый, импортирован' if s['kind']=='imported' else 'Местный'} | [{s['id']}](../.agents/skills/{s['id']}/SKILL.md) |" for s in data['skills']]
 lines += ['','[Поиск кандидатов, решения, версии и ограничения](../docs/skill-audit.md). Открытие корня репозитория позволяет читать рабочие пути без перехода в materials/.']
 (bundle/'README.md').write_text('\n'.join(lines)+'\n')


def build(public):
 if not (public/'.git').is_dir():raise ValueError('Destination must be an existing publication checkout')
 build_archive(public)
 # Root is an operational training workspace; materials remains a legacy archive.
 for directory in ('docs','plans','reviews','athletes','sessions','templates','scripts','tests'):
  for source in (ROOT/directory).rglob('*'):
   if not source.is_file() or '__pycache__' in source.parts:continue
   if source.suffix not in ('.md','.py','.json','.txt','.yaml','.yml','.svg','.png','.jpg','.jpeg','.gif') and not (source.suffix=='.mp4' and source.is_relative_to(ROOT/'reviews/assets/program-2026-10-05')):continue
   target=public/source.relative_to(ROOT)
   target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
 for filename in ('AGENTS.md','.gitignore','RESEARCH_REQUEST.md','requirements-video-analysis.txt','requirements-review-site.txt'):
  shutil.copyfile(ROOT/filename,public/filename)
 export_data(public)
 # Keep old rendered skill pages, but avoid two active skills with the same name
 # when Codex starts from materials/: discovery also scans parent directories.
 for entry in (public/'materials/.agents/skills').glob('*/SKILL.md'):
  entry.rename(entry.with_name('ARCHIVED-SKILL.md'))
 (public/'materials/AGENTS.md').write_text('''# Архив публикации

Рабочая база теперь в корне этого репозитория. Прочитай `../AGENTS.md` и используй корневую `.agents/skills/`. Пути docs/, reviews/, plans/ разрешай от корня. Эта папка сохраняет старые адреса опубликованных отчётов; навыки здесь представлены архивными текстами и HTML, а не вторым активным набором.
''')
 archive_audit=public/'materials/docs/skill-audit.md'
 archive_audit.write_text(archive_audit.read_text().replace('../.agents/skills/','../../.agents/skills/'))
 subprocess.run(['npm','run','build'],cwd=WEBSITE,check=True)
 dist=WEBSITE/'dist'
 shutil.copytree(dist/'assets',public/'assets',dirs_exist_ok=True)
 # Root and direct route entry files prevent refresh/deep-link 404 on GitHub Pages.
 shutil.copyfile(dist/'index.html',public/'index.html')
 for route in ROUTES:
  target=public/route;target.mkdir(exist_ok=True)
  shutil.copyfile(dist/'index.html',target/'index.html')
 published_source=public/'website';published_source.mkdir(exist_ok=True)
 for file in WEBSITE.rglob('*'):
  if not file.is_file() or any(p in ('node_modules','dist') for p in file.relative_to(WEBSITE).parts):continue
  destination=published_source/file.relative_to(WEBSITE)
  destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,destination)
 (public/'README.md').write_text('''# Рамир и Миша: база обучения спринту

[Сайт для телефона](https://ramchike.github.io/athletics-reviews/) · [Программа на два часа](https://ramchike.github.io/athletics-reviews/plan/) · [Упражнения и видео](https://ramchike.github.io/athletics-reviews/exercises/) · [Разборы](https://ramchike.github.io/athletics-reviews/starts/) · [Навыки](https://ramchike.github.io/athletics-reviews/skills/) · [Карта освоения](https://ramchike.github.io/athletics-reviews/map/) · [Статус исходного запроса](https://ramchike.github.io/athletics-reviews/tasks/)

- [.agents/skills/](.agents/skills/): полные файлы восьми навыков, справочники, лицензии и происхождение. [Каталог](skills/README.md).
- [website/](website/README.md): исходный React-сайт и воспроизводимая сборка.
- [AGENTS.md](AGENTS.md): вход для агента из корня. Рабочие записи в docs/, reviews/, plans/, athletes/, sessions/.
- [materials/](materials/README.md): сохранённые адреса старой публикации.

Выбор спортсмена меняет его кадры и объяснения во всех упражнениях. Параметр athlete в ссылке сохраняет выбор. Схемы подписаны как условные, отсутствующий кадр не заменён чужим.

Исходный запрос не объявлен полностью закрытым: советская видеовыборка, непроверенные попытки, замеры и перенос в колодки отмечены отдельно. Файлы навыков не являются доказательством эффективности тренировки.

Публичная публикация разрешена пользователем. Оригиналы и служебные сетевые manifest не публикуются. [Прежние СБУ Рамира](red/) и [Миши](white/) сохранены. Без JavaScript доступны [обычные карточки](materials/reviews/2026-10-04-starts-phone.html).
''')
 (public/'.nojekyll').touch()
 print(json.dumps({'react_routes':len(ROUTES)+1,'skills':8,'cards':len(json.loads((ROOT/'reviews/start-cards.json').read_text())['cards'])}))


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--public-root',type=Path,required=True)
 build(parser.parse_args().public_root.resolve())
