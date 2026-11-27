import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

test('sound trigger ignores the preparation window and reports the first impulse sample once', async () => {
  const signals = [];
  let Processor;
  const scope = createContext({
    currentFrame: 0,
    sampleRate: 1000,
    AudioWorkletProcessor: class { port = { postMessage: timestamp => signals.push(timestamp) }; },
    registerProcessor: (_name, definition) => { Processor = definition; },
  });
  runInContext(await readFile(new URL('../public/sound-trigger.mjs', import.meta.url), 'utf8'), scope);
  const detector = new Processor();
  detector.port.onmessage({ data: 0.1 });
  const signal = new Float32Array(256);
  signal[80] = signal[130] = signal[191] = signal[250] = 0.7;
  detector.process([[signal]]);
  assert.deepEqual(signals, [0.191]);
});
