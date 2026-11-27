import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clockSample, crossing, elapsedMs, torsoPoint } from '../public/timing.mjs';

test('clock samples separate path delay from server processing time', () => {
  assert.deepEqual(clockSample(100, 630, 642, 172), { offset: 500, rtt: 60 });
  assert.deepEqual(clockSample(100, 650, 662, 172), { offset: 520, rtt: 60 });
  assert.equal(elapsedMs(1600, 10_100), 8500);
});

test('finish interpolates in either direction and rejects gaps and reverse motion', () => {
  assert.equal(crossing({ t: 100, x: 0.25 }, { t: 132, x: 0.75 }, 0.5, 1), 116);
  assert.equal(crossing({ t: 100, x: 0.75 }, { t: 132, x: 0.25 }, 0.5, -1), 116);
  assert.equal(crossing({ t: 100, x: 0.75 }, { t: 132, x: 0.25 }, 0.5, 1), null);
  assert.equal(crossing({ t: 100, x: 0.25 }, { t: 190, x: 0.75 }, 0.5, 1), null);
  assert.equal(crossing({ t: 100, x: 0.5 }, { t: 132, x: 0.75 }, 0.5, 1), null);
  assert.equal(elapsedMs(100, 99), null);
});

test('hands and feet cannot trigger the torso crossing', () => {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.9, y: 0.65, visibility: 0.8 }));
  for (const index of [11, 12, 23, 24]) pose[index].x = 0.3;
  pose[11].x = 0.4;
  assert.equal(torsoPoint(pose, 1), pose[11]);
  assert.equal(torsoPoint(pose, -1), pose[12]);
  pose[24].visibility = 0.2;
  assert.equal(torsoPoint(pose, 1), null);
});
