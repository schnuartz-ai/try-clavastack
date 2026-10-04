import { launchBullBrowser } from './bull/test-browser.mjs';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir(new URL('../.browser-work/', import.meta.url), {recursive:true});
await writeFile(new URL('../.browser-work/bull-storage-probe.html', import.meta.url),
  '<!doctype html><title>Bull retired database cleanup acceptance</title>');
const browser = await launchBullBrowser();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8778'}/.browser-work/bull-storage-probe.html`);
  const result = await page.evaluate(async () => {
    const {cleanupRetiredSessions} = await import('/bull-bitcoin/app/storage.js');
    const retired = crypto.randomUUID();
    const names = ['bullbitcoin_sqlite', 'payjoin'].map(name => `bull-bitcoin-${retired}-${name}`);
    const root = await navigator.storage.getDirectory();
    const drift = await root.getDirectoryHandle('drift_db', {create:true});
    const foreign = 'keeper-reset-public-sentinel';
    await drift.getDirectoryHandle(foreign, {create:true});
    const connections = [];
    for (const name of names) {
      const directory = await drift.getDirectoryHandle(name, {create:true});
      await directory.getFileHandle('database', {create:true});
      connections.push(await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }));
    }
    const workerSource = `onmessage = async event => {
      try {
        const root = await navigator.storage.getDirectory();
        const drift = await root.getDirectoryHandle('drift_db');
        const directory = await drift.getDirectoryHandle(event.data);
        const file = await directory.getFileHandle('database');
        const handle = await file.createSyncAccessHandle();
        postMessage('locked');
        setTimeout(() => { handle.close(); postMessage('released'); }, 1600);
      } catch (error) { postMessage({error:error.message}); }
    };`;
    const url = URL.createObjectURL(new Blob([workerSource], {type:'text/javascript'}));
    const worker = new Worker(url);
    try {
      await new Promise((resolve, reject) => {
        worker.onmessage = event => event.data === 'locked' ? resolve() : reject(new Error(event.data.error));
        worker.onerror = reject;
        worker.postMessage(names[0]);
      });
      let released = false;
      worker.onmessage = event => { if (event.data === 'released') released = true; };
      let blocked = false;
      connections[0].onversionchange = () => {
        blocked = true;
        setTimeout(() => connections[0].close(), 600);
      };
      connections[1].close();
      const started = performance.now();
      await cleanupRetiredSessions([retired]);
      const elapsed = performance.now() - started;
      const remaining = [];
      for await (const [name] of drift.entries()) remaining.push(name);
      const databases = (await indexedDB.databases()).map(database => database.name);
      let invalidRejected = false;
      try { await cleanupRetiredSessions(['../keeper']); }
      catch (error) { invalidRejected = error.message === 'Invalid retired Bull session'; }
      // A real filesystem error must remain visible rather than being retried away.
      const originalStorage = navigator.storage;
      Object.defineProperty(navigator, 'storage', {configurable:true, value:{
        getDirectory:async () => { throw new DOMException('Public permission probe', 'SecurityError'); },
      }});
      let permissionRejected = false;
      try { await cleanupRetiredSessions([crypto.randomUUID()]); }
      catch (error) { permissionRejected = error.name === 'SecurityError'; }
      finally { Object.defineProperty(navigator, 'storage', {configurable:true, value:originalStorage}); }
      await cleanupRetiredSessions([retired]);
      return {blocked,released,elapsed,remaining,databases,names,foreign,invalidRejected,permissionRejected};
    } finally {
      connections.forEach(connection => connection.close());
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  });
  assert.equal(result.blocked, true);
  assert.equal(result.released, true);
  assert.ok(result.elapsed >= 1300);
  assert.ok(result.remaining.includes(result.foreign));
  for (const name of result.names) {
    assert.ok(!result.remaining.includes(name));
    assert.ok(!result.databases.includes(name));
  }
  assert.equal(result.invalidRejected, true);
  assert.equal(result.permissionRejected, true);
  assert.deepEqual(errors, []);
  console.log('PASS Bull reset waits for real IndexedDB/OPFS locks, preserves foreign storage, rejects invalid IDs and propagates permission errors');
} finally { await browser.close(); }
