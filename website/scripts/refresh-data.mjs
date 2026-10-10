// Collects repository records into one JSON for the site and copies own frames into public/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const json = file => JSON.parse(read(file));

const review = json('reviews/cards.json');
const program = json('plans/two-hour-session.json');
const assets = path.join(ROOT, 'reviews/assets');

for (const card of review.cards) {
  for (const person of Object.values(card.people)) {
    for (const [file] of person.photos) {
      if (!fs.existsSync(path.join(ROOT, review.assets, file))) throw new Error(`Missing photo: ${file}`);
    }
  }
}

const data = {
  review,
  program,
  docs: {
    technique: read('docs/technique.md'),
    roadmap: read('docs/roadmap.md'),
    feedback: read('docs/feedback.md'),
  },
};
fs.writeFileSync(path.join(ROOT, 'website/src/project-data.json'), JSON.stringify(data) + '\n');

const publicAssets = path.join(ROOT, 'website/public/reviews/assets');
fs.rmSync(publicAssets, { recursive: true, force: true });
fs.cpSync(assets, publicAssets, { recursive: true, filter: source => !source.endsWith('.json') });
console.log(`Site data: ${review.cards.length} review cards, ${program.exercises.length} exercises.`);
