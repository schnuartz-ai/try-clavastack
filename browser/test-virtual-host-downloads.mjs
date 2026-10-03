import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const latestRelease = 'https://github.com/cryptoadvance/specter-virtual-host/releases/latest';
const releaseApi = 'https://api.github.com/repos/cryptoadvance/specter-virtual-host/releases/latest';
const script = await readFile(new URL('./virtual-host-downloads.js', import.meta.url), 'utf8');
const platforms = ['windows', 'linux-x64', 'macos-arm64', 'macos-x64'];
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
const modernAssets = version => [
  'sha256.signed.txt',
  'Specter-Virtual-Host.exe',
  `specter-virtual-host_${version}_amd64.deb`,
  `specter-virtual-host_${version}_arm64.deb`,
  'Specter-Virtual-Host-macOS-universal.zip',
].map(name => ({ name }));

try {
  for (const file of ['index.html', 'ab/index.html', 'simulators/index.html']) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert(html.includes('src="/browser/virtual-host-downloads.js?v=20261003"'), file);
    const panel = html.match(/<details id="virtual-host"[\s\S]*?<\/details>/)?.[0];
    assert(panel, `Missing download panel in ${file}`);
    const page = await browser.newPage();
    let assets = modernAssets('1.1.0');
    let status = 200;
    let requests = 0;
    await page.route(releaseApi, route => {
      requests++;
      return route.fulfill({ status, json: { assets, draft: false, prerelease: false },
        headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await page.route('https://github.com/cryptoadvance/specter-virtual-host/**', route =>
      route.fulfill({ contentType: 'text/html', body: '<p>Download destination</p>' }));
    const loadPanel = async () => {
      await page.setContent(panel);
      await page.addScriptTag({ type: 'module', content: script });
    };
    const link = platform => page.locator(`[data-virtual-host-platform="${platform}"]`);
    await loadPanel();
    assert.equal(requests, 0, 'Collapsed panels must not query GitHub');
    for (const platform of platforms) assert.equal(await link(platform).getAttribute('href'), latestRelease);
    await page.locator('summary').click();
    await page.waitForFunction(expected => document.querySelector('[data-virtual-host-platform="linux-x64"]').href === expected,
      `${latestRelease}/download/specter-virtual-host_1.1.0_amd64.deb`);
    assert.equal(await link('windows').getAttribute('href'), `${latestRelease}/download/Specter-Virtual-Host.exe`);
    for (const platform of ['macos-arm64', 'macos-x64']) {
      assert.equal(await link(platform).getAttribute('href'), `${latestRelease}/download/Specter-Virtual-Host-macOS-universal.zip`);
    }
    // A new release while the panel stays open must be selected at click time.
    assets = modernAssets('1.2.0');
    await link('linux-x64').click();
    await page.waitForURL(`${latestRelease}/download/specter-virtual-host_1.2.0_amd64.deb`);
    assert.equal(requests, 2, 'Download clicks must refresh the release');

    // A rate limit after a successful lookup must clear the old filename.
    await loadPanel();
    await page.locator('summary').click();
    await page.waitForFunction(expected => document.querySelector('[data-virtual-host-platform="linux-x64"]').href === expected,
      `${latestRelease}/download/specter-virtual-host_1.2.0_amd64.deb`);
    status = 403;
    await link('linux-x64').click();
    await page.waitForURL(latestRelease);

    // Older asset naming is supported, and absent assets never use an older release.
    status = 200;
    assets = [
      'Specter-Virtual-Host-Windows-x64.exe',
      'Specter-Virtual-Host-macOS-arm64',
      'Specter-Virtual-Host-macOS-x64',
    ].map(name => ({ name }));
    await loadPanel();
    await page.locator('summary').click();
    await page.waitForFunction(expected => document.querySelector('[data-virtual-host-platform="windows"]').href === expected,
      `${latestRelease}/download/Specter-Virtual-Host-Windows-x64.exe`);
    assert.equal(await link('macos-arm64').getAttribute('href'), `${latestRelease}/download/Specter-Virtual-Host-macOS-arm64`);
    assert.equal(await link('macos-x64').getAttribute('href'), `${latestRelease}/download/Specter-Virtual-Host-macOS-x64`);
    assert.equal(await link('linux-x64').getAttribute('href'), latestRelease);
    await link('linux-x64').click();
    await page.waitForURL(latestRelease);
    await page.close();
  }
  console.log('Latest Virtual Host downloads passed on all three pages: current assets, release changes, API limits and missing assets.');
} finally {
  await browser.close();
}
