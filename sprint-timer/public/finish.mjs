import { FilesetResolver, PoseLandmarker } from './vendor/vision_bundle.mjs';
import { crossing, torsoPoint } from './timing.mjs';

function markCrossing(context, line, point) {
  const { width, height } = context.canvas;
  context.fillStyle = '#e5fa78';
  context.fillRect(line * width - 1, 0, 2, height);
  context.beginPath();
  context.arc(point.x * width, point.y * height, 5, 0, Math.PI * 2);
  context.fillStyle = '#fa8d69';
  context.fill();
}

export async function watchFinish(video, handlers) {
  if (!navigator.mediaDevices?.getUserMedia || !video.requestVideoFrameCallback) {
    throw new Error('Для камеры открой HTTPS в браузере с поддержкой захвата кадров.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, frameRate: { ideal: 60 } },
    audio: false,
  });
  let model;
  try {
    video.srcObject = stream;
    await video.play();
    const files = await FilesetResolver.forVisionTasks('/vendor/wasm');
    model = await PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: '/pose.task' },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    throw error;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const priorFrame = document.createElement('canvas');
  const priorContext = priorFrame.getContext('2d');
  let previous;
  let frameId;
  let latest = {};
  let active = true;
  let captureMode;
  let lastArmed;
  let lastMetricsAt = -Infinity;
  let framesSinceMetrics = 0;

  const next = (now, metadata) => {
    if (!active) return;
    frameId = video.requestVideoFrameCallback(next);
    const hasCapture = Number.isFinite(metadata.captureTime);
    const camera = hasCapture ? 'capture' : 'presentation';
    const t = hasCapture ? metadata.captureTime : metadata.presentationTime;
    if (!Number.isFinite(t)) return;
    const config = handlers.config();
    if (captureMode !== camera || config.runId !== lastArmed) previous = null;
    captureMode = camera;
    lastArmed = config.runId;
    if (t <= (previous?.t ?? -Infinity)) return;
    try {
      const width = Math.min(640, video.videoWidth);
      const height = Math.round(width * video.videoHeight / video.videoWidth);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.drawImage(video, 0, 0, width, height);
      const began = performance.now();
      const pose = model.detectForVideo(canvas, now).landmarks[0];
      const modelMs = performance.now() - began;
      const point = pose ? torsoPoint(pose, config.direction) : null;
      latest = { ...latest, camera, modelMs, point };
      handlers.position?.(point);
      framesSinceMetrics += 1;
      if (now - lastMetricsAt >= 450) {
        latest.fps = Math.round(framesSinceMetrics * 1000 / (now - lastMetricsAt)) || null;
        lastMetricsAt = now;
        framesSinceMetrics = 0;
        handlers.metrics(latest);
      }
      if (!point || !config.runId || t < config.go) {
        previous = null;
        return;
      }
      const after = { t, x: point.x, y: point.y };
      const crossed = crossing(previous, after, config.line, config.direction);
      if (crossed !== null) {
        markCrossing(priorContext, config.line, previous);
        markCrossing(ctx, config.line, point);
        handlers.crossed({ t: crossed, camera, frameMs: t - previous.t,
          photos: [priorFrame.toDataURL('image/jpeg', 0.78), canvas.toDataURL('image/jpeg', 0.78)] });
      } else if ((point.x - config.line) * config.direction < 0) {
        if (priorFrame.width !== width || priorFrame.height !== height) {
          priorFrame.width = width;
          priorFrame.height = height;
        }
        priorContext.drawImage(canvas, 0, 0);
      }
      previous = after;
    } catch {
      stop();
      handlers.failed('Обработка кадров остановилась. Включи камеру заново.');
    }
  };

  function stop() {
    if (!active) return;
    active = false;
    video.cancelVideoFrameCallback(frameId);
    stream.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    model.close();
  }

  for (const track of stream.getVideoTracks()) {
    track.addEventListener('ended', () => {
      if (!active) return;
      stop();
      handlers.failed('Камера отключилась. Включи её заново.');
    });
  }
  frameId = video.requestVideoFrameCallback(next);
  return { stop, metrics: () => latest };
}
