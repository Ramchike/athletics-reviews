import { clockSample, estimateClock } from './timing.mjs';

const $ = id => document.getElementById(id);
const show = (id, visible) => { $(id).hidden = !visible; };
const text = (id, value) => { $(id).textContent = value; };
const storageKey = 'stvor-session';
const historyKey = 'stvor-results';
const seriesKey = 'stvor-series';
const load = (storage, key, fallback) => {
  try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const save = (storage, key, value) => {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing or storage quota. */ }
};
const format = value => (value / 1000).toFixed(2).replace('.', ',');
const inviteCode = new URLSearchParams(location.hash.slice(1)).get('finish') ?? '';

let session = inviteCode ? null : load(sessionStorage, storageKey, null);
let history = load(localStorage, historyKey, []);
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
let checkingFinish = false;
let photo;
let audio;
let microphone;
let preparing = false;
let tones = [];
let reportTimer;
let frame;
let wake;

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
      notice('Сервер недоступен. Проверь интернет и попробуй снова.');
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
  photo = result = intent = session = null;
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
  if (location.hash) window.history.replaceState(null, '', location.pathname);
  wake?.release().catch(() => {});
  wake = null;
  notice('');
  render();
}

function onMessage(message, receivedAt) {
  switch (message.type) {
    case 'session': {
      const { code, role, token } = message;
      intent = null;
      session = { code, role, token };
      save(sessionStorage, storageKey, session);
      if (inviteCode && location.hash) window.history.replaceState(null, '', location.pathname);
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
      if (run && message.run?.id !== run.id) resetRun();
      if (run?.go === null && message.run?.startEvent) acceptStart(message.run.startEvent.t);
      if (pending && message.run?.id === pending.id) send(pending);
      if (message.result) displayResult(message.result);
      break;
    }
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
      if (!stableClock(clock) || document.hidden
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
      if (session.role === 'finish') {
        const id = run.id;
        $('camera').play().then(() => {
          if (run?.id === id) send({ type: 'armed', id });
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
      if (run?.id === message.id && !run.armed) {
        run.armed = true;
        if (session.role === 'start' && run.mode === 'sound') microphone?.arm(run);
        if (session.role === 'start' && run.go !== null) playStart();
      }
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
      notice(message.text);
      break;
  }
  render();
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
        runId: checkingFinish ? 'check-finish' : run?.armed && !pending ? run.id : null,
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
        text('camera-metrics', [
          metrics.fps && `${metrics.fps} кадр/с обработано`,
          metrics.camera === 'capture' ? 'метки камеры' : 'метки показа кадра',
          metrics.point ? 'туловище видно · оранжевая точка' : 'поза не видна',
        ].filter(Boolean).join(' · '));
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

function render() {
  const start = session?.role === 'start';
  const finish = session?.role === 'finish';
  const clock = sync();
  const connected = socket?.readyState === WebSocket.OPEN;
  show('home', !session);
  show('room', Boolean(session));
  if (!session) return;
  text('room-role', start ? 'ТЕЛЕФОН СТАРТА' : 'ТЕЛЕФОН ФИНИША');
  text('room-title', start ? 'На старте' : 'На финише');
  text('room-code', session.code);
  const ready = paired && remoteReady && connected && stableClock(clock);
  const status = !connected ? 'Восстанавливаем связь…' : !paired ? 'Ждём второй телефон'
    : !clock ? 'Сверяем часы…' : !stableClock(clock) ? 'Связь слишком нестабильна для старта' : remoteReady ? 'Оба телефона готовы'
      : 'Связь есть · финиш ещё не готов';
  text('room-status', status);
  $('room-status').classList.toggle('good', Boolean(ready));
  text('diagnostics', clock ? `RTT до сервера · ${Math.round(clock.rtt)} мс` : '');
  show('start-controls', start && !run && !result);
  const queue = currentSeries();
  const activeQueue = queue && queue.index < queue.athletes.length;
  $('athlete').readOnly = Boolean(activeQueue);
  if (activeQueue) $('athlete').value = queue.athletes[queue.index];
  show('series-clear', Boolean(queue));
  show('series-state', Boolean(queue));
  if (queue) text('series-state', activeQueue
    ? `Серия · попытка ${queue.index + 1} из ${queue.athletes.length}`
    : `Серия завершена · ${queue.athletes.length} попыток`);
  const flying = $('mode').value === 'flying';
  show('finish-controls', (finish || (start && flying)) && !result);
  text('camera-instructions', start
    ? 'Поставь телефон сбоку на линии старта. Выставь вертикаль и выбери направление движения.'
    : 'Поставь телефон сбоку, на продолжении финишной черты, примерно на высоте груди. Совмести ближний край разметки со светлой вертикалью. Оставь в кадре одну дорожку.');
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
  text('result-quality', `${kind}. Часы ≈ ${Math.ceil(result.syncMs)} мс, интервал кадров ${Math.round(result.frameMs)} мс.`);
  show('finish-evidence', Boolean(photo));
  if (photo) {
    $('photo-before').src = photo[0];
    $('photo-after').src = photo[1];
  }
}

function renderHistory() {
  show('history', history.length > 0);
  const names = [...new Set(history.map(item => item.athlete).filter(Boolean))];
  $('athletes').replaceChildren(...names.map(name => Object.assign(document.createElement('option'), { value: name })));
  $('attempts').replaceChildren(...history.slice(0, 8).map(item => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    const time = document.createElement('strong');
    label.textContent = [item.athlete, `${item.distance} м`, new Date(item.date).toLocaleDateString('ru')].filter(Boolean).join(' · ');
    time.textContent = `${format(item.duration)} с`;
    row.append(label, time);
    return row;
  }));
}

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
$('join-form').onsubmit = event => {
  event.preventDefault();
  const code = $('join-code').value.trim().toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(code)) return notice('Введи восемь символов кода комнаты.');
  requestSession('join', code);
};
$('leave').onclick = leave;
$('share').onclick = async () => {
  const url = new URL(location.pathname, location.origin);
  url.hash = new URLSearchParams({ finish: session.code });
  try { await navigator.clipboard.writeText(url.href); notice('Ссылка на финиш скопирована.'); }
  catch { notice(`Открой адрес на втором телефоне: ${url.href}`); }
};
$('start-form').onsubmit = startRun;
$('series-apply').onclick = applySeries;
$('series-clear').onclick = () => { saveSeries(null); render(); };
$('mode').onchange = () => {
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
if (/^[0-9A-F]{8}$/.test(inviteCode)) $('join-code').value = inviteCode;
if (session) connect();
renderHistory();
render();
