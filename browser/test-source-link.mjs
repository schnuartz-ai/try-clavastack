import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
try {
  for (const repository of ['Schnuartz/specter-diy', 'schnuartz-ai/specter-diy']) {
    const page = await browser.newPage();
    const commit = '0123456789abcdef0123456789abcdef01234567';
    const version = 'fedcba9876543210';
    await page.route('**/browser/current.json', route => route.fulfill({ json: {
      build: `/builds/${repository}/${commit}/`, version,
    } }));
    await page.route('**/build-info.json', route => route.fulfill({ json: {
      repository, commit, artifact_set_sha256: `${version}${'0'.repeat(48)}`,
      source_url: 'https://example.invalid/should-not-be-used',
    } }));
    await page.route('**/browser/runtime-worker.js', route => route.abort());
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    const link = page.locator('#source-commit-link');
    await link.filter({ hasText: `GitHub · ${commit.slice(0, 7)}` }).waitFor();
    if (await link.getAttribute('href') !== `https://github.com/${repository}/commit/${commit}`) {
      throw new Error(`Wrong commit link for ${repository}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('Main page links both production and new DIY build namespaces to their exact commits');
