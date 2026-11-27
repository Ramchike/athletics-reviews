import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clockSample, crossing, elapsedMs, estimateClock, torsoPoint } from '../public/timing.mjs';

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

test('clock estimate intersects compatible bounds and increases uncertainty for conflicting probes', () => {
  const at = 100;
  const probes = [{ offset: 520, rtt: 60, at }, { offset: 480, rtt: 60, at }];
  assert.equal(estimateClock(probes, at), null);
  assert.deepEqual(estimateClock([...probes, ...probes], at), { offset: 500, uncertainty: 12, rtt: 60 });
  const conflict = { offset: 560, rtt: 10, at };
  const result = estimateClock([...probes, conflict, conflict], at);
  assert.equal(result.rtt, 10);
  assert.equal(result.offset, 560);
  assert.ok(result.uncertainty > result.rtt / 2);
});
