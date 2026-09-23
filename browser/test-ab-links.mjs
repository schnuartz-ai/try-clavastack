import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const base = process.env.BASE_URL || 'http://127.0.0.1:8765';
const variants = [
  { name: 'official', repository: 'cryptoadvance/specter-diy' },
  { name: 'schnuartz-fork', repository: 'Schnuartz/specter-diy' },
  { name: 'schnuartz-ai-fork', repository: 'schnuartz-ai/specter-diy' },
];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text());
});

const localApiOrigin = process.env.AB_API_ORIGIN;
const localBuildRoot = process.env.AB_BUILD_ROOT;
if (localApiOrigin && localBuildRoot) {
  await page.route('**/api/ab/**', async route => {
    const request = route.request();
    const target = new URL(new URL(request.url()).pathname, localApiOrigin);
    const response = await fetch(target, {
      method: request.method(),
      headers: { 'content-type': 'application/json' },
      body: request.method() === 'POST' ? request.postData() : undefined,
    });
    await route.fulfill({ status: response.status, body: await response.text(),
      contentType: response.headers.get('content-type') || 'application/json' });
  });
  await page.route('**/ab-builds/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const artifact = resolve(localBuildRoot, decodeURIComponent(pathname.slice('/ab-builds/'.length)));
    if (artifact !== localBuildRoot && !artifact.startsWith(`${resolve(localBuildRoot)}${sep}`)) {
      await route.fulfill({ status: 404, body: 'Not found' });
      return;
    }
    try {
      const body = await readFile(artifact);
      const contentType = artifact.endsWith('.wasm') ? 'application/wasm'
        : artifact.endsWith('.js') ? 'text/javascript'
        : artifact.endsWith('.json') ? 'application/json' : 'application/octet-stream';
      await route.fulfill({ status: 200, body, contentType });
    } catch {
      await route.fulfill({ status: 404, body: 'Not found' });
    }
  });
}

try {
  await page.goto(`${base}/ab/`);
  await page.locator('[data-device="diy"] .device-status')
    .getByText('Running locally', { exact: false }).waitFor({ timeout: 90000 });
  await page.locator('[data-device="play"] .device-status')
    .getByText('Running locally', { exact: false }).waitFor({ timeout: 90000 });

  let run = 0;
  for (const variant of variants) {
    for (const device of ['diy', 'play']) {
      run += 1;
      const input = page.locator(`[data-device="${device}"] [data-ab-input]`);
      const load = page.locator(`[data-device="${device}"] [data-ab-load]`);
      const status = page.locator(`[data-device="${device}"] .device-status`);
      await input.fill(`https://github.com/${variant.repository}`);
      await load.click();
      await status.getByText('Running locally', { exact: false }).waitFor({ timeout: 90 * 60 * 1000 });

      const frameSrc = await page.locator(`[data-device="${device}"] iframe`).getAttribute('src');
      const manifestUrl = new URL(frameSrc, base).searchParams.get('manifest');
      assert.ok(manifestUrl, `${variant.name}/${device}: missing resolved manifest URL`);
      let pointer;
      const pointerUrl = new URL(manifestUrl, base);
      if (localApiOrigin && pointerUrl.pathname.startsWith('/api/ab/pointer/')) {
        const response = await fetch(new URL(pointerUrl.pathname, localApiOrigin));
        assert.equal(response.status, 200, `${variant.name}/${device}: pointer did not load`);
        pointer = await response.json();
      } else {
        const response = await page.request.get(pointerUrl.href);
        assert.equal(response.status(), 200, `${variant.name}/${device}: pointer did not load`);
        pointer = await response.json();
      }
      let build;
      if (localBuildRoot && pointer.build.startsWith('/ab-builds/')) {
        const manifestFile = resolve(localBuildRoot,
          decodeURIComponent(`${pointer.build.slice('/ab-builds/'.length)}build-info.json`));
        build = JSON.parse(await readFile(manifestFile, 'utf8'));
      } else {
        const response = await page.request.get(new URL(`${pointer.build}build-info.json`, base).href);
        assert.equal(response.status(), 200, `${variant.name}/${device}: build manifest did not load`);
        build = await response.json();
      }
      assert.equal(build.repository.toLowerCase(), variant.repository.toLowerCase(),
        `${variant.name}/${device}: wrong repository was built`);
      assert.notEqual(build.entrypoint, 'mockui', `${variant.name}/${device}: not the Specter DIY wallet`);
      assert.match(build.commit, /^[0-9a-f]{40}$/i, `${variant.name}/${device}: invalid source commit`);
      const source = page.locator(`[data-device="${device}"] .source-link`);
      assert.equal(await source.getAttribute('href'),
        `https://github.com/${variant.repository}/commit/${build.commit}`,
        `${variant.name}/${device}: source link does not match loaded firmware`);
      console.log(JSON.stringify({ run, variant: variant.name, device, result: 'pass',
        repository: build.repository, commit: build.commit }));
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
