const maxClips = 24;
const maxDuration = 45_000;
let database;

function recordings() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('stvor-recordings', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('clips', { keyPath: ['id', 'role'] }).createIndex('date', 'date');
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch(error => {
    database = null;
    throw error;
  });
  return database;
}

export function recordAttempt(stream) {
  if (!window.MediaRecorder || !stream?.getVideoTracks().some(track => track.readyState === 'live')) return;
  try {
    const mimeType = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, { videoBitsPerSecond: 1_200_000, ...(mimeType && { mimeType }) });
    const chunks = [];
    let timeout;
    const clip = new Promise(resolve => {
      recorder.ondataavailable = event => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        clearTimeout(timeout);
        const type = recorder.mimeType || chunks[0]?.type;
        resolve(chunks.length ? new Blob(chunks, { type }) : null);
      };
      recorder.onerror = () => {
        clearTimeout(timeout);
        resolve(null);
      };
    });
    const stop = () => {
      clearTimeout(timeout);
      if (recorder.state !== 'inactive') recorder.stop();
      return clip;
    };
    recorder.start();
    timeout = setTimeout(stop, maxDuration);
    return stop;
  } catch {
    return undefined;
  }
}

export async function storeReplay({ id, role, photos, video }) {
  if (!photos?.length && !video?.size) return;
  const db = await recordings();
  const transaction = db.transaction('clips', 'readwrite');
  const clips = transaction.objectStore('clips');
  clips.put({ id, role, photos, video, date: Date.now() });
  const cursor = clips.index('date').openCursor(null, 'prev');
  let count = 0;
  cursor.onsuccess = () => {
    if (!cursor.result) return;
    if (++count > maxClips) cursor.result.delete();
    cursor.result.continue();
  };
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function loadReplay(id, role) {
  const db = await recordings();
  return new Promise((resolve, reject) => {
    const request = db.transaction('clips').objectStore('clips').get([id, role]);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
