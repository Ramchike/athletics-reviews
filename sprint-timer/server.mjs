import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { elapsedMs } from './public/timing.mjs';

const ROOT = new URL('./', import.meta.url);
const files = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/scanner.mjs', ['public/scanner.mjs', 'text/javascript']],
  ['/vendor/jsQR.js', ['node_modules/jsqr/dist/jsQR.js', 'text/javascript']],
  ['/style.css', ['public/style.css', 'text/css']],
  ['/app.mjs', ['public/app.mjs', 'text/javascript']],
  ['/capture.mjs', ['public/capture.mjs', 'text/javascript']],
  ['/sound-trigger.mjs', ['public/sound-trigger.mjs', 'text/javascript']],
  ['/finish.mjs', ['public/finish.mjs', 'text/javascript']],
  ['/timing.mjs', ['public/timing.mjs', 'text/javascript']],
  ['/pose.task', ['public/pose.task', 'application/octet-stream']],
  ['/vendor/vision_bundle.mjs', ['node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', 'text/javascript']],
]);
for (const variant of ['internal', 'nosimd_internal']) {
  for (const ext of ['js', 'wasm']) {
    const file = `vision_wasm_${variant}.${ext}`;
    files.set(`/vendor/wasm/${file}`, [`node_modules/@mediapipe/tasks-vision/wasm/${file}`,
      ext === 'js' ? 'text/javascript' : 'application/wasm']);
  }
}

const id = () => randomBytes(16).toString('hex');
const now = () => performance.now();
const open = socket => socket?.readyState === WebSocket.OPEN;
const send = (socket, message) => {
  if (open(socket)) socket.send(JSON.stringify(message));
};

export function createTimerServer({ origin, tls } = {}) {
  const rooms = new Map();
  const handleRequest = async (req, res) => {
    if (req.url === '/healthz') return res.writeHead(200).end('ok');
    if (req.url === '/readyz') {
      try {
        await Promise.all([...files.values()].map(async ([path]) => {
          const info = await stat(new URL(path, ROOT));
          if (!info.isFile() || !info.size) throw new Error('Missing asset');
        }));
        return res.writeHead(200, { 'Cache-Control': 'no-store' }).end('ready');
      } catch {
        return res.writeHead(503, { 'Cache-Control': 'no-store' }).end('assets unavailable');
      }
    }
    const file = files.get(req.url?.split('?')[0]);
    if (!file || !['GET', 'HEAD'].includes(req.method)) return res.writeHead(404).end();
    const path = fileURLToPath(new URL(file[0], ROOT));
    try {
      const { size } = await stat(path);
      res.writeHead(200, {
        'Content-Type': file[1], 'Content-Length': size, 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': req.url.startsWith('/vendor/') || req.url === '/pose.task' ? 'public, max-age=3600' : 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      createReadStream(path).on('error', () => res.destroy()).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  };
  const server = tls ? createSecureServer(tls, handleRequest) : createServer(handleRequest);

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws' || (origin && req.headers.origin !== origin) || wss.clients.size >= 200) {
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, ws => {
      ws.inviteOrigin = origin ?? req.headers.origin;
      wss.emit('connection', ws);
    });
  });

  function broadcast(room, message) {
    send(room.start?.socket, message);
    send(room.finish?.socket, message);
  }

  function status(room) {
    broadcast(room, { type: 'status', paired: open(room.start.socket) && open(room.finish?.socket),
      ready: open(room.finish?.socket) && Boolean(room.finish?.ready) });
  }

  function bind(room, role, socket, token) {
    const member = room[role] ?? { token };
    const old = member.socket;
    room[role] = member;
    member.socket = socket;
    if (role === 'finish') member.ready = false;
    socket.session = { room, role };
    old?.close(4001, 'Session resumed');
    send(socket, { type: 'session', code: room.code, role, token: member.token, run: room.run, result: room.result });
    const invite = role === 'start' && URL.parse(socket.inviteOrigin ?? '');
    if (invite && ['https:', 'http:'].includes(invite.protocol)) {
      const link = new URL('/', invite.origin);
      link.hash = new URLSearchParams({ finish: room.code });
      QRCode.toDataURL(link.href, { margin: 4, scale: 6 })
        .then(src => send(socket, { type: 'invite-qr', code: room.code, src }))
        .catch(() => {}); // The code and invitation link are still available.
    }
    status(room);
  }

  function attach(socket, message) {
    if (message.type === 'create' && rooms.size < 100) {
      let code;
      do { code = randomBytes(4).toString('hex').toUpperCase(); } while (rooms.has(code));
      const room = { code, touched: now() };
      rooms.set(code, room);
      return bind(room, 'start', socket, id());
    }
    const room = rooms.get(message.code);
    if (message.type === 'join') {
      if (room && !room.finish) return bind(room, 'finish', socket, id());
      if (room?.finish && !room.run && !open(room.finish.socket)) {
        room.finish = null;
        return bind(room, 'finish', socket, id());
      }
      return send(socket, { type: 'error', code: 'join', text: room
        ? 'Финиш уже подключён. Вернись на подключённый телефон или закрой ту вкладку и повтори после окончания попытки.'
        : 'Такой комнаты нет. Сверь код с первым телефоном. Если там тоже главный экран, нажми на нём «Создать старт».' });
    }
    if (message.type === 'resume' && room && ['start', 'finish'].includes(message.role)
      && typeof message.token === 'string' && room[message.role]?.token === message.token) {
      return bind(room, message.role, socket, message.token);
    }
    send(socket, { type: 'error', code: 'session', text: 'Комната закрыта. Создай новую комнату на стартовом телефоне.' });
  }

  function finishRun(room) {
    const run = room.run;
    if (!run.startEvent || !run.finishEvent) return;
    const duration = elapsedMs(run.startEvent.t, run.finishEvent.t);
    room.run = null;
    if (duration === null) {
      return broadcast(room, { type: 'cancelled', id: run.id, text: 'События не попали в интервал попытки.' });
    }
    room.result = { type: 'result', id: run.id, distance: run.distance, athlete: run.athlete,
      mode: run.mode, series: run.series, duration, syncMs: run.startEvent.syncMs + run.finishEvent.syncMs,
      startRttMs: run.startEvent.rttMs, finishRttMs: run.finishEvent.rttMs,
      finishAt: run.finishEvent.t, finishToServerMs: run.finishEvent.receivedAt - run.finishEvent.t,
      startFrameMs: run.startEvent.frameMs, startCamera: run.startEvent.camera,
      frameMs: run.finishEvent.frameMs, audio: run.startEvent.audio, camera: run.finishEvent.camera,
      date: new Date().toISOString() };
    broadcast(room, room.result);
  }

  function onRunMessage(room, role, socket, message) {
    if (message.type === 'prepare' && role === 'start') {
      if (room.run || !open(room.finish?.socket) || !room.finish.ready
        || ![60, 100].includes(message.distance) || !['countdown', 'random', 'touch', 'sound', 'flying'].includes(message.mode)) {
        return send(socket, { type: 'error', text: 'Финиш ещё не готов или попытка уже идёт.' });
      }
      const cue = now() + ([5, 10, 20].includes(message.lead) ? message.lead * 1000 : 1800);
      const go = ['touch', 'sound', 'flying'].includes(message.mode) ? null
        : cue + (message.mode === 'countdown' ? 3000 : 2100 + Math.random() * 1100);
      room.run = { id: id(), cue, go, mode: message.mode, distance: message.distance, armed: false,
        athlete: typeof message.athlete === 'string' ? message.athlete.trim().slice(0, 40) : '' };
      const series = message.series;
      if (series && typeof series.id === 'string' && /^[0-9a-f-]{36}$/.test(series.id)
        && Number.isInteger(series.index) && Number.isInteger(series.total)
        && series.index >= 0 && series.index < series.total && series.total <= 100) {
        room.run.series = { id: series.id, index: series.index, total: series.total };
      }
      room.result = null;
      return broadcast(room, { type: 'prepare', run: room.run });
    }
    const run = room.run;
    if (!run || message.id !== run.id) return;
    if (message.type === 'armed' && role === 'finish' && !run.armed && now() < run.cue - 300) {
      run.armed = true;
      run.armedAt = now();
      return broadcast(room, { type: 'armed', id: run.id });
    }
    if (message.type === 'cancel') {
      room.run = null;
      return broadcast(room, { type: 'cancelled', id: run.id, text: 'Попытка отменена.' });
    }
    if (!run.armed || message.type !== 'event' || !Number.isFinite(message.t)
      || !Number.isFinite(message.syncMs) || message.syncMs < 0 || message.syncMs > 500) return;
    const rttMs = message.rttMs ?? message.syncMs * 2;
    if (!Number.isFinite(rttMs) || rttMs < 0 || rttMs > 1000) return;
    const manualStart = run.go === null;
    const earliestStart = run.mode === 'touch' ? run.armedAt : run.cue;
    const validFrame = ['capture', 'presentation'].includes(message.camera)
      && Number.isFinite(message.frameMs) && message.frameMs > 0 && message.frameMs <= 85;
    if (role === 'start' && !run.startEvent && (manualStart
      ? (run.mode === 'flying' ? validFrame : message.audio === run.mode) && message.t >= earliestStart - message.syncMs
        && message.t <= Math.min(now() + message.syncMs + (run.mode === 'sound' ? 15 : 0), run.cue + 60_000)
      : Math.abs(message.t - run.go) < 900 && ['output', 'estimated'].includes(message.audio))) {
      run.startEvent = { t: message.t, syncMs: message.syncMs, rttMs, audio: message.audio };
      if (run.mode === 'flying') Object.assign(run.startEvent, { camera: message.camera, frameMs: message.frameMs });
      if (manualStart) {
        if (run.finishEvent?.t < message.t) run.finishEvent = null;
        broadcast(room, { type: 'started', id: run.id, t: message.t });
      }
    }
    const earliestFinish = run.go !== null ? run.go - 200 : (run.startEvent?.t ?? earliestStart);
    if (role === 'finish' && !run.finishEvent && message.t >= earliestFinish
      && (run.go === null || message.t < run.go + 60_000)
      && message.t <= now() + 1000 && validFrame) {
      run.finishEvent = { t: message.t, receivedAt: now(), syncMs: message.syncMs, rttMs,
        camera: message.camera, frameMs: message.frameMs };
    }
    finishRun(room);
  }

  wss.on('connection', socket => {
    socket.alive = true;
    socket.on('error', () => socket.terminate());
    socket.on('pong', () => { socket.alive = true; });
    socket.on('message', raw => {
      const t1 = now();
      let message;
      try { message = JSON.parse(raw); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'sync' && Number.isFinite(message.t0)) {
        if (socket.session) socket.session.room.touched = t1;
        return send(socket, { type: 'sync', t0: message.t0, t1, t2: now() });
      }
      if (!socket.session) return attach(socket, message);
      const { room, role } = socket.session;
      if (room[role].socket !== socket) return;
      room.touched = t1;
      if (role === 'finish' && message.type === 'ready') {
        room.finish.ready = message.ready === true;
        return status(room);
      }
      onRunMessage(room, role, socket, message);
    });
    socket.on('close', () => {
      const session = socket.session;
      if (!session || session.room[session.role].socket !== socket) return;
      session.room[session.role].socket = null;
      status(session.room);
    });
  });

  const sweep = setInterval(() => {
    const t = now();
    for (const [code, room] of rooms) {
      if (room.run && ((!room.run.armed && t >= room.run.cue)
        || t > (room.run.go ?? room.run.startEvent?.t ?? room.run.cue) + 90_000)) {
        broadcast(room, { type: 'cancelled', id: room.run.id, text: 'Попытка истекла. Проверь связь и повтори.' });
        room.run = null;
      }
      if (t - room.touched > 7_200_000) {
        room.start.socket?.close(4002, 'Room expired');
        room.finish?.socket?.close(4002, 'Room expired');
        rooms.delete(code);
      }
    }
    for (const socket of wss.clients) {
      if (!socket.alive) socket.terminate();
      else { socket.alive = false; socket.ping(); }
    }
  }, 5000).unref();
  server.on('close', () => clearInterval(sweep));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 4173);
  const { TLS_CERT_FILE, TLS_KEY_FILE, PUBLIC_ORIGIN } = process.env;
  if (Boolean(TLS_CERT_FILE) !== Boolean(TLS_KEY_FILE)) throw new Error('Provide both TLS_CERT_FILE and TLS_KEY_FILE');
  const tls = TLS_CERT_FILE ? { cert: readFileSync(TLS_CERT_FILE), key: readFileSync(TLS_KEY_FILE) } : undefined;
  createTimerServer({ origin: PUBLIC_ORIGIN, tls }).listen(port, host, () => {
    console.log(`Track Clock listening at ${tls ? 'https' : 'http'}://${host}:${port}`);
  });
}
