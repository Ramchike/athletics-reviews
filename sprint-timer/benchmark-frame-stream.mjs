import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';

const directory = resolve(process.argv[2] ?? 'media/timer-synthetic/frames');
const frames = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.jpg')).sort()
  .map(name => readFile(resolve(directory, name))));
if (!frames.length) throw new Error('No JPEG frames to replay');
const python = process.argv[3];
const worker = python ? spawn(python, [fileURLToPath(new URL('./frame-infer-worker.py', import.meta.url))],
  { stdio: ['pipe', 'pipe', 'inherit'] }) : null;
const requests = new Map();
let inferenceId = 0;
if (worker) {
  const responses = createInterface({ input: worker.stdout });
  const [ready] = await once(responses, 'line', { signal: AbortSignal.timeout(15_000) });
  if (ready !== 'ready') throw new Error('Inference worker did not start');
  responses.on('line', line => {
    const { id, pose } = JSON.parse(line);
    const request = requests.get(id);
    requests.delete(id);
    request?.socket.send(JSON.stringify({ id: request.index, pose }));
  });
}
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await once(server, 'listening');
server.on('connection', socket => {
  socket.on('message', buffer => {
    const id = buffer.readUInt32BE(0);
    socket.send(JSON.stringify({ id }));
    if (worker) {
      const request = ++inferenceId;
      requests.set(request, { socket, index: id });
      worker.stdin.write(JSON.stringify({ id: request, jpeg: buffer.subarray(4).toString('base64') }) + '\n');
    }
  });
});
const fps = 30;
const bytes = frames.reduce((total, frame) => total + frame.length, 0);
const p95 = values => Number([...values].sort((a, b) => a - b)[Math.ceil(0.95 * values.length) - 1].toFixed(1));

try {
  for (const mbps of [5, 15, 50]) {
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    await once(socket, 'open');
    try {
      const delays = [];
      const inferenceDelays = [];
      const begun = performance.now();
      let available = begun;
      socket.on('message', data => {
        const message = JSON.parse(data);
        const timing = performance.now() - begun - message.id * 1000 / fps;
        (Object.hasOwn(message, 'pose') ? inferenceDelays : delays).push(timing);
      });
      for (const [index, frame] of frames.entries()) {
        const capture = begun + index * 1000 / fps;
        // Serialize an uplink with the requested capacity, then actually send the bytes.
        available = Math.max(capture, available) + (frame.length + 4) * 8 / (mbps * 1000);
        await delay(Math.max(0, available - performance.now()));
        const header = Buffer.alloc(4);
        header.writeUInt32BE(index);
        socket.send(Buffer.concat([header, frame]));
      }
      const deadline = performance.now() + 3000;
      const complete = () => delays.length === frames.length && (!worker || inferenceDelays.length === frames.length);
      while (!complete() && performance.now() < deadline) await delay(10);
      if (!complete()) throw new Error('Some JPEG packets were not acknowledged');
      console.log(JSON.stringify({
        frames: delays.length, fps, simulated_uplink_mbps: mbps, bytes,
        offered_mbps: Number((bytes * 8 * fps / frames.length / 1e6).toFixed(2)),
        ack_p95_ms: p95(delays), inference_ack_p95_ms: worker ? p95(inferenceDelays) : null, last_ack_ms: Number(delays.at(-1).toFixed(1)),
      }));
    } finally {
      socket.close();
    }
  }
} finally {
  worker?.stdin.end();
  server.close();
}
