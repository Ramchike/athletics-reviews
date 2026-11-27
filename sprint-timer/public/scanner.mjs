import './vendor/jsQR.js';

export async function scanInvitation(video, signal, onCode) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } }, audio: false,
  });
  let frame;
  function stop() {
    cancelAnimationFrame(frame);
    stream.getTracks().forEach(track => track.stop());
    if (video.srcObject === stream) video.srcObject = null;
  }
  if (signal.aborted) return stop();
  signal.addEventListener('abort', stop, { once: true });
  try {
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    let last = -Infinity;
    function scan(now) {
      if (signal.aborted) return;
      frame = requestAnimationFrame(scan);
      if (video.readyState < 2 || now - last < 100) return;
      last = now;
      canvas.width = Math.min(640, video.videoWidth);
      canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      const qr = self.jsQR(data.data, data.width, data.height, { inversionAttempts: 'dontInvert' });
      if (!qr) return;
      let url;
      try { url = new URL(qr.data); } catch { return; }
      const code = new URLSearchParams(url.hash.slice(1)).get('finish');
      if (url.origin === location.origin && url.pathname === '/' && /^[0-9A-F]{8}$/.test(code ?? '')) {
        stop();
        onCode(code);
      }
    }
    frame = requestAnimationFrame(scan);
  } catch (error) {
    stop();
    throw error;
  }
}
