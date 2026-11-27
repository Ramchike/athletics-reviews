import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { clockSample } from './public/timing.mjs';

const endpoint = new URL(process.argv[2] || 'https://stvor.theinventive.tech/');
if (endpoint.protocol !== 'https:') throw new Error('Pass the HTTPS origin of a Stvor pilot.');
const url = new URL('/ws', endpoint);
url.protocol = 'wss:';
const sockets = Array.from({ length: 2 }, () => new WebSocket(url, { origin: endpoint.origin }));
const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const round = value => Number(value.toFixed(2));

async function sample(socket) {
  const response = once(socket, 'message', { signal: AbortSignal.timeout(3000) });
  const t0 = performance.now();
  socket.send(JSON.stringify({ type: 'sync', t0 }));
  const [payload] = await response;
  const t3 = performance.now();
  const message = JSON.parse(payload);
  if (message.type !== 'sync' || message.t0 !== t0) throw new Error('Unexpected clock response');
  return clockSample(t0, message.t1, message.t2, t3);
}

try {
  await Promise.all(sockets.map(socket => once(socket, 'open', { signal: AbortSignal.timeout(5000) })));
  const series = [];
  for (let index = 0; index < 40; index++) {
    series.push(await Promise.all(sockets.map(sample)));
    if (index < 39) await delay(250);
  }
  const stats = sockets.map((_, index) => {
    const rtt = series.map(pair => pair[index].rtt);
    return { minimum_ms: round(Math.min(...rtt)), p50_ms: round(quantile(rtt, 0.5)),
      p95_ms: round(quantile(rtt, 0.95)), maximum_ms: round(Math.max(...rtt)) };
  });

  // Both sockets use the same monotonic clock, so their true offset difference is zero.
  const difference = series.map(([a, b]) => Math.abs(a.offset - b.offset));
  const bestDifference = [];
  for (let i = 0; i <= series.length - 8; i++) {
    const window = series.slice(i, i + 8);
    const [a, b] = stats.map((_stats, index) =>
      window.map(pair => pair[index]).reduce((best, value) => value.rtt < best.rtt ? value : best));
    bestDifference.push(Math.abs(a.offset - b.offset));
  }
  console.log(JSON.stringify({ endpoint: endpoint.origin, pairs: series.length, rtt: stats,
    same_host_offset_difference_p95_ms: round(quantile(difference, 0.95)),
    same_host_best_of_eight_difference_p95_ms: round(quantile(bestDifference, 0.95)) }, null, 2));
} finally {
  for (const socket of sockets) socket.close();
}
