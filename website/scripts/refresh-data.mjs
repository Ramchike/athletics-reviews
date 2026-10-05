// Read the repository root: no media originals or materials cwd are required.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const labels={ 'athletics-assistant':'Ассистент проекта','sprint-video-review':'Видео и реальные углы','sprint-technique-learning':'Обучение технике','sprint-load-planning':'Объём и восстановление','coaching-assumptions':'Проверка предположений','athletics-progress-map':'Карта освоения','scientific-literature-review':'Поиск научных работ','scientific-critical-thinking':'Оценка доказательств' };
function table(text,heading) { const section=text.split(heading)[1]?.split('\n## ')[0]; if(!section)throw new Error(`Missing table: ${heading}`);return section.split('\n').filter(l=>l.startsWith('|')).map(l=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim())).filter(row=>!row.every(c=>/^[-: ]+$/.test(c))).slice(1); }
function files(directory) { return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)).map(f=>`${entry.name}/${f}`):[entry.name]); }
function dimensions(file) {
 const buffer=fs.readFileSync(file); const ext=path.extname(file);
 if(ext==='.png')return [buffer.readUInt32BE(16),buffer.readUInt32BE(20)];
 if(ext==='.gif')return [buffer.readUInt16LE(6),buffer.readUInt16LE(8)];
 if(ext==='.svg'){const match=buffer.toString().match(/viewBox="\d+ \d+ (\d+) (\d+)"/);if(match)return match.slice(1).map(Number);}
 if(ext==='.jpg'||ext==='.jpeg'){
  for(let i=2;i<buffer.length-9;){if(buffer[i]!==0xff){i++;continue;}const type=buffer[i+1];if(type===0xd8||type===0xd9){i+=2;continue;}const length=buffer.readUInt16BE(i+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(type))return [buffer.readUInt16BE(i+7),buffer.readUInt16BE(i+5)];if(length<2)break;i+=length+2;}
 }
 throw new Error(`Cannot determine dimensions: ${file}`);
}
const data=JSON.parse(read('reviews/start-cards.json'));
const rows=table(read('docs/skill-audit.md'),'## Решение для каждого направления');
data.skills=Object.entries(labels).map(([id,title])=>{
 const directory=path.join(ROOT,'.agents/skills',id);
 const source=fs.readFileSync(path.join(directory,'SKILL.md'),'utf8');
 const row=rows.find(r=>r[0].includes(id)||(id==='scientific-literature-review'&&r[0].includes('литературой'))||(id==='scientific-critical-thinking'&&r[0].includes('доказательств')));if(!row)throw new Error(`Missing audit: ${id}`);
 const provenance=fs.existsSync(path.join(directory,'PROVENANCE.md'))?fs.readFileSync(path.join(directory,'PROVENANCE.md'),'utf8'):'';
 const license=fs.existsSync(path.join(directory,'LICENSE.txt'));
 return {id,title,kind:provenance?'imported':'local',candidates:row[1],decision:row[2],upstream:provenance.match(/https:\/\/github\.com\/\S+/)?.[0]||null,license:license?'MIT':'Местные инструкции проекта',licenseFile:license?`.agents/skills/${id}/LICENSE.txt`:null,hash:crypto.createHash('sha256').update(source).digest('hex'),instructions:source,provenance,files:files(directory)};
});
data.map=table(read('docs/athletics-map.md'),'# Карта освоения 60 и 100 м').map(([area,ramir,misha,next])=>({area,ramir,misha,next}));
data.tasks=table(read('docs/start-task-status.md'),'# Запросы о стартах: результат и незакрытые проверки').map(([request,done,next])=>({request,done,next}));
data.assumptions=table(read('docs/assumptions.md'),'# Предположения, которые проверяем').map(([idea,finding,check])=>({idea,finding,check}));
data.documents=Object.fromEntries([['audit','skill-audit'],['sources','start-sources'],['research','start-research'],['pipeline','start-analysis-pipeline']].map(([name,file])=>[name,read(`docs/${file}.md`)]));data.documents.plan=read('plans/next-start-session.md');
data.dimensions={};
for(const card of data.cards){for(const review of Object.values(card.people))for(const photo of review.photos)for(const asset of [photo.file,photo.full].filter(Boolean))data.dimensions[asset]=dimensions(path.join(ROOT,'reviews/assets/starts-2026-10-04',asset));data.dimensions[card.target]=dimensions(path.join(ROOT,'reviews/assets/starts-2026-10-04',card.target));}
fs.writeFileSync(path.join(ROOT,'website/src/project-data.json'),JSON.stringify(data,null,2)+'\n');
console.log(`Read repository root: ${data.skills.length} skills, ${data.cards.length} review cards, ${data.tasks.length} original tasks.`);
