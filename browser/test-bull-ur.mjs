import { strict as assert } from 'node:assert';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { UR, UREncoder, URDecoder } from '@ngraveio/bc-ur';

const bytes = Buffer.from(Array.from({length: 702}, (_, index) => index % 251));
const ur = new UR(bytes, 'crypto-psbt');
const encoder = new UREncoder(ur, 60);
const frames = Array.from({length:100}, () => encoder.nextPart()).slice(12);
const browser = await chromium.launch({...(process.env.CI ? {} : {channel:'chrome'}), headless:true});
try {
  await writeFile(new URL('../.browser-work/ur-probe.html', import.meta.url),
    '<!doctype html><title>Original Bull UR acceptance</title>');
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8778'}/.browser-work/ur-probe.html`);
  await page.evaluate(input => {
    window.bullUrInput = JSON.stringify(input);
    window.bullUrDone = value => { window.bullUrResult = JSON.parse(value); };
    const script = document.createElement('script'); script.src = '/.browser-work/ur-probe.js';
    document.body.append(script);
  }, {cbor:bytes.toString('base64'), frames});
  await page.waitForFunction(() => window.bullUrResult);
  const result = await page.evaluate(() => window.bullUrResult);
  assert.equal(result.ok, true, JSON.stringify(result));
  const decoder = new URDecoder();
  for (const frame of result.frames.slice(12)) decoder.receivePart(frame);
  assert.equal(decoder.isSuccess(), true);
  assert.equal(decoder.resultUR().cbor.toString('hex'), bytes.toString('hex'));
  const independent = new UREncoder(ur, 60);
  assert.deepEqual(result.frames, Array.from({length:100}, () => independent.nextPart()));
  assert.deepEqual(errors, []);
  console.log('PASS original Bull Dart UR mixed fountain decode/encode and 100 exact independent frames');
} finally { await browser.close(); }
