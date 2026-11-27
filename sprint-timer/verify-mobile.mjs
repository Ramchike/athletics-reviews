import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createTimerServer } from './server.mjs';

const { STVOR_URL, STVOR_CHROME, STVOR_PLAYWRIGHT = 'playwright', STVOR_CAMERA, STVOR_SCREENSHOTS } = process.env;
if (!STVOR_CAMERA || !STVOR_SCREENSHOTS) throw new Error('Set STVOR_CAMERA (.y4m) and STVOR_SCREENSHOTS (output directory).');
const { chromium } = await import(STVOR_PLAYWRIGHT);
await mkdir(STVOR_SCREENSHOTS, { recursive: true });
const browser = await chromium.launch({
  executablePath: STVOR_CHROME,
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${resolve(STVOR_CAMERA)}`,
    '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'],
});
const server = STVOR_URL ? null : createTimerServer().listen(0, '127.0.0.1');
try {
  if (server && !server.listening) await once(server, 'listening');
  const base = STVOR_URL || `http://127.0.0.1:${server.address().port}`;
  const settings = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ['camera'] };
  const start = await browser.newPage(settings);
  const finish = await browser.newPage(settings);
  const errors = [];
  for (const page of [start, finish]) page.on('pageerror', error => errors.push(error.message));
  const shot = (page, name) => page.screenshot({ path: resolve(STVOR_SCREENSHOTS, `${name}.png`), animations: 'disabled' });
  const tap = (page, id) => page.locator(`#${id}`).tap();
  const ensureFits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await start.goto(base);
  for (const [index, title] of ['Создай старт', 'Подключи финиш', 'Сделай замер'].entries()) {
    await start.getByRole('heading', { name: title, exact: true }).waitFor();
    await shot(start, `0${index + 1}-onboarding`);
    await tap(start, 'onboarding-next');
  }
  await start.reload();
  assert.equal(await start.locator('#onboarding').isVisible(), false);
  await shot(start, '04-home');
  await tap(start, 'athletes-tab');
  await start.setViewportSize({ width: 320, height: 460 });
  await tap(start, 'athlete-add');
  const name = start.locator('#athlete-name');
  assert.equal(await name.evaluate(element => document.activeElement === element), true);
  await name.pressSequentially('Рамир');
  assert.equal(await name.inputValue(), 'Рамир');
  assert.equal(await name.evaluate(element => getComputedStyle(element).fontSize), '16px');
  assert.ok(await ensureFits(start));
  await shot(start, '05-athlete-form-320');
  await name.press('Enter');
  await start.getByRole('heading', { name: 'Рамир / Результаты' }).waitFor();
  await tap(start, 'athlete-back');
  await tap(start, 'athlete-add');
  await name.fill('рамир');
  await name.press('Enter');
  await start.getByText('Это имя уже в списке.').waitFor();
  await tap(start, 'athlete-close');
  assert.equal(await start.locator('.athlete-row').count(), 1);
  await start.setViewportSize({ width: 390, height: 844 });
  await shot(start, '06-athletes');
  await tap(start, 'timer-tab');

  const create = start.locator('#create');
  const box = await create.boundingBox();
  assert.ok(box.height >= 44 && box.width >= 44);
  await start.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await start.mouse.down();
  await start.waitForFunction(() => getComputedStyle(document.querySelector('#create')).transform !== 'none');
  await start.mouse.up();
  await start.locator('#invite-image').waitFor();
  const code = await start.locator('#room-code').textContent();
  const qr = await start.locator('#invite-image').getAttribute('src');
  assert.equal(await start.locator('#start-form').isVisible(), false);
  await shot(start, '07-invite');

  const manual = await browser.newPage({ ...settings, viewport: { width: 320, height: 420 }, reducedMotion: 'reduce' });
  await manual.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await manual.goto(base);
  await tap(manual, 'onboarding-skip');
  await tap(manual, 'scan-qr');
  await manual.getByText('Камера недоступна. Введи код вручную.').waitFor();
  assert.equal(await manual.locator('#scan-dialog').evaluate(el => getComputedStyle(el).animationName), 'none');
  await tap(manual, 'scan-manual');
  const field = manual.locator('#join-code');
  assert.equal(await field.evaluate(element => document.activeElement === element), true);
  await field.fill('AAAA');
  await field.press('Enter');
  await manual.getByText('Введи восемь символов кода с первого телефона.').waitFor();
  assert.ok(await ensureFits(manual));
  await shot(manual, '08-manual-code-320');
  await manual.goto(`${base}/#finish=${code}`);
  await manual.reload();
  assert.equal(await field.inputValue(), code);
  await field.press('Enter');
  await manual.getByRole('heading', { name: 'На финише' }).waitFor();
  await tap(manual, 'leave');
  await manual.close();
  await start.getByText('Ждём второй телефон').waitFor();

  await finish.goto(base);
  await tap(finish, 'onboarding-skip');
  await finish.evaluate(qr => {
    const realCamera = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async () => {
      navigator.mediaDevices.getUserMedia = realCamera;
      const image = new Image();
      image.src = qr;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 480;
      const ctx = canvas.getContext('2d');
      const paint = () => {
        ctx.fillStyle = '#fbfbf8';
        ctx.fillRect(0, 0, 480, 480);
        if (window.testShowQr) ctx.drawImage(image, 72, 72, 336, 336);
      };
      paint();
      const capture = canvas.captureStream(12);
      const interval = setInterval(paint, 70);
      const [track] = capture.getVideoTracks();
      const stop = track.stop.bind(track);
      track.stop = () => { clearInterval(interval); stop(); };
      return capture;
    };
  }, qr);
  await tap(finish, 'scan-qr');
  await finish.waitForFunction(() => document.querySelector('#scan-video').readyState >= 2);
  await shot(finish, '09-scanner');
  await finish.evaluate(() => { window.testShowQr = true; });
  await finish.getByRole('heading', { name: 'На финише' }).waitFor();
  assert.equal(await finish.locator('#room-code').textContent(), code);
  await tap(finish, 'camera-button');
  await finish.waitForFunction(() => !document.querySelector('#ready').disabled, undefined, { timeout: 35_000 });
  await finish.locator('#direction').selectOption('-1');
  await tap(finish, 'ready');
  await start.locator('#athlete').selectOption('Рамир');
  await start.locator('#start-form').getByText('100 м', { exact: true }).tap();
  await tap(start, 'start-record-button');
  await start.waitForFunction(() => document.querySelector('#start-preview').readyState >= 2);
  await tap(start, 'start-run');
  await start.waitForFunction(() => !document.querySelector('#result').hidden, undefined, { timeout: 25_000 });
  await finish.waitForFunction(() => !document.querySelector('#result').hidden);
  const time = await finish.locator('#result-time').textContent();
  assert.equal(await start.locator('#result-time').textContent(), time);
  assert.match(await start.locator('#result-label').textContent(), /100 М · Рамир/);
  assert.equal(await finish.locator('#finish-evidence').isVisible(), true);

  for (const [page, role] of [[start, 'Старт'], [finish, 'Финиш']]) {
    await tap(page, 'current-result');
    await page.locator('#replays').getByRole('heading', { name: role }).waitFor();
    await page.waitForFunction(() => document.querySelector('#replays video')?.readyState >= 2);
    const video = page.locator('#replays video');
    assert.ok(await video.evaluate(async el => {
      await el.play();
      return el.videoWidth > 0 && el.duration > 0;
    }));
    await video.evaluate(el => new Promise(resolve => {
      el.pause();
      el.addEventListener('seeked', resolve, { once: true });
      el.currentTime = Math.max(0, el.duration - 0.4);
    }));
    await shot(page, role === 'Старт' ? '10-replay-start' : '11-replay-finish');
    await tap(page, 'result-close');
  }

  await finish.reload();
  await tap(finish, 'athletes-tab');
  await finish.getByRole('button', { name: 'Рамир', exact: true }).tap();
  await finish.locator('#athlete-results .attempt-row').tap();
  await finish.waitForFunction(() => document.querySelector('#replays video')?.readyState >= 2);
  assert.equal(await finish.locator('#replays figure').count(), 2);
  await tap(finish, 'result-close');

  await start.evaluate(() => {
    const existing = JSON.parse(localStorage.getItem('stvor-results'));
    const extra = [[60, 8000], [60, 7500], [100, 12100], [100, 13800]].map(([distance, duration], index) => ({
      ...existing[0], id: `fixture-${index}`, distance, duration,
      date: new Date(Date.now() - (index + 1) * 86400000).toISOString(),
    }));
    localStorage.setItem('stvor-results', JSON.stringify([...existing, ...extra]));
  });
  await start.reload();
  await tap(start, 'athletes-tab');
  await start.getByRole('button', { name: 'Рамир', exact: true }).tap();
  const results = start.locator('#athlete-results');
  await start.locator('#result-distance').selectOption('60');
  await start.locator('#result-order').selectOption('best');
  assert.deepEqual(await results.locator('.attempt-row strong').allTextContents(), ['7,50 с', '8,00 с']);
  await start.locator('#result-order').selectOption('worst');
  assert.deepEqual(await results.locator('.attempt-row strong').allTextContents(), ['8,00 с', '7,50 с']);
  await results.locator('.attempt-row').first().tap();
  await start.getByText('На этом телефоне запись недоступна.').waitFor();
  await tap(start, 'result-close');
  await start.locator('#result-distance').selectOption('');
  await start.locator('#result-order').selectOption('best');
  assert.deepEqual(await start.locator('.result-group').allTextContents(), ['60 м', '100 м']);
  await shot(start, '12-results');
  await start.setViewportSize({ width: 430, height: 932 });
  assert.ok(await ensureFits(start));
  await shot(start, '13-results-430');
  assert.deepEqual(errors, []);
  console.log(`PASS · two browsers, QR and manual code, both clips, reload, sort, viewports 320/390/430 px · synthetic time ${time}`);
} finally {
  await browser.close();
  server?.close();
}
