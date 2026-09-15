// Regression: a real LVGL pointer callback triggers MicroPython GC while
// the worker's main loop uses Asyncify. The old direct-call bridge crashes.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const clickCount = 12;
const variants = {
  play: process.env.TEST_PLAY_BUILD || JSON.parse(await readFile(resolve(root, 'browser/variants/specter-playground.json'))).build,
  schnuartz: process.env.TEST_SCHNUARTZ_BUILD || JSON.parse(await readFile(resolve(root, 'browser/variants/specter-playground-schnuartz.json'))).build,
};
const probe = await readFile(resolve(root, 'browser/probes/pointer-gc.py'), 'utf8');
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<canvas id="screen" width="480" height="800"></canvas>');
    }
    const file = resolve(root, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(root + sep)) throw new Error('Outside root');
    let body = await readFile(file);
    if (pathname === '/browser/runtime-worker.js') {
      let source = body.toString();
      source = 'Error.stackTraceLimit = 100;\n' + source;
      source = source.replace("  importScripts(data.build + 'micropython.js' + assetSuffix);", `
        Module.arguments[2] = '/browser/pointer-gc.py';
        Module.preRun.push(() => Module.FS.writeFile('/browser/pointer-gc.py', ${JSON.stringify(probe)}));
        self.addEventListener('error', e => send('probe-error', {message: e.message, stack: e.error?.stack}));
        self.addEventListener('unhandledrejection', e => send('probe-error', {message: String(e.reason), stack: e.reason?.stack}));
        importScripts(data.build + 'micropython.js' + assetSuffix);
      `);
      body = source;
    }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.wasm': 'application/wasm' })[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch (e) { res.statusCode = 404; res.end(String(e)); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.TEST_CHANNEL ? { channel: process.env.TEST_CHANNEL } : {}) });
  for (const variant of (process.env.TEST_VARIANTS || 'play,schnuartz').split(',')) {
    if (!variants[variant]) throw new Error(`Unknown variant ${variant}`);
    const page = await browser.newPage();
    const events = [];
    await page.exposeFunction('record', event => {
      if (event.type !== 'loading-progress') { events.push(event); console.log(variant, JSON.stringify({...event, ...(event.stack ? {stack: event.stack.split('\n').slice(0,9).join('\n')} : {})})); }
    });
    await page.goto(base);
    await page.evaluate(({build, program}) => {
      const worker = window.worker = new Worker('/browser/runtime-worker.js');
      worker.onmessage = e => window.record(e.data);
      worker.onerror = e => window.record({type: 'worker-error', message: e.message});
      const canvas = document.querySelector('canvas').transferControlToOffscreen();
      worker.postMessage({type: 'start', build, program, canvas}, [canvas]);
    }, {build: variants[variant], program: 'mockui'});
    const deadline = Date.now() + Number(process.env.PROBE_TIMEOUT_MS || 20000);
    let pointerSent = false;
    while (Date.now() < deadline && !events.some(e => ['worker-error', 'probe-error', 'abort'].includes(e.type) || e.message === 'PROBE_DONE')) {
      if (!pointerSent && events.some(e => e.message === 'MOCKUI_READY')) {
        pointerSent = true;
        await page.evaluate(count => {
          for (let i = 0; i < count; i++) {
            setTimeout(() => {
              worker.postMessage({type: 'pointer', x: 40, y: 40, down: 1});
              setTimeout(() => worker.postMessage({type: 'pointer', x: 40, y: 40, down: 0}), 50);
            }, i * 150);
          }
        }, clickCount);
      }
      await new Promise(done => setTimeout(done, 100));
    }
    const failed = events.some(e => ['worker-error', 'probe-error', 'abort', 'operation-error'].includes(e.type));
    const passed = !failed && events.filter(e => e.message === 'PROBE_CALLBACK_AFTER_GC').length === clickCount &&
      events.some(e => e.message === 'PROBE_DONE');
    results.push({ variant, build: variants[variant], passed, events });
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
await mkdir(resolve(root, 'test-results'), { recursive: true });
const output = process.env.PROBE_RESULT || 'pointer-gc.json';
await writeFile(resolve(root, 'test-results', output), JSON.stringify({results}, null, 2));
if (results.some(r => !r.passed)) throw new Error('Pointer/GC regression failed; see test-results/' + output);
