import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { createTimerServer } from './server.mjs';
import { clockSample } from './public/timing.mjs';

const server = createTimerServer().listen(0, '127.0.0.1');
await once(server, 'listening');
const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
await once(ws, 'open');
const percentile = (items, fraction) => items.sort((a, b) => a - b)[Math.ceil(items.length * fraction) - 1];
const round = value => Number(value.toFixed(1));
const wait = milliseconds => milliseconds ? new Promise(resolve => setTimeout(resolve, milliseconds)) : undefined;

try {
  for (const [name, outbound, inbound] of [
    ['loopback', 0, 0], ['balanced', 30, 30], ['asymmetric', 70, 15],
  ]) {
    const results = [];
    const n = 24;
    for (let sample = 0; sample < n; sample++) {
      const t0 = performance.now();
      await wait(outbound);
      const response = once(ws, 'message');
      ws.send(JSON.stringify({ type: 'sync', t0 }));
      const [raw] = await response;
      await wait(inbound);
      const { t1, t2 } = JSON.parse(raw);
      results.push(clockSample(t0, t1, t2, performance.now()));
    }
    const rtts = results.map(sample => sample.rtt);
    const errors = results.map(sample => Math.abs(sample.offset));
    console.log(JSON.stringify({
      name, n, outbound_ms: outbound, inbound_ms: inbound, rtt_p50_ms: round(percentile(rtts, 0.5)),
      rtt_p95_ms: round(percentile(rtts, 0.95)), clock_error_p95_ms: round(percentile(errors, 0.95)),
    }));
  }
} finally {
  ws.close();
  server.close();
}
