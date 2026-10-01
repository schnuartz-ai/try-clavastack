import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { BIP32Factory } from 'bip32';
import * as bip39 from 'bip39';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { Psbt, networks } from 'bitcoinjs-lib';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1150 } });
const errors = [];
const consoleErrors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });

try {
  await page.goto(`${base}/bitcoin-keeper/`, { waitUntil: 'domcontentloaded' });
  for (const path of ['/bitcoin-keeper/LICENSE.txt', '/bitcoin-keeper/LICENSE-APACHE-2.0.txt',
    '/bitcoin-keeper/THIRD-PARTY-NOTICES.txt', '/builds/keeper-web/app.js.LEGAL.txt']) {
    const response = await page.request.get(`${base}${path}`);
    if (response.status() !== 200) throw new Error(`Missing shipped license notice: ${path} (${response.status()})`);
  }
  await page.waitForTimeout(1500);
  if (!await page.locator('#keeper-app').getByRole('button', { name: 'Add Specter DIY signer' }).isVisible()) {
    throw new Error(`Keeper did not render. title=${await page.title()}; app=${(await page.locator('#keeper-app').innerText().catch(() => '')).slice(0, 300)}; pageErrors=${errors.join('; ')}; consoleErrors=${consoleErrors.join('; ')}`);
  }
  try {
    await page.locator('#specter-badge').getByText('Running').waitFor({
      timeout: Number(process.env.KEEPER_BOOT_TIMEOUT_MS || 120_000),
    });
  } catch {
    const child = page.frames().find(frame => frame.parentFrame() === page.mainFrame());
    const debug = child ? await child.locator('#debug-log').textContent().catch(() => '') : '';
    throw new Error(`Specter did not start: badge=${await page.locator('#specter-badge').textContent()}; status=${await page.locator('#specter-status').textContent()}; pageErrors=${errors.join('; ')}; consoleErrors=${consoleErrors.join('; ')}; workerLog=${debug.slice(-1600)}`);
  }
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/bitcoin-keeper-overview.png', fullPage: true });

  // Public, disposable BIP39 reference vector; never use this phrase for funds.
  const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const testNetwork = networks.testnet;
  const testRoot = BIP32Factory(ecc).fromSeed(await bip39.mnemonicToSeed(testMnemonic), testNetwork);
  const testAccount = testRoot.deriveHardened(84).deriveHardened(1).deriveHardened(0);
  const descriptor = `addwallet Specter DIY TESTNET&wpkh([${testRoot.fingerprint.toString('hex')}/84h/1h/0h]${testAccount.neutered().toBase58()}/0/*)`;

  await page.locator('#keeper-app').getByRole('button', { name: 'Add Specter DIY signer' }).click();
  await sendSpecterOutput(descriptor);
  await page.locator('#keeper-app').getByRole('button', { name: 'Scan from Specter DIY' }).click();
  await page.locator('#keeper-app').getByText('My wallet', { exact: true }).waitFor();
  const address = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('keeper-specter-simulator-v1')).vault.specs.receivingAddress,
  );
  if (!/^tb1q[0-9a-z]{30,}$/.test(address || '')) throw new Error(`Keeper derived an unexpected TESTNET address: ${address}`);

  await page.locator('#keeper-app').getByRole('button', { name: 'Receive' }).click();
  await page.locator('#keeper-app canvas#keeper-qr').waitFor();
  const receiveQr = await readVisibleQr();
  if (receiveQr !== address) throw new Error(`Keeper receive QR did not encode its displayed address: ${receiveQr}`);

  await page.locator('#keeper-app').getByRole('button', { name: 'Prepare testnet PSBT' }).click();
  try {
    await page.locator('#keeper-app').getByText('Sign transaction', { exact: true }).waitFor({ timeout: 12000 });
  } catch {
    throw new Error(`Keeper could not prepare a PSBT. notice=${await page.locator('#keeper-notice').textContent()}; app=${(await page.locator('#keeper-app').innerText()).slice(0, 800)}; errors=${errors.join('; ')}`);
  }
  const requested = await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem('keeper-specter-simulator-v1'));
    return state.psbt;
  });
  if (!requested?.frames?.length || !requested.frames.every(frame => /^ur:crypto-psbt\//i.test(frame))) {
    throw new Error('Keeper source did not produce its animated crypto-psbt UR frames.');
  }
  const visiblePsbtQr = await readVisibleQr();
  if (!requested.frames.includes(visiblePsbtQr)) {
    throw new Error(`Keeper canvas did not render a source-generated PSBT UR frame: ${visiblePsbtQr}`);
  }

  // Put the real Specter QRHost in its browser probe mode, then send Keeper's
  // actual animated UR frames through the same cross-frame QR input bridge.
  await page.locator('#specter-simulator').evaluate(frame => {
    frame.src = '/?embedded=1&gallery=1&variant=diy&probe=qr';
  });
  await page.waitForFunction(() => {
    const button = document.querySelector('#send-keeper-qr');
    return button && !button.disabled;
  }, undefined, { timeout: 60_000 });
  await page.locator('#send-keeper-qr').click();
  const requestedHex = Buffer.from(requested.base64, 'base64').toString('hex');
  await page.waitForFunction(expected => {
    const frame = document.querySelector('#specter-simulator');
    const log = frame?.contentDocument?.querySelector('#debug-log');
    return log?.textContent?.includes(`QR_PROBE_HEX ${expected}`);
  }, requestedHex, { timeout: 60_000 });

  // Sign the synthetic testnet PSBT with the matching disposable public vector.
  // This makes the browser import exercise verify a real ECDSA witness signature.
  const psbt = Psbt.fromBase64(requested.base64, { network: testNetwork });
  const privateKey = testRoot.deriveHardened(84).deriveHardened(1).deriveHardened(0)
    .derive(0).derive(0).privateKey;
  const testSigner = ECPairFactory(ecc).fromPrivateKey(privateKey, { network: testNetwork });
  psbt.signInput(0, testSigner);
  psbt.finalizeAllInputs();
  const signedBase64 = psbt.toBase64();

  await page.locator('#keeper-app').getByRole('button', { name: 'Scan signed PSBT from Specter DIY' }).click();
  await sendSpecterOutput(signedBase64);
  await page.locator('#keeper-app').getByRole('button', { name: 'Scan from Specter DIY' }).click();
  await page.locator('#keeper-app').getByText('Transaction signature accepted', { exact: true }).waitFor();
  const imported = await page.evaluate(() => JSON.parse(sessionStorage.getItem('keeper-specter-simulator-v1')).signed);
  if (imported?.status !== 'Cryptographic finalized witness verified') {
    throw new Error(`Keeper accepted an unexpected signature state: ${JSON.stringify(imported)}; notice=${await page.locator('#keeper-notice').textContent()}`);
  }

  if (errors.length || consoleErrors.length) {
    throw new Error(`Keeper browser errors: ${[...errors, ...consoleErrors].join('; ')}`);
  }
  console.log(JSON.stringify({
    result: 'pass',
    firmware: 'Specter DIY WebAssembly runtime started',
    keeperSigner: 'upstream source vault and TESTNET address derivation',
    receiveQr: 'decoded from rendered Keeper canvas',
    psbtQr: `${requested.frames.length} upstream crypto-psbt UR frames decoded by the Specter DIY QRHost`,
    returnScan: 'test signer descriptor and signed PSBT delivered through the cross-frame QR output adapter',
    signedPsbtImport: 'finalized witness ECDSA verified by Keeper source curve adapter',
  }, null, 2));
} finally {
  await browser.close();
}

async function readVisibleQr() {
  return page.locator('#keeper-app canvas#keeper-qr').evaluate(canvas => {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || typeof window.jsQR !== 'function') throw new Error('QR decoder is not available.');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = window.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
    if (!result?.data) throw new Error('Keeper QR canvas could not be decoded.');
    return result.data;
  });
}

async function sendSpecterOutput(frame) {
  const specterFrame = page.frames().find(child =>
    child.parentFrame() === page.mainFrame() && child.url().includes('embedded=1'),
  );
  if (!specterFrame) throw new Error('Specter iframe is not available for the QR bridge test.');
  await specterFrame.evaluate(value => {
    window.parent.postMessage({ type: 'simulator-qr-output', variant: 'diy', frame: value }, location.origin);
  }, frame);
  await page.waitForTimeout(50);
}
