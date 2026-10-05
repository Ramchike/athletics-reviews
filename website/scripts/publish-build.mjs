import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dist=path.join(ROOT,'website/dist');
if(!fs.existsSync(path.join(dist,'index.html')))throw new Error('Build the site first.');
fs.cpSync(path.join(dist,'assets'),path.join(ROOT,'assets'),{recursive:true});
fs.copyFileSync(path.join(dist,'index.html'),path.join(ROOT,'index.html'));
for(const route of ['starts','skills','map','research','learning','tasks','plan','exercises']){fs.mkdirSync(path.join(ROOT,route),{recursive:true});fs.copyFileSync(path.join(dist,'index.html'),path.join(ROOT,route,'index.html'));}
fs.writeFileSync(path.join(ROOT,'.nojekyll'),'');
console.log('Published interface build into repository root; records, skills and legacy routes preserved.');
