import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createTimerServer } from '../server.mjs';

async function client(t, url) {
  const socket = new WebSocket(url);
  const messages = [];
  socket.on('message', data => messages.push(JSON.parse(data)));
  await once(socket, 'open');
  t.after(() => socket.terminate());
  return {
    send: message => socket.send(JSON.stringify(message)),
    close: async () => { socket.close(); await once(socket, 'close'); },
    get: async (type, predicate = () => true) => {
      for (let attempt = 0; attempt < 160; attempt++) {
        const index = messages.findIndex(m => m.type === type && predicate(m));
        if (index >= 0) return messages.splice(index, 1)[0];
        await delay(25);
      }
      assert.fail(`No message: ${type} among ${JSON.stringify(messages)}`);
    },
  };
}

test('two clients pair, arm, reconnect and get the same result with late delivery', async t => {
  const server = createTimerServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  const start = await client(t, url);
  const finish = await client(t, url);
  assert.equal(await (await fetch(url.replace('ws:', 'http:').replace('/ws', '/healthz'))).text(), 'ok');
  start.send({ type: 'create' });
  const { code } = await start.get('session');
  finish.send({ type: 'join', code: 'неверный' });
  assert.match((await finish.get('error')).text, /Сверь код/);
  finish.send({ type: 'join', code });
  const session = await finish.get('session');
  start.send({ type: 'prepare', distance: 60, mode: 'countdown' });
  await start.get('error');
  finish.send({ type: 'ready', ready: true });
  await start.get('status', value => value.ready);
  const series = { id: '14a6b5ed-1221-4ee1-a560-34bb2ec6bf85', index: 0, total: 4 };
  start.send({ type: 'prepare', distance: 60, mode: 'countdown', athlete: 'Рамир', series });
  const { run } = await finish.get('prepare');
  finish.send({ type: 'armed', id: run.id });
  await start.get('armed');
  await finish.close();
  await start.get('status', value => !value.paired && !value.ready);
  const resumed = await client(t, url);
  resumed.send({ type: 'resume', code, role: 'finish', token: session.token });
  assert.equal((await resumed.get('session')).run.id, run.id);

  // Test events use a near-future finish, independent of audio/camera hardware.
  // Delay actual packet delivery beyond that event time.
  const finishOffset = 120;
  const startEvent = { type: 'event', id: run.id, t: run.go, syncMs: 2, rttMs: 15, audio: 'output' };
  start.send(startEvent);
  await delay(Math.max(0, run.go - performance.now() + finishOffset) + 275);
  resumed.send({ type: 'event', id: run.id, t: run.go + finishOffset, syncMs: 4, frameMs: 16.7, camera: 'capture' });
  const first = await start.get('result');
  assert.equal(first.duration, finishOffset);
  assert.deepEqual(first.series, series);
  assert.equal(first.syncMs, 6);
  assert.equal(first.startRttMs, 15);
  assert.equal(first.finishRttMs, 8);
  assert.equal(first.finishAt, run.go + finishOffset);
  assert.ok(first.finishToServerMs >= 250);
  assert.deepEqual(first, await resumed.get('result'));

  resumed.send({ type: 'ready', ready: true });
  await start.get('status', value => value.ready);
  start.send({ type: 'prepare', distance: 100, mode: 'touch' });
  const { run: touch } = await resumed.get('prepare');
  assert.equal(touch.go, null);
  resumed.send({ type: 'armed', id: touch.id });
  await start.get('armed', value => value.id === touch.id);
  resumed.send({ type: 'event', id: touch.id, t: performance.now(), syncMs: 1, frameMs: 17, camera: 'capture' });
  await delay(20);
  const releasedAt = performance.now();
  start.send({ type: 'event', id: touch.id, t: releasedAt, syncMs: 1, audio: 'touch' });
  const started = await resumed.get('started');
  assert.equal(started.t, releasedAt);
  await delay(50);
  resumed.send({ type: 'event', id: touch.id, t: releasedAt + 40, syncMs: 1, frameMs: 17, camera: 'capture' });
  const second = await start.get('result');
  assert.equal(second.duration, 40);
  assert.equal(second.mode, 'touch');
  assert.deepEqual(second, await resumed.get('result'));

  start.send({ type: 'prepare', distance: 60, mode: 'flying' });
  const { run: flying } = await resumed.get('prepare');
  resumed.send({ type: 'armed', id: flying.id });
  await start.get('armed', value => value.id === flying.id);
  await delay(flying.cue - performance.now() + 100);
  const frameEvent = { type: 'event', id: flying.id, syncMs: 1, frameMs: 17, camera: 'capture' };
  resumed.send({ ...frameEvent, t: flying.cue + 90 });
  await delay(25);
  start.send({ ...frameEvent, t: flying.cue + 10 });
  const third = await start.get('result');
  assert.equal(third.mode, 'flying');
  assert.equal(third.duration, 80);
  assert.equal(third.startCamera, 'capture');
  assert.equal(third.startFrameMs, 17);
  assert.deepEqual(third, await resumed.get('result'));
});
