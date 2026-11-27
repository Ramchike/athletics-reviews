import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const expectedHash = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
const model = fileURLToPath(new URL('./public/pose.task', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

const cached = await readFile(model).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
if (cached && digest(cached) === expectedHash) {
  console.log('Pose Landmarker Lite is ready.');
} else {
  const response = await fetch(source, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== expectedHash) throw new Error('Model SHA-256 does not match.');
  const temporary = `${model}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, model);
  } finally {
    await unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  console.log('Downloaded and verified Pose Landmarker Lite.');
}
