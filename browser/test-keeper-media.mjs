import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createDemoFiles } from './demo-data.js';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch({ ...(process.env.CI ? {} : { channel: 'chrome' }), headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { window.__KEEPER_SIMULATOR_DEBUG__ = true; });
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
const media = () => page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('clavastack-keeper-removable-media-v1');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const records = await new Promise(resolve => {
    const request = db.transaction('files').objectStore('files').getAll(); request.onsuccess = () => resolve(request.result);
  });
  db.close(); return Object.fromEntries(records.map(file => [file.path, [...new Uint8Array(file.bytes)]]));
});
async function idle() { await page.locator('#demo-network:not(:disabled)').waitFor({ timeout: 30000 }); }
async function demos(network) {
  await page.locator('#demo-network').selectOption(network); await idle();
  assert(!/error|failed/i.test(await page.locator('#media-status').innerText()));
}
async function insert(token, target) {
  await page.locator(token).click(); await page.locator(`[data-media-target="${target}"]`).click(); await idle();
}
async function moveSd(target) {
  if (await page.locator('#sd-token').getAttribute('aria-label').then(text => text.includes('Inserted in'))) {
    await page.locator('#sd-token').click(); await idle();
  }
  await insert('#sd-token', target);
}
async function onboarding(keeper) {
  for (const digit of '12341234') { await keeper.getByTestId(`key_${digit}`).click(); await page.waitForTimeout(325); }
  await keeper.getByTestId('btn_primaryText').first().click();
  await keeper.getByText('Continue', { exact: true }).last().click();
  await keeper.getByText('Cancel', { exact: true }).last().click();
  await keeper.getByTestId('btn_skip').click();
  await keeper.getByTestId('view_startNewTile').waitFor({ timeout: 60000 });
  await keeper.getByTestId('view_startNewTile').click();
  await keeper.getByText('Next', { exact: true }).last().click();
  await keeper.locator('[data-testid^="wallet_item_"]').first().waitFor({ timeout: 60000 });
  if (await keeper.getByText('Protect Your Recovery Key', { exact: true }).count()) {
    await keeper.getByText('Skip for Now', { exact: true }).click();
    await keeper.getByText('Skip Backup', { exact: true }).click();
  }
}
try {
  // Exercise a parent listener that loads after the cached Keeper runtime.
  await page.route('**/bitcoin-keeper/bridge.js', async route => {
    await page.waitForTimeout(2000); await route.continue();
  });
  await page.goto(`${base}/bitcoin-keeper/`);
  await page.unroute('**/bitcoin-keeper/bridge.js');
  const keeper = page.frameLocator('#keeper-runtime');
  await keeper.getByText('Welcome', { exact: true }).waitFor({ timeout: 90000 });
  await idle();
  assert.equal(await page.locator('.media-grid > .media-group').count(), 3);
  assert.equal(await page.locator('#demo-network').inputValue(), '');
  await page.locator('#sd-picker').setInputFiles({ name: 'keep.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 255, 42]) });
  await idle();
  await demos('testnet');
  const demo = createDemoFiles('testnet');
  let files = await media();
  for (const file of demo.files) assert.deepEqual(files[`sd/${file.name}`], [...file.bytes]);
  for (const card of demo.cards) {
    assert.deepEqual(files[`cards/${card.slot}/secret.bin`], [...card.secret]);
    assert.deepEqual(files[`cards/${card.slot}/pin.bin`], [...card.pinDigest]);
    assert(files[`cards/${card.slot}/private.key`]?.length);
    assert((await page.locator(`.memory-token[data-slot="${card.slot}"]`).innerText()).includes('Not inserted'));
  }
  pass('Shared public Testnet files and firmware-created Ghost/Zoo cards, no automatic insertion');
  const identities = [files['cards/1/private.key'], files['cards/2/private.key']];
  await insert('.memory-token[data-slot="1"]', 'diy');
  await demos('mainnet');
  files = await media();
  assert.deepEqual(files['cards/1/private.key'], identities[0]);
  assert.deepEqual(files['cards/1/secret.bin'], [...demo.cards[0].secret]);
  assert(!files['sd/testnet-multisig-unsigned.psbt']);
  for (const file of createDemoFiles('mainnet').files) assert.deepEqual(files[`sd/${file.name}`], [...file.bytes]);
  pass('Switching demos preserves occupied card identity and seed');
  await moveSd('desktop');
  assert((await page.locator('#sd-location').innerText()).includes('Bitcoin Keeper'));
  await demos('testnet');
  assert((await page.locator('#sd-location').innerText()).includes('Bitcoin Keeper'));
  await moveSd('diy');
  await page.locator('#sd-refresh').click(); await idle();
  files = await media();
  for (const file of demo.files) assert.deepEqual(files[`sd/${file.name}`], [...file.bytes]);
  // Exercise the shared delete path while the real firmware owns the card.
  await page.locator('#sd-picker').setInputFiles({ name: 'delete-me.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]) }); await idle();
  await page.locator('#sd-files li').filter({ hasText: 'delete-me.bin' }).getByRole('button', { name: 'Delete', exact: true }).click(); await idle();
  assert(!(await media())['sd/delete-me.bin']);
  pass('SD bytes round-trip Keeper ↔ DIY; Delete updates the real firmware and mirror');
  await demos(''); files = await media();
  assert.deepEqual(files['sd/keep.bin'], [0, 255, 42]);
  for (const file of demo.files) assert(!files[`sd/${file.name}`]);
  assert(!files['cards/1/secret.bin']?.length); assert(!files['cards/2/secret.bin']?.length);
  pass('None removes imported demos and preserves unrelated binary files');
  await demos('testnet');
  await insert('.memory-token[data-slot="1"]', 'diy');
  const identityBeforeReload = (await media())['cards/1/private.key'];
  await page.reload(); await keeper.getByText('Welcome', { exact: true }).waitFor({ timeout: 90000 }); await idle();
  await page.locator('#sd-refresh').click(); await idle();
  files = await media();
  assert.deepEqual(files['cards/1/private.key'], identityBeforeReload);
  assert((await page.locator('.memory-token[data-slot="1"]').innerText()).includes('Inserted in Specter DIY'));
  assert.deepEqual(files['sd/keep.bin'], [0, 255, 42]);
  pass('Reload preserves the actual media, inserted-card ownership and firmware identity');

  await onboarding(keeper);
  const frame = page.frames().find(frame => frame.url().includes('/bitcoin-keeper/runtime.html'));
  await moveSd('desktop');
  const psbt = new TextDecoder().decode(demo.files.find(file => file.name === 'testnet-ghost-payment-low-fee.psbt').bytes);
  // Mount Keeper's original file screen with its documented route callback.
  // Only the fixture data is supplied here; the screen, picker and IO are real.
  await frame.evaluate(data => window.__keeperNavigation.navigate('App', { screen: 'HandleFile', params: {
    title: 'Public Testnet file', subTitle: 'Disposable unsigned PSBT', ctaText: 'Proceed',
    fileData: data, fileType: '', signerType: 'SPECTER',
    onFileExtract: value => { window.__testImportedFile = value; },
  } }), psbt);
  await keeper.getByText('Export file', { exact: true }).click();
  await keeper.getByRole('button', { name: 'Save to virtual SD card in Bitcoin Keeper', exact: true }).click();
  await page.locator('#sd-files li').filter({ hasText: /keeper-\d+\.psbt/ }).waitFor();
  files = await media();
  const exportPath = Object.keys(files).find(path => /^sd\/keeper-\d+\.psbt$/.test(path));
  assert.equal(new TextDecoder().decode(Uint8Array.from(files[exportPath])), psbt);
  await keeper.getByText('Import file', { exact: true }).click();
  await keeper.getByRole('button', { name: 'Open virtual SD card', exact: true }).click();
  await keeper.getByRole('button', { name: new RegExp(exportPath.slice(3)) }).click();
  await frame.waitForFunction(() => document.querySelector('textarea')?.value?.startsWith('cHNidP'));
  await keeper.getByTestId('btn_primaryText').filter({ hasText: 'Proceed' }).click();
  await frame.waitForFunction(() => window.__testImportedFile !== undefined);
  assert.equal(await frame.evaluate(() => window.__testImportedFile), psbt);
  pass('Original Keeper file screen exports/imports identical PSBT text through shared SD');
  await moveSd('diy'); await page.locator('#sd-refresh').click(); await idle();
  assert.equal(new TextDecoder().decode(Uint8Array.from((await media())[exportPath])), psbt);
  await moveSd('desktop');

  await frame.evaluate(() => window.__keeperNavigation.navigate('App', { screen: 'HandleFile', params: {
    title: 'Computer file import', ctaText: 'Proceed', fileType: '', signerType: 'SPECTER',
    onFileExtract: value => { window.__testComputerFile = value; },
  } }));
  await keeper.getByText('Import file', { exact: true }).click();
  const chooserEvent = page.waitForEvent('filechooser');
  await keeper.getByRole('button', { name: 'Choose from computer', exact: true }).click();
  await (await chooserEvent).setFiles({ name: 'public-test.psbt', mimeType: 'text/plain', buffer: Buffer.from(psbt) });
  await frame.waitForFunction(() => document.querySelector('textarea')?.value?.startsWith('cHNidP'));
  await keeper.getByTestId('btn_primaryText').filter({ hasText: 'Proceed' }).click();
  await frame.waitForFunction(() => window.__testComputerFile !== undefined);
  assert.equal(await frame.evaluate(() => window.__testComputerFile), psbt);
  pass('Original Keeper import uses the browser file picker');
  await frame.evaluate(data => window.__keeperNavigation.navigate('App', { screen: 'HandleFile', params: {
    title: 'Computer file export', ctaText: 'Proceed', fileData: data, fileType: '', signerType: 'SPECTER', onFileExtract() {},
  } }), psbt);
  await keeper.getByText('Export file', { exact: true }).click();
  const downloadedEvent = page.waitForEvent('download');
  await keeper.getByRole('button', { name: 'Download to computer', exact: true }).click();
  const downloaded = await downloadedEvent;
  assert.equal(await readFile(await downloaded.path(), 'utf8'), psbt);
  pass('Original Keeper export downloads unchanged PSBT bytes');
  await page.locator('#cable-toggle').check();
  assert(await page.locator('#cable-toggle').isEnabled());
  assert(!await page.locator('.cable-panel').evaluate(element => element.classList.contains('connected')));
  assert((await page.locator('#cable-status').innerText()).includes('USB transport is unavailable'));
  for (const width of [1512, 800, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    assert(await page.locator('#demo-network').isVisible());
    assert(await page.locator('#cable-toggle').isEnabled());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  pass('Compact three boxes fit desktop/tablet/mobile; cable honestly reports QR-only Keeper support');
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1512, height: 1100 });
  await mkdir('test-results', { recursive: true });
  await page.locator('#companion-media').screenshot({ path: 'test-results/keeper-media.png' });
  await writeFile('test-results/keeper-media.json', JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/keeper-media-failure.png', fullPage: true });
  console.error(await page.locator('#media-status').innerText().catch(() => ''), errors);
  console.error(await page.frameLocator('#keeper-runtime').locator('body').innerText().catch(() => ''));
  console.error(await page.frames().find(frame => frame.url().includes('/bitcoin-keeper/runtime.html'))?.evaluate(() => ({
    native: (window.__keeperNativeExceptions || []).map(entry => entry.error?.message),
    react: window.__keeperReactErrors || [], navigation: window.__keeperNavigation?.getRootState(),
  })));
  throw error;
} finally { await browser.close(); }
