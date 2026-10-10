// Collects repository records into one JSON for the site and copies own frames into public/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const json = file => JSON.parse(read(file));

const review = json('reviews/cards.json');
const programme = json('plans/programme.json');
const assets = path.join(ROOT, 'reviews/assets');
const CLIPS = 'reviews/assets/program-2026-10-05/';

for (const card of review.cards) {
  for (const person of Object.values(card.people)) {
    for (const [file] of person.photos) {
      if (!fs.existsSync(path.join(ROOT, review.assets, file))) throw new Error(`Missing photo: ${file}`);
    }
  }
}

const ids = new Set(programme.exercises.map(exercise => exercise.id));
const used = [
  ...programme.stages.flatMap(stage => stage.train),
  ...programme.sessions.flatMap(session => session.blocks.flatMap(block => block.exercises)),
];
for (const id of used) if (!ids.has(id)) throw new Error(`Unknown exercise: ${id}`);
for (const exercise of programme.exercises) {
  for (const clip of Object.values(exercise.own ?? {})) {
    for (const ext of ['.mp4', '.jpg']) {
      if (!fs.existsSync(path.join(ROOT, CLIPS, clip + ext))) throw new Error(`Missing clip: ${clip}${ext}`);
    }
  }
}

const data = {
  review,
  programme,
  clips: CLIPS,
  docs: { technique: read('docs/technique.md') },
};
fs.writeFileSync(path.join(ROOT, 'website/src/project-data.json'), JSON.stringify(data) + '\n');

const publicAssets = path.join(ROOT, 'website/public/reviews/assets');
fs.rmSync(publicAssets, { recursive: true, force: true });
fs.cpSync(assets, publicAssets, { recursive: true, filter: source => !source.endsWith('.json') });
console.log(`Site data: ${programme.stages.length} stages, ${programme.exercises.length} exercises, ${review.cards.length} review cards.`);
