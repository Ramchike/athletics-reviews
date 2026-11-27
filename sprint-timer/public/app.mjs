import { clockSample, estimateClock } from './timing.mjs';
import { loadReplay, recordAttempt, storeReplay } from './capture.mjs';

const $ = id => document.getElementById(id);
const show = (id, visible) => { $(id).hidden = !visible; };
const text = (id, value) => {
  const element = $(id);
  if (element.textContent !== value) element.textContent = value;
};
const storageKey = 'stvor-session';
const historyKey = 'stvor-results';
const seriesKey = 'stvor-series';
const athletesKey = 'stvor-athletes';
const onboardingKey = 'stvor-onboarding';
const load = (storage, key, fallback) => {
  try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const save = (storage, key, value) => {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing or storage quota. */ }
};
const format = value => (value / 1000).toFixed(2).replace('.', ',');
const validCode = /^[0-9A-F]{8}$/;
const invite = new URLSearchParams(location.hash.slice(1)).get('finish') ?? '';
const inviteCode = validCode.test(invite) ? invite : '';

let session = inviteCode ? null : load(sessionStorage, storageKey, null);
let inviteQr;
let history = load(localStorage, historyKey, []);
let athletes = load(localStorage, athletesKey, []);
let route = { page: 'timer' };
let athleteDetail;
let scanController;
let onboardingStep;
const replayWrites = new Map();
let replayView;
let series = load(sessionStorage, seriesKey, null);
let socket;
let reconnect;
let intent;
let syncTimer;
let paired = false;
let remoteReady = false;
let localReady = false;
let samples = [];
let run;
let result;
let pending;
let camera;
let cameraGeneration = 0;
let startStream;
let openingStartCamera = false;
let recording;
let checkingFinish = false;
let photo;
let audio;
let microphone;
let preparing = false;
let tones = [];
let reportTimer;
let frame;
let wake;

const routes = {
  timer: ['', 'home-title'],
  athletes: ['athletes', 'athletes-title'],
  athlete: ['athlete', 'athlete-title'],
  'athlete-new': ['athlete-new', 'athlete-new-title'],
  scan: ['scan', 'scan-title'],
  join: ['join', 'join-title'],
  attempt: ['attempt', 'result-title'],
  onboarding: ['onboarding', 'onboarding-title'],
};

function readRoute() {
  const code = new URLSearchParams(location.hash.slice(1)).get('finish');
  if (validCode.test(code ?? '')) return { page: 'join', value: code };
  const [segment, encoded] = location.hash.slice(2).split('/');
  const page = Object.keys(routes).find(key => routes[key][0] === segment);
  if (location.hash.startsWith('#/') && page) {
    try { return { page, value: encoded ? decodeURIComponent(encoded) : undefined }; }
    catch { /* Invalid URL encoding. */ }
  }
  return { page: 'timer' };
}

function routeUrl({ page, value }) {
  if (page === 'join' && value) return `#finish=${value}`;
  return `#/${routes[page][0]}${value ? `/${encodeURIComponent(value)}` : ''}`;
}

function applyRoute(next, { focus, scroll = 0 } = {}) {
  if (session && ['scan', 'join'].includes(next.page)) {
    next = { page: 'timer' };
    window.history.replaceState(null, '', routeUrl(next));
    focus = undefined;
  }
  if (route.page === 'scan') {
    scanController?.abort();
    scanController = null;
  }
  if (route.page === 'attempt') closeReplay();
  if (['scan', 'join'].includes(route.page) && !['scan', 'join'].includes(next.page) && !session && intent) {
    void socket?.close();
    socket = intent = null;
  }
  if (route.page === 'timer' && next.page !== 'timer' && localReady) {
    localReady = false;
    send({ type: 'ready', ready: false });
  }
  route = next;
  if (next.page === 'athlete') {
    if (athleteDetail !== next.value) {
      $('result-order').value = 'recent';
      $('result-distance').value = '';
    }
    athleteDetail = next.value;
    renderAthleteResults();
    if (!athleteDetail) text('athlete-title', 'Результаты');
  }
  if (next.page === 'join' && next.value) $('join-code').value = next.value;
  if (next.page === 'onboarding') {
    onboardingStep = Math.min(Math.max(Math.trunc(Number(next.value) || 0), 0), onboarding.length - 1);
    renderOnboarding();
  }
  render();
  if (next.page === 'scan') void startScanner();
  if (next.page === 'attempt') void openReplay(next.value);
  if (next.page === 'timer' && camera) $('camera').play().catch(() => {});
  const heading = $(next.page === 'timer' && session ? 'room-title' : routes[next.page][1]);
  const returnTarget = $(focus);
  window.scrollTo(0, scroll);
  (returnTarget?.getClientRects().length ? returnTarget : heading).focus({ preventScroll: true });
  document.title = `${heading.textContent} · Створ`;
}

function navigate(page, value, { replace = false, focus, returnFocus = document.activeElement.id } = {}) {
  if ((run || preparing) && page !== 'timer') return;
  const next = { page, value };
  const state = window.history.state;
  if (page === route.page && value === route.value) return;
  if (!replace) {
    window.history.replaceState({ ...state, focus: returnFocus, scroll: window.scrollY }, '');
  }
  window.history[replace ? 'replaceState' : 'pushState']({ parent: replace ? state?.parent : route }, '', routeUrl(next));
  applyRoute(next, { focus });
}

function goBack(page = 'timer', value) {
  if (window.history.state?.parent) window.history.back();
  else navigate(page, value, { replace: true });
}

window.history.scrollRestoration = 'manual';
window.addEventListener('popstate', event => {
  if (run || preparing) {
    window.history.replaceState({}, '', routeUrl(route));
    return;
  }
  applyRoute(readRoute(), event.state ?? {});
});

let pressedButton;
function releaseButton() {
  pressedButton?.classList.remove('is-pressed');
  pressedButton = null;
}
document.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  releaseButton();
  pressedButton = event.target.closest('button:enabled');
  pressedButton?.classList.add('is-pressed');
});
for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, event => { if (event.isPrimary) releaseButton(); });
}
window.addEventListener('blur', releaseButton);

function send(message) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function syncNow() {
  send({ type: 'sync', t0: performance.now() });
}

function sync() {
  const current = performance.now();
  return estimateClock(samples.filter(sample => current - sample.at < 18_000), current);
}

const stableClock = clock => clock && clock.rtt <= 160 && clock.uncertainty <= 100;

function connect() {
  if (socket && socket.readyState < WebSocket.CLOSING) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket = ws;
  ws.addEventListener('open', () => {
    if (session) send({ type: 'resume', ...session });
    else if (intent) send(intent);
  });
  ws.addEventListener('message', ({ data }) => {
    const receivedAt = performance.now();
    if (socket === ws) onMessage(JSON.parse(data), receivedAt);
  });
  ws.addEventListener('close', event => {
    if (socket !== ws) return;
    clearInterval(syncTimer);
    paired = remoteReady = false;
    samples = [];
    if (event.code === 4001) {
      notice('Эта роль открыта в другой вкладке.');
    } else if (session) {
      reconnect = setTimeout(connect, 800);
    } else if (intent) {
      intent = null;
      const message = 'Сервер недоступен. Проверь интернет и попробуй снова.';
      if (route.page === 'join') joinError(message);
      else if (route.page === 'scan') text('scan-status', message);
      else notice(message);
    }
    render();
  });
}

function requestSession(type, code) {
  notice('');
  intent = { type, code };
  if (!send(intent)) connect();
}

function notice(message) {
  text('notice', message);
  show('notice', Boolean(message));
}

function resetRun() {
  recording?.();
  recording = null;
  microphone?.stop();
  microphone = null;
  clearTimeout(reportTimer);
  cancelAnimationFrame(frame);
  for (const oscillator of tones) {
    try { oscillator.stop(); } catch { /* The node has already stopped. */ }
  }
  tones = [];
  run = pending = null;
}

function leave() {
  resetRun();
  cameraGeneration += 1;
  $('camera-button').disabled = false;
  camera?.stop();
  camera = null;
  stopStartPreview();
  photo = result = intent = session = null;
  inviteQr = null;
  text('copy-invite', 'Копировать ссылку');
  $('invite-image').removeAttribute('src');
  checkingFinish = false;
  localReady = remoteReady = paired = false;
  samples = [];
  save(sessionStorage, storageKey, null);
  saveSeries(null);
  clearInterval(syncTimer);
  clearTimeout(reconnect);
  const previous = socket;
  socket = null;
  previous?.close();
  wake?.release().catch(() => {});
  wake = null;
  notice('');
  render();
  $('create').focus({ preventScroll: true });
}

function onMessage(message, receivedAt) {
  switch (message.type) {
    case 'session': {
      const entering = !session;
      const { code, role, token } = message;
      intent = null;
      session = { code, role, token };
      save(sessionStorage, storageKey, session);
      notice('');
      clearInterval(syncTimer);
      let warm = 0;
      syncNow();
      syncTimer = setInterval(() => {
        syncNow();
        warm += 1;
        if (warm === 7) {
          clearInterval(syncTimer);
          syncTimer = setInterval(syncNow, 1500);
        }
      }, 130);
      if (role === 'finish') send({ type: 'ready', ready: localReady });
      if (run && message.run?.id !== run.id && message.result?.id !== run.id) resetRun();
      if (run && message.run?.armed) armRun(run.id);
      else if (role === 'finish' && run?.cameraArmed) send({ type: 'armed', id: run.id });
      if (run?.go === null && message.run?.startEvent) acceptStart(message.run.startEvent.t);
      if (pending && message.run?.id === pending.id) send(pending);
      if (message.result) displayResult(message.result);
      if (entering) {
        if (['join', 'scan'].includes(route.page)) navigate('timer', undefined, { replace: true });
        else if (route.page === 'timer') {
          render();
          $('room-title').focus({ preventScroll: true });
        }
      }
      break;
    }
    case 'invite-qr':
      if (session?.role === 'start' && message.code === session.code) {
        inviteQr = message.src;
        $('invite-image').src = inviteQr;
      }
      break;
    case 'sync': {
      const sample = clockSample(message.t0, message.t1, message.t2, receivedAt);
      if (sample.rtt >= 0 && sample.rtt < 1000) {
        samples.push({ ...sample, at: receivedAt });
        if (samples.length > 24) samples.shift();
      }
      break;
    }
    case 'status':
      paired = message.paired;
      remoteReady = message.ready;
      break;
    case 'prepare': {
      const clock = sync();
      if (!stableClock(clock) || document.hidden || route.page !== 'timer'
        || (session.role === 'finish' && !localReady)
        || ((session.role === 'finish' || message.run.mode === 'flying') && !camera?.metrics().camera)) {
        send({ type: 'cancel', id: message.run.id });
        microphone?.stop();
        microphone = null;
        notice('Устройство не готово. Проверь связь, экран и камеру.');
        break;
      }
      notice('');
      photo = result = null;
      checkingFinish = false;
      run = { ...message.run, clock, armed: false };
      const stream = camera ? $('camera').srcObject : startStream;
      recording = recordAttempt(stream);
      if (session.role === 'finish') {
        const id = run.id;
        $('camera').play().then(() => {
          if (run?.id === id) {
            run.cameraArmed = true;
            send({ type: 'armed', id });
          }
        }).catch(() => {
          if (run?.id === id) {
            send({ type: 'cancel', id });
            notice('Камера на паузе. Повтори настройку финиша.');
          }
        });
      }
      tick();
      break;
    }
    case 'armed':
      armRun(message.id);
      break;
    case 'started':
      if (run?.id === message.id && run.go === null) acceptStart(message.t);
      break;
    case 'cancelled':
      if (run?.id === message.id) {
        resetRun();
        notice(message.text);
      }
      break;
    case 'result':
      displayResult(message, receivedAt);
      break;
    case 'error':
      if (message.code === 'session' && session) leave();
      intent = null;
      if (!run) {
        microphone?.stop();
        microphone = null;
      }
      if (message.code === 'join') {
        openCodeEntry();
        joinError(message.text);
      }
      else notice(message.text);
      break;
  }
  render();
}

function armRun(id) {
  if (run?.id !== id || run.armed) return;
  run.armed = true;
  if (session.role === 'start' && run.mode === 'sound') microphone?.arm(run);
  if (session.role === 'start' && run.go !== null) playStart();
}

function tick() {
  if (!run) return;
  const t = performance.now() + run.clock.offset;
  let phase = 'Проверка финиша';
  let clock = '—';
  if (run.armed && run.go === null) {
    phase = run.mode === 'touch' ? 'Готов к старту касанием' : t < run.cue ? 'Приготовься'
      : run.mode === 'flying' ? 'Ожидаем проход на старте' : 'Ожидаем внешний звук';
    if (pending?.camera && session.role === 'finish') phase = 'Финиш снят · ждём метку старта';
  } else if (run.armed) {
    phase = t >= run.go ? 'Забег идёт' : t < run.cue ? 'Приготовься' : 'Стартовый сигнал';
    if (pending?.camera && session.role === 'finish') phase = 'Финиш снят · ждём результат';
    if (run.mode === 'countdown' && t >= run.cue && t < run.go) clock = String(Math.ceil((run.go - t) / 1000));
    if (run.mode === 'random' && t >= run.cue && t < run.go) clock = t < run.cue + 1200 ? 'На старт' : 'Внимание';
    if (t >= run.go) clock = format(t - run.go);
  }
  if ($('run-phase').textContent !== phase) text('run-phase', phase);
  text('clock', clock);
  frame = requestAnimationFrame(tick);
}

function report(fields) {
  if (!run || pending) return;
  pending = { type: 'event', id: run.id, ...fields, t: fields.t + run.clock.offset,
    syncMs: run.clock.uncertainty, rttMs: run.clock.rtt };
  send(pending);
}

function releaseFromPad(event) {
  if (session?.role !== 'start' || !run?.armed || run.mode !== 'touch' || run.go !== null) return;
  const received = performance.now();
  const t = event.timeStamp > 0 && event.timeStamp <= received ? event.timeStamp : received;
  run.go = t + run.clock.offset;
  report({ t, audio: 'touch' });
  render();
}

function acceptStart(t) {
  run.go = t;
  if (pending?.camera && pending.t < t) {
    pending = null;
    photo = null;
  }
}

async function openMicrophone() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false,
  });
  try {
    await audio.audioWorklet.addModule('/sound-trigger.mjs');
    const input = audio.createMediaStreamSource(stream);
    const detector = new AudioWorkletNode(audio, 'stvor-sound-trigger');
    input.connect(detector).connect(audio.destination);
    let localOrigin;
    let runId;
    function stop() {
      detector.port.close();
      input.disconnect();
      detector.disconnect();
      stream.getTracks().forEach(track => track.stop());
    }
    detector.port.onmessage = ({ data: seconds }) => {
      if (run?.id !== runId || run.go !== null || !Number.isFinite(seconds)) return;
      const t = localOrigin + seconds * 1000;
      run.go = t + run.clock.offset;
      report({ t, audio: 'sound' });
      stop();
      microphone = null;
    };
    return { stop, arm(attempt) {
      runId = attempt.id;
      localOrigin = performance.now() - audio.currentTime * 1000;
      detector.port.postMessage((attempt.cue - attempt.clock.offset - localOrigin) / 1000);
    } };
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    throw error;
  }
}

function playStart() {
  const { clock, cue, go, mode, id } = run;
  const output = audio.getOutputTimestamp?.();
  const hasOutput = output?.performanceTime > 0;
  const toAudio = local => hasOutput
    ? output.contextTime + (local - output.performanceTime) / 1000
    : audio.currentTime + (local - performance.now()) / 1000;
  const first = toAudio(cue - clock.offset);
  if (audio.state !== 'running' || first < audio.currentTime + 0.04) {
    send({ type: 'cancel', id });
    resetRun();
    notice('Сигнал не успел подготовиться. Проверь связь и повтори.');
    return;
  }
  const goAudio = toAudio(go - clock.offset);
  function tone(at, hz, length) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = hz;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.7, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, at + length);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(at);
    oscillator.stop(at + length);
    tones.push(oscillator);
  }
  if (mode === 'countdown') {
    for (let step = 0; step < 3; step++) tone(first + step, 540, 0.11);
  } else {
    tone(first, 400, 0.16);
    tone(first + 1.2, 600, 0.16);
  }
  tone(goAudio, 970, 0.26);
  reportTimer = setTimeout(() => {
    if (run?.id !== id) return;
    if (audio.state !== 'running') {
      send({ type: 'cancel', id });
      resetRun();
      notice('Аудио прервалось. Повтори старт.');
      render();
      return;
    }
    const stamp = audio.getOutputTimestamp?.();
    const observed = stamp?.performanceTime > 0;
    report({ t: observed ? stamp.performanceTime + (goAudio - stamp.contextTime) * 1000
      : go - clock.offset, audio: observed ? 'output' : 'estimated' });
  }, Math.max(0, go - clock.offset - performance.now() + 420));
}

function displayResult(message, receivedAt) {
  const resultArrivalMs = run?.id === message.id && Number.isFinite(receivedAt)
    && Number.isFinite(message.finishAt) ? Math.round(receivedAt + run.clock.offset - message.finishAt) : null;
  if (run?.id === message.id && (recording || photo)) {
    const { id } = message;
    const { role } = session;
    const photos = photo;
    const stopped = recording?.();
    const saved = Promise.resolve(stopped).then(video => storeReplay({ id, role, photos, video }));
    recording = null;
    replayWrites.set(id, saved);
    saved.catch(() => notice('Не удалось сохранить запись на этом телефоне.')).finally(() => replayWrites.delete(id));
  }
  resetRun();
  result = message;
  if (series?.code === session.code && message.series?.id === series.id && message.series.index === series.index) {
    saveSeries({ ...series, index: series.index + 1 });
  }
  if (!history.some(item => item.id === message.id)) {
    history = [{ ...message, resultArrivalMs, role: session.role }, ...history].slice(0, 500);
    save(localStorage, historyKey, history);
  }
  renderHistory();
}

function saveSeries(value) {
  series = value;
  save(sessionStorage, seriesKey, value);
}

function currentSeries() {
  return session?.role === 'start' && series?.code === session.code ? series : null;
}

function applySeries() {
  const names = $('series-names').value.split('\n').map(name => name.trim().slice(0, 40)).filter(Boolean);
  if (!names.length) names.push($('athlete').value.trim());
  const rounds = Number($('series-rounds').value);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10 || names.length * rounds > 100) {
    notice('Укажи от 1 до 10 кругов и не больше 100 попыток в серии.');
    return;
  }
  const athletes = Array.from({ length: rounds }, () => names).flat();
  saveSeries({ id: crypto.randomUUID(), code: session.code, athletes, index: 0, voice: $('series-voice').checked });
  $('series-settings').open = false;
  notice('');
  render();
}

async function stayAwake() {
  if (!wake || wake.released) {
    try { wake = await navigator.wakeLock?.request('screen'); } catch { /* Browser may deny this request. */ }
  }
}

async function startRun(event) {
  event.preventDefault();
  if (preparing || !sync() || !remoteReady || !paired) return;
  preparing = true;
  const openingSession = session;
  const button = $('start-run');
  button.disabled = true;
  notice('');
  const values = new FormData(event.target);
  try {
    const mode = values.get('mode');
    if (mode === 'flying') await $('camera').play();
    if (!['touch', 'flying'].includes(mode)) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      audio ??= new Audio({ latencyHint: 'interactive' });
      await audio.resume();
      if (audio.state !== 'running') throw new Error('Аудио недоступно.');
    }
    if (mode === 'sound') {
      const input = await openMicrophone();
      if (session !== openingSession) { input.stop(); return; }
      microphone = input;
    }
    if (session !== openingSession) return;
    void stayAwake();
    const queue = currentSeries();
    const next = queue && queue.index < queue.athletes.length
      ? { id: queue.id, index: queue.index, total: queue.athletes.length } : undefined;
    if (!send({ type: 'prepare', distance: Number(values.get('distance')), lead: Number(values.get('lead')),
      mode, athlete: next ? queue.athletes[next.index] : values.get('athlete'), series: next })) {
      microphone?.stop();
      microphone = null;
      notice('Связь потеряна. Повтори через несколько секунд.');
    }
  } catch {
    notice(values.get('mode') === 'sound'
      ? 'Микрофон недоступен. Проверь разрешение браузера.'
      : values.get('mode') === 'flying' ? 'Камера старта недоступна. Проверь её настройки.'
      : 'Не удалось включить звук. Проверь разрешения и громкость.');
  } finally {
    preparing = false;
    render();
  }
}

async function startCamera() {
  const role = session.role;
  const generation = ++cameraGeneration;
  const marker = $('torso-point');
  marker.hidden = true;
  $('camera-button').disabled = true;
  notice('Загружается камера и модель…');
  try {
    const { watchFinish } = await import('./finish.mjs');
    const watcher = await watchFinish($('camera'), {
      config: () => ({
        runId: checkingFinish ? 'check-finish' : (run?.armed || run?.cameraArmed) && !pending ? run.id : null,
        go: checkingFinish ? -Infinity : run
          ? (run.go ?? (run.mode === 'touch' ? -Infinity : run.cue)) - run.clock.offset : Infinity,
        direction: Number($('direction').value),
        line: Number($('line').value) / 100,
      }),
      position: point => {
        if (generation !== cameraGeneration) return;
        marker.hidden = !point;
        if (point) {
          marker.style.left = `${point.x * 100}%`;
          marker.style.top = `${point.y * 100}%`;
        }
      },
      metrics: metrics => {
        text('camera-metrics', metrics.point ? 'Туловище видно' : 'Туловище пока не видно');
        render();
      },
      crossed: ({ photos, ...event }) => {
        if (checkingFinish) {
          checkingFinish = false;
          notice(`Проход пойман. Между двумя кадрами ${Math.round(event.frameMs)} мс.`);
          render();
          return;
        }
        photo = photos;
        if (role === 'start' && run?.mode === 'flying') acceptStart(event.t + run.clock.offset);
        report(event);
      },
      failed: message => {
        camera = null;
        checkingFinish = false;
        localReady = false;
        if (role === 'finish') send({ type: 'ready', ready: false });
        if (run && !pending) send({ type: 'cancel', id: run.id });
        notice(message);
        render();
      },
    });
    if (generation !== cameraGeneration || session?.role !== role) { watcher.stop(); return; }
    camera = watcher;
    void stayAwake();
    notice('');
  } catch (error) {
    if (generation === cameraGeneration) notice(`Камера не готова. ${error.message}`);
  } finally {
    if (generation === cameraGeneration) {
      $('camera-button').disabled = false;
      render();
    }
  }
}

function stopStartPreview() {
  startStream?.getTracks().forEach(track => track.stop());
  startStream = null;
  $('start-preview').srcObject = null;
}

$('start-record-button').onclick = async () => {
  if (startStream) {
    stopStartPreview();
    render();
    return;
  }
  const openingSession = session;
  openingStartCamera = true;
  render();
  notice('');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    if (openingSession !== session || $('mode').value === 'flying') {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    startStream = stream;
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      if (startStream !== stream) return;
      stopStartPreview();
      render();
    });
    $('start-preview').srcObject = stream;
  } catch {
    if (openingSession === session) notice('Камера старта недоступна.');
  } finally {
    openingStartCamera = false;
    render();
  }
};

function render() {
  const start = session?.role === 'start';
  const finish = session?.role === 'finish';
  const clock = sync();
  const connected = socket?.readyState === WebSocket.OPEN;
  const { page } = route;
  const timer = page === 'timer';
  const root = timer || page === 'athletes';
  show('mast', root);
  show('primary-nav', root);
  $('main').dataset.page = page;
  show('home', timer && !session);
  show('room', timer && Boolean(session));
  show('athlete-page', page === 'athletes');
  show('athlete-detail', page === 'athlete');
  show('athlete-new', page === 'athlete-new');
  show('scan-page', page === 'scan');
  show('join-page', page === 'join');
  show('result-page', page === 'attempt');
  show('onboarding', page === 'onboarding');
  show('history', timer && history.length > (session ? 0 : 1));
  const firstAttempt = $('attempts').firstElementChild;
  if (firstAttempt) firstAttempt.hidden = !session;
  $('timer-tab').setAttribute('aria-current', timer ? 'page' : 'false');
  $('athletes-tab').setAttribute('aria-current', page === 'athletes' ? 'page' : 'false');
  $('show-onboarding').disabled = Boolean(run);
  $('athletes-tab').disabled = Boolean(run);
  if (!session) return;
  text('room-title', start ? 'На старте' : 'На финише');
  text('room-code', session.code);
  const ready = paired && remoteReady && connected && stableClock(clock);
  const status = !connected ? 'Восстанавливаем связь…' : !paired ? 'Ждём второй телефон'
    : !clock ? 'Сверяем часы…' : !stableClock(clock) ? 'Связь слишком нестабильна для старта' : remoteReady ? 'Оба телефона готовы'
      : 'Связь есть · финиш ещё не готов';
  text('room-status', status);
  show('pairing', !paired);
  show('invite-image', Boolean(start && inviteQr));
  show('start-form', paired);
  $('room-status').classList.toggle('good', Boolean(ready));
  show('start-controls', start && !run && !result);
  const queue = currentSeries();
  const activeQueue = queue && queue.index < queue.athletes.length;
  const select = $('athlete');
  select.disabled = Boolean(activeQueue);
  if (activeQueue) {
    const name = queue.athletes[queue.index];
    if (![...select.options].some(item => item.value === name)) select.add(new Option(name, name));
    select.value = name;
  }
  show('series-clear', Boolean(queue));
  show('series-state', Boolean(queue));
  if (queue) text('series-state', activeQueue
    ? `Серия · попытка ${queue.index + 1} из ${queue.athletes.length}`
    : `Серия завершена · ${queue.athletes.length} попыток`);
  const flying = $('mode').value === 'flying';
  show('start-recording', start && !flying);
  show('start-preview', Boolean(startStream));
  $('start-record-button').disabled = openingStartCamera;
  $('start-record-button').setAttribute('aria-pressed', String(Boolean(startStream)));
  text('start-record-button', startStream ? 'Выключить запись старта' : 'Включить запись старта');
  show('finish-controls', (finish || (start && flying)) && !result);
  text('camera-instructions', start
    ? 'Поставь телефон сбоку на высоте груди. Совмести вертикаль со стартовой чертой.'
    : 'Поставь телефон сбоку на высоте груди. Совмести вертикаль с ближним краем финишной черты.');
  show('ready', finish);
  show('camera-button', !camera);
  show('camera-settings', Boolean(camera));
  $('line').disabled = $('direction').disabled = Boolean(run) || localReady;
  $('start-run').disabled = !ready || preparing || (flying && (!camera?.metrics().camera || checkingFinish));
  const touch = $('mode').value === 'touch';
  const sound = $('mode').value === 'sound';
  text('lead-label', sound ? 'Время на подготовку микрофона'
    : flying ? 'Пауза до включения засечки' : 'Пауза до первого сигнала');
  show('lead', !touch);
  show('lead-label', !touch);
  $('start-run').firstChild.textContent = touch || sound || flying ? 'Подготовить старт ' : 'Начать отсчёт ';
  show('touch-pad', Boolean(start && run?.armed && run.mode === 'touch' && run.go === null));
  $('ready').disabled = !camera?.metrics().camera || !connected || !stableClock(clock) || Boolean(run);
  $('check-finish').disabled = !camera?.metrics().camera || Boolean(run);
  text('check-finish', checkingFinish ? 'Отменить проверку' : 'Проверить проход');
  $('ready').firstChild.textContent = localReady ? 'Перенастроить финиш ' : 'Финиш готов ';
  show('running', Boolean(run));
  show('result', Boolean(result));
  if (!result) return;
  text('result-label', [`${result.distance} М`, result.athlete,
    result.series && `${result.series.index + 1}/${result.series.total}`].filter(Boolean).join(' · '));
  text('result-time', `${format(result.duration)} с`);
  const kind = result.audio === 'sound' ? 'Оценка · микрофон требует калибровки'
    : result.camera === 'presentation' || result.startCamera === 'presentation' || result.audio === 'estimated'
    ? 'Оценка · браузер подставил запасную метку' : 'Тренировочный замер · нужна калибровка телефонов';
  text('result-quality', kind);
  show('finish-evidence', Boolean(photo));
  if (photo) {
    $('photo-before').src = photo[0];
    $('photo-after').src = photo[1];
  }
}

function attemptButton(item, area) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'attempt-row';
  button.id = `attempt-${area}-${item.id}`;
  const label = document.createElement('span');
  const title = document.createElement('b');
  const date = document.createElement('small');
  const time = document.createElement('strong');
  const arrow = document.createElement('span');
  arrow.className = 'row-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '›';
  title.textContent = [`${item.distance} м`, area !== 'athlete' && item.athlete].filter(Boolean).join(' · ');
  date.textContent = new Date(item.date).toLocaleDateString('ru');
  label.append(title, date);
  time.textContent = `${format(item.duration)} с`;
  button.append(label, time, arrow);
  button.onclick = () => navigate('attempt', item.id, { returnFocus: button.id });
  return button;
}

function attemptRow(item, area) {
  const row = document.createElement('li');
  row.append(attemptButton(item, area));
  return row;
}

async function openReplay(id) {
  const item = history.find(entry => entry.id === id) || (result?.id === id ? result : null);
  const view = { urls: [] };
  replayView = view;
  text('result-title', item?.athlete ? `${item.athlete} / Попытка` : 'Попытка');
  show('attempt-duration', Boolean(item));
  show('attempt-facts', Boolean(item));
  show('replay-heading', Boolean(item));
  if (!item) {
    text('replay-status', 'Этой попытки нет на этом телефоне.');
    return;
  }
  text('attempt-duration', `${format(item.duration)} с`);
  const startModes = {
    countdown: 'Обратный отсчёт', random: 'Команды с паузой', touch: 'Касание',
    sound: 'Внешний звук', flying: 'С ходу',
  };
  const facts = [
    ['Дистанция', `${item.distance} м`],
    ['Дата', new Date(item.date).toLocaleString('ru', { dateStyle: 'medium', timeStyle: 'short' })],
    ['Старт', startModes[item.mode]],
    ['Интервал кадров на старте', item.startFrameMs && `${Math.round(item.startFrameMs)} мс`],
    ['Интервал кадров на финише', item.frameMs && `${Math.round(item.frameMs)} мс`],
  ];
  $('attempt-facts').replaceChildren(...facts.filter(([, value]) => value).map(([name, value]) => {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = name;
    description.textContent = value;
    row.append(term, description);
    return row;
  }));
  $('replays').replaceChildren();
  text('replay-status', 'Открываем запись…');
  try {
    await replayWrites.get(item.id);
    const clips = await Promise.all(['start', 'finish'].map(role => loadReplay(item.id, role)));
    if (replayView !== view) return;
    for (const clip of clips.filter(Boolean)) {
      const block = document.createElement('section');
      const title = document.createElement('h3');
      title.textContent = clip.role === 'start' ? 'Старт' : 'Финиш';
      block.append(title);
      if (clip.video) {
        const url = URL.createObjectURL(clip.video);
        view.urls.push(url);
        const video = document.createElement('video');
        Object.assign(video, { controls: true, playsInline: true, preload: 'metadata', src: url });
        block.append(video);
      }
      if (clip.photos?.length) {
        const grid = document.createElement('div');
        grid.className = 'evidence';
        clip.photos.forEach((src, index) => {
          const figure = document.createElement('figure');
          const caption = document.createElement('figcaption');
          caption.textContent = index ? 'После линии' : 'До линии';
          const image = new Image();
          Object.assign(image, { src, alt: caption.textContent });
          figure.append(image, caption);
          grid.append(figure);
        });
        block.append(grid);
      }
      $('replays').append(block);
    }
    text('replay-status', clips.some(Boolean) ? '' : 'На этом телефоне запись недоступна.');
  } catch {
    if (replayView === view) text('replay-status', 'Не удалось открыть запись на этом телефоне.');
  }
}

function closeReplay() {
  $('replays').replaceChildren();
  replayView?.urls.forEach(url => URL.revokeObjectURL(url));
  replayView = null;
}

$('result-close').onclick = () => {
  const athlete = history.find(item => item.id === route.value)?.athlete;
  goBack(athlete ? 'athlete' : 'timer', athlete || undefined);
};
$('current-result').onclick = () => {
  if (result) navigate('attempt', result.id, { returnFocus: 'current-result' });
};

function knownAthletes() {
  return [...new Set([...athletes, ...history.map(item => item.athlete).filter(Boolean)])]
    .sort((a, b) => a.localeCompare(b, 'ru'));
}

function renderAthleteResults() {
  const all = athleteDetail ? history.filter(item => item.athlete === athleteDetail) : [];
  const order = $('result-order').value;
  const distance = $('result-distance').value;
  const entries = all.filter(item => !distance || String(item.distance) === distance);
  if (order !== 'recent') {
    entries.sort((a, b) => a.distance - b.distance
      || (order === 'best' ? a.duration - b.duration : b.duration - a.duration));
  }
  text('athlete-title', athleteDetail ? `${athleteDetail} / Результаты` : 'Результаты');
  const rows = entries.flatMap((item, index) => {
    const row = attemptRow(item, 'athlete');
    if (order === 'recent' || distance || item.distance === entries[index - 1]?.distance) return [row];
    const group = document.createElement('li');
    group.className = 'result-group';
    group.textContent = `${item.distance} м`;
    return [group, row];
  });
  $('athlete-results').replaceChildren(...rows);
  show('result-filters', all.length > 0);
  text('athlete-empty', all.length ? 'На этой дистанции пока нет результатов' : 'Пока нет результатов');
  show('athlete-empty', entries.length === 0);
  show('athlete-results', entries.length > 0);
}

$('result-order').onchange = $('result-distance').onchange = renderAthleteResults;

function renderHistory() {
  const names = knownAthletes();
  const startSelect = $('athlete');
  const selected = startSelect.value;
  startSelect.replaceChildren(new Option('Без имени', ''), ...names.map(name => new Option(name, name)));
  startSelect.value = names.includes(selected) ? selected : '';
  $('athlete-list').replaceChildren(...names.map(name => {
    const row = document.createElement('li');
    const openAthlete = document.createElement('button');
    openAthlete.type = 'button';
    openAthlete.id = `open-athlete-${encodeURIComponent(name)}`;
    openAthlete.className = 'athlete-row';
    const arrow = document.createElement('span');
    arrow.className = 'row-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '›';
    openAthlete.append(name, arrow);
    openAthlete.onclick = () => navigate('athlete', name, { returnFocus: openAthlete.id });
    row.append(openAthlete);
    return row;
  }));
  show('athlete-list', names.length > 0);
  show('athlete-list-empty', names.length === 0);
  $('attempts').replaceChildren(...history.slice(0, 8).map(item => attemptRow(item, 'history')));
  $('latest-attempt').replaceChildren(...(history.length ? [attemptButton(history[0], 'latest')] : []));
  show('latest', history.length > 0);
  renderAthleteResults();
}

$('athlete-back').onclick = () => goBack('athletes');
$('athlete-add').onclick = () => {
  $('athlete-form').reset();
  show('athlete-feedback', false);
  $('athlete-name').removeAttribute('aria-invalid');
  navigate('athlete-new', undefined, { returnFocus: 'athlete-add' });
};
$('athlete-close').onclick = () => goBack('athletes');
$('athlete-form').onsubmit = event => {
  event.preventDefault();
  const field = $('athlete-name');
  const name = field.value.trim().slice(0, 40);
  const existing = knownAthletes().find(item => item.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'));
  if (!name || existing) {
    text('athlete-feedback', existing ? 'Это имя уже в списке.' : 'Введи имя.');
    show('athlete-feedback', true);
    field.setAttribute('aria-invalid', 'true');
    field.focus();
    return;
  }
  athletes = [...athletes, name];
  save(localStorage, athletesKey, athletes);
  renderHistory();
  $('athlete').value = name;
  navigate('athlete', name, { replace: true });
};
$('athlete-name').oninput = () => {
  show('athlete-feedback', false);
  $('athlete-name').removeAttribute('aria-invalid');
};

$('brand').onclick = event => { event.preventDefault(); navigate('timer'); };
$('timer-tab').onclick = () => navigate('timer');
$('athletes-tab').onclick = () => navigate('athletes');

$('export').onclick = () => {
  const columns = ['date', 'athlete', 'distance', 'duration', 'mode', 'syncMs', 'frameMs', 'audio', 'camera',
    'startCamera', 'startFrameMs', 'seriesId', 'seriesAttempt', 'seriesTotal',
    'id', 'role', 'startRttMs', 'finishRttMs', 'finishToServerMs', 'resultArrivalMs'];
  const cell = value => {
    const raw = String(value ?? '');
    const safe = /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const rows = history.map(entry => ({ ...entry, seriesId: entry.series?.id, seriesTotal: entry.series?.total,
    seriesAttempt: entry.series ? entry.series.index + 1 : undefined }));
  const csv = [columns.join(','), ...rows.map(entry => columns.map(key => cell(entry[key])).join(','))].join('\r\n');
  const href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  Object.assign(document.createElement('a'), { href, download: 'stvor-results.csv' }).click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
};
$('create').onclick = () => requestSession('create');
$('copy-invite').onclick = async () => {
  const code = session?.code;
  if (!code) return;
  const url = new URL('/', location.href);
  url.hash = `finish=${code}`;
  try {
    await navigator.clipboard.writeText(url.href);
    if (session?.code === code) text('copy-invite', 'Ссылка скопирована');
  } catch {
    notice('Не удалось скопировать ссылку. Используй QR или код подключения.');
  }
};

function joinError(message) {
  text('join-error', message);
  show('join-error', Boolean(message));
  $('join-code').setAttribute('aria-invalid', String(Boolean(message)));
}

function openCodeEntry() {
  if (route.page === 'join') $('join-code').focus();
  else navigate('join', undefined, { focus: 'join-code', returnFocus: 'scan-manual' });
}

$('join-code').oninput = () => joinError('');
$('join-form').onsubmit = event => {
  event.preventDefault();
  const code = $('join-code').value.trim().toUpperCase();
  if (!validCode.test(code)) return joinError('Введи восемь символов кода с первого телефона.');
  joinError('');
  requestSession('join', code);
};
$('leave').onclick = leave;
$('scan-qr').onclick = () => navigate('scan', undefined, { returnFocus: 'scan-qr' });
async function startScanner() {
  const controller = new AbortController();
  scanController = controller;
  text('scan-status', 'Наведи камеру на QR-код стартового телефона.');
  try {
    const { scanInvitation } = await import('./scanner.mjs');
    if (controller.signal.aborted) return;
    await scanInvitation($('scan-video'), controller.signal, code => {
      $('join-code').value = code;
      joinError('');
      text('scan-status', 'Подключаем финиш…');
      requestSession('join', code);
    });
  } catch {
    if (!controller.signal.aborted) text('scan-status', 'Камера недоступна. Введи код вручную.');
  }
}
$('scan-close').onclick = () => goBack();
$('scan-manual').onclick = openCodeEntry;
$('join-back').onclick = () => goBack();

$('start-form').onsubmit = startRun;
$('series-apply').onclick = applySeries;
$('series-clear').onclick = () => { saveSeries(null); render(); };
$('mode').onchange = () => {
  if ($('mode').value === 'flying') stopStartPreview();
  if ($('mode').value !== 'flying') {
    cameraGeneration += 1;
    camera?.stop();
    camera = null;
    checkingFinish = false;
    $('camera-button').disabled = false;
  }
  render();
};
const pad = $('touch-pad');
pad.onpointerdown = event => {
  if (event.isPrimary && event.button === 0) pad.setPointerCapture(event.pointerId);
};
pad.onpointerup = event => {
  if (pad.hasPointerCapture(event.pointerId)) releaseFromPad(event);
};
pad.onkeydown = event => {
  if (event.key === ' ') event.preventDefault();
};
pad.onkeyup = event => {
  if (event.key === ' ') releaseFromPad(event);
};
$('camera-button').onclick = startCamera;
$('line').oninput = () => { $('finish-line').style.left = `${$('line').value}%`; };
$('ready').onclick = () => {
  checkingFinish = false;
  notice('');
  localReady = !localReady;
  send({ type: 'ready', ready: localReady });
  void stayAwake();
  render();
};
$('check-finish').onclick = () => {
  checkingFinish = !checkingFinish;
  if (checkingFinish && localReady) {
    localReady = false;
    send({ type: 'ready', ready: false });
  }
  notice(checkingFinish ? 'Пройди через линию в выбранном направлении.' : '');
  render();
};
$('cancel').onclick = () => {
  if (!run) return;
  if (!send({ type: 'cancel', id: run.id })) {
    resetRun();
    notice('Отменено на этом телефоне. Второй телефон получит тайм-аут.');
    render();
  }
};
$('again').onclick = () => {
  const queue = currentSeries();
  if (result?.series?.id === queue?.id && queue?.voice && window.speechSynthesis) {
    const next = queue.athletes[queue.index];
    const utterance = new SpeechSynthesisUtterance(next ? `Следующий участник: ${next}`
      : queue.index < queue.athletes.length ? `Следующая попытка: ${queue.index + 1}` : 'Серия завершена');
    utterance.lang = 'ru-RU';
    speechSynthesis.speak(utterance);
  }
  photo = result = null;
  notice('');
  render();
  if (camera) $('camera').play().catch(() => notice('Камера на паузе. Повтори настройку финиша.'));
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && session) void stayAwake();
  if (document.hidden && run && !pending) {
    send({ type: 'cancel', id: run.id });
    resetRun();
    notice('Экран был скрыт. Запусти попытку заново.');
    render();
  }
});
const onboarding = [
  ['start', 'Создай старт', 'На первом телефоне нажми «Создать старт». На экране появится QR-код.'],
  ['connect', 'Подключи финиш', 'На втором телефоне отсканируй QR из «Створа». Телефоны могут быть в разных сетях.'],
  ['finish', 'Сделай замер', 'Совмести вертикаль в камере с финишной чертой. Отметь готовность финиша, затем запусти отсчёт.'],
];

function renderOnboarding() {
  const [photo, title, copy] = onboarding[onboardingStep];
  $('onboarding-photo').src = `/photos/${photo}.webp`;
  text('onboarding-step', `${onboardingStep + 1} / ${onboarding.length}`);
  text('onboarding-title', title);
  text('onboarding-copy', copy);
  text('onboarding-next', onboardingStep === onboarding.length - 1 ? 'К замеру' : 'Далее');
}

$('show-onboarding').onclick = () => navigate('onboarding', '0');
function dismissOnboarding() {
  save(localStorage, onboardingKey, true);
  goBack();
}
$('onboarding-back').onclick = () => {
  if (onboardingStep > 0) navigate('onboarding', String(onboardingStep - 1), { replace: true });
  else dismissOnboarding();
};
$('onboarding-skip').onclick = dismissOnboarding;
$('onboarding-next').onclick = () => {
  if (onboardingStep + 1 === onboarding.length) dismissOnboarding();
  else navigate('onboarding', String(onboardingStep + 1), { replace: true });
};

if (session) connect();
renderHistory();
const firstRoute = readRoute();
if (!location.hash && !session && !load(localStorage, onboardingKey, false)) {
  navigate('onboarding', '0', { replace: true });
} else {
  applyRoute(firstRoute);
}
