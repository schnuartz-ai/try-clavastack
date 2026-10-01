import './polyfills';
import QRCode from 'qrcode';
import { Buffer } from 'buffer';
import * as bitcoinJS from 'bitcoinjs-lib';
import { joinQRs } from '../upstream/bitcoin-keeper/src/services/qr/bbqr/join';
import {
  createKeeperUrDecoder,
  createVaultFromSpecterQr,
  decodeKeeperUr,
  inspectKeeperPsbt,
  prepareKeeperPsbt,
} from './engine';

type Screen = 'welcome' | 'scan-signer' | 'home' | 'receive' | 'show-psbt' | 'scan-psbt';
type SimVault = Awaited<ReturnType<typeof createVaultFromSpecterQr>>;

interface StoredState {
  version: 1;
  screen: Screen;
  vault?: SimVault;
  psbt?: { base64: string; frames: string[]; address: string; inputValue: number; outputValue: number };
  signed?: { valid: boolean; status: string; signedInputs: number; finalized: boolean };
}

const STORAGE_KEY = 'keeper-specter-simulator-v1';
const app = document.querySelector<HTMLElement>('#keeper-app')!;
const specterFrame = document.querySelector<HTMLIFrameElement>('#specter-simulator')!;
const specterBadge = document.querySelector<HTMLElement>('#specter-badge')!;
const specterStatus = document.querySelector<HTMLElement>('#specter-status')!;
const specterQrStatus = document.querySelector<HTMLElement>('#specter-qr-status')!;
const sendKeeperQrButton = document.querySelector<HTMLButtonElement>('#send-keeper-qr')!;
const qrIngressDecoder = createKeeperUrDecoder();
let specterScannerActive = false;
let specterQrFrames: string[] = [];
let specterQrLast = '';
let specterQrLastAt = 0;
let specterQrGroup = '';
let directScanTimer: number | undefined;
let directScanStartedAt = 0;
let directScanFrameIndex = 0;
let sendQrTimer: number | undefined;
let qrFrameTimer: number | undefined;
let visibleKeeperFrameIndex = 0;
let cameraStream: MediaStream | undefined;
let cameraFrameRequest = 0;
let lastCameraPayload = '';
let lastScanError = '';

function readState(): StoredState {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (value?.version === 1) return value;
  } catch { /* an invalid disposable session starts fresh */ }
  return { version: 1, screen: 'welcome' };
}

let state = readState();

function persist() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { setScanStatus('Browser session storage is unavailable; this wallet will not survive reload.'); }
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]!));
}

function shortAddress(address?: string) {
  if (!address) return '';
  return address.length > 36 ? `${address.slice(0, 20)}…${address.slice(-12)}` : address;
}

function stopCamera() {
  cameraFrameRequest++;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = undefined;
  const video = app.querySelector<HTMLVideoElement>('#camera-video');
  if (video) video.srcObject = null;
  app.querySelector<HTMLElement>('#camera-surface')?.setAttribute('hidden', '');
}

function stopDirectScan() {
  if (directScanTimer !== undefined) window.clearInterval(directScanTimer);
  directScanTimer = undefined;
}

function stopSendingQr() {
  if (sendQrTimer !== undefined) window.clearInterval(sendQrTimer);
  sendQrTimer = undefined;
}

function setScanStatus(message: string, isError = false) {
  lastScanError = isError ? message : '';
  const status = app.querySelector<HTMLElement>('#scan-status');
  if (status) {
    status.textContent = message;
    status.style.color = isError ? '#8e3f45' : '';
  } else if (isError) {
    const notice = document.querySelector<HTMLElement>('#keeper-notice');
    if (notice) {
      notice.hidden = false;
      notice.textContent = message;
    }
  }
  if (isError) console.warn(`[Keeper simulator] ${message}`);
}

function setScreen(screen: Screen) {
  stopCamera();
  stopDirectScan();
  stopSendingQr();
  state.screen = screen;
  persist();
  render();
}

function renderTopbar() {
  return `<div class="keeper-topbar"><div class="keeper-title"><img src="/builds/keeper-web/keeper-icon.svg" alt=""><span>Bitcoin Keeper</span></div><span class="testnet-tag">TESTNET</span></div>`;
}

function renderNav(active: string) {
  return `<nav class="keep-nav"><span class="${active === 'home' ? 'active' : ''}">Home</span><span class="${active === 'wallet' ? 'active' : ''}">Wallets</span><span>Settings</span></nav>`;
}

function renderWelcome() {
  return `<section class="keeper-content">
      <h3>Welcome to Keeper</h3>
      <p>Connect the real Specter DIY simulator as an external signer. Keeper builds a single-signature BIP84 testnet vault from its public descriptor.</p>
      <div class="wallet-card"><h4>Separate devices</h4><p class="subtle">The signing key stays in Specter DIY. Keeper receives only the account public key and fingerprint.</p></div>
      <div class="keep-actions"><button class="button" data-action="add-specter">Add Specter DIY signer</button><button class="button secondary" data-action="reset-keeper">Reset Keeper simulator</button></div>
      <p class="small" style="margin-top:12px">This browser flow uses Keeper's upstream vault, address, QR and PSBT logic. Only public testnet data is stored in this tab.</p>
    </section>${renderNav('home')}`;
}

function renderScanner(isPsbt: boolean) {
  const title = isPsbt ? 'Import signed transaction' : 'Add Specter DIY signer';
  const detail = isPsbt
    ? 'Show the signed PSBT QR on Specter DIY. Keeper decodes the same QR or animated UR frames as its scanner.'
    : 'On Specter DIY, open the TESTNET wallet descriptor and show its QR code.';
  return `<section class="keeper-content">
      <h3>${title}</h3><p>${detail}</p>
      <div class="scan-panel"><h4>Scan QR</h4>
        <button class="button secondary" data-action="camera">Use camera</button>
        <button class="button secondary" data-action="scan-specter">Scan from Specter DIY</button>
        <div id="camera-surface" hidden><video id="camera-video" playsinline muted style="width:100%;border-radius:9px;background:#101414"></video><button class="button secondary" data-action="stop-camera">Stop camera</button></div>
        <div class="scan-status" id="scan-status">Camera and direct scanning use Keeper's QR/UR input parser.</div>
      </div>
      <div class="manual-frame"><label class="small" for="qr-manual">Paste one QR frame or the complete payload</label><textarea id="qr-manual" class="input" rows="3" placeholder="ur:crypto-psbt/… or Specter descriptor JSON"></textarea><button class="button secondary" data-action="submit-manual">Process QR input</button></div>
      <div class="keep-actions"><button class="button secondary" data-action="back">Cancel</button></div>
    </section>${renderNav('wallet')}`;
}

function renderHome() {
  const vault = state.vault!;
  const address = vault.specs.receivingAddress || '';
  const signer = vault.signers[0];
  return `<section class="keeper-content">
      <h3>My wallet</h3><p>Keeper TESTNET · single-signature</p>
      <div class="wallet-card"><h4>${escapeHtml(vault.presentationData.name)}</h4><p class="subtle">External signer · Specter DIY · ${escapeHtml(signer.masterFingerprint)}</p><p class="subtle">${escapeHtml(signer.derivationPath)} · BIP84</p><code class="address">${escapeHtml(shortAddress(address))}</code></div>
      <div class="wallet-card"><h4>Balance</h4><p class="subtle">0 sats · no network connection</p></div>
      ${state.signed ? `<div class="tx-detail"><strong>Transaction signature accepted</strong><br>${escapeHtml(state.signed.status)}<br>Signed inputs: ${state.signed.signedInputs}</div>` : ''}
      <div class="keep-actions"><button class="button" data-action="receive">Receive</button><button class="button" data-action="prepare-psbt">Prepare testnet PSBT</button><button class="button secondary" data-action="scan-signer">Add another signer</button><button class="button danger" data-action="reset-keeper">Reset Keeper simulator</button></div>
      <p class="small" style="margin-top:11px">No seed or private key is stored in Keeper. The PSBT exercise uses a synthetic 100,000 sat UTXO and cannot be broadcast.</p>
    </section>${renderNav('home')}`;
}

function renderReceive() {
  return `<section class="keeper-content">
      <h3>Receive</h3><p>Testnet address derived by Keeper from the Specter DIY account xpub.</p>
      <div class="qr-wrap"><canvas id="keeper-qr" aria-label="Keeper testnet receive address QR code"></canvas></div>
      <code class="address">${escapeHtml(state.vault?.specs.receivingAddress)}</code>
      <div class="wallet-card"><h4>Network</h4><p class="subtle">Bitcoin TESTNET · BIP84 native SegWit</p></div>
      <div class="keep-actions"><button class="button" data-action="prepare-psbt">Prepare testnet PSBT</button><button class="button secondary" data-action="back-home">Done</button></div>
    </section>${renderNav('wallet')}`;
}

function renderShowPsbt() {
  const psbt = state.psbt!;
  return `<section class="keeper-content">
      <h3>Sign transaction</h3><p>Scan this animated crypto-psbt with Specter DIY. Each frame is Keeper's normal UR payload.</p>
      <div class="qr-wrap"><canvas id="keeper-qr" aria-label="Keeper animated crypto-psbt QR code"></canvas></div>
      <div class="wallet-card"><h4>Test transaction</h4><p class="subtle">Input: ${psbt.inputValue.toLocaleString()} sats · Output: ${psbt.outputValue.toLocaleString()} sats</p><p class="subtle">Not broadcastable: synthetic UTXO, testnet encoding.</p></div>
      <div class="keep-actions"><button class="button" data-action="scan-psbt">Scan signed PSBT from Specter DIY</button><button class="button secondary" data-action="back-home">Cancel</button></div>
      <p class="small" id="scan-status">Open the QR scanner on Specter DIY, then select “Scan from Bitcoin Keeper” below the Specter device.</p>
    </section>${renderNav('wallet')}`;
}

function render() {
  const screen = state.screen;
  app.innerHTML = `${renderTopbar()}${screen === 'welcome' ? renderWelcome() :
    screen === 'scan-signer' ? renderScanner(false) :
    screen === 'scan-psbt' ? renderScanner(true) :
    screen === 'receive' ? renderReceive() :
    screen === 'show-psbt' ? renderShowPsbt() : renderHome()}`;
  app.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
    button.addEventListener('click', () => void onAction(button.dataset.action || '', button));
  });
  updateSpecterControls();
  if (screen === 'receive') void drawKeeperQr([state.vault!.specs.receivingAddress!]);
  if (screen === 'show-psbt' && state.psbt) startKeeperQrAnimation(state.psbt.frames);
}

async function drawKeeperQr(frames: string[]) {
  const canvas = app.querySelector<HTMLCanvasElement>('#keeper-qr');
  if (!canvas || !frames.length) return;
  visibleKeeperFrameIndex = 0;
  await QRCode.toCanvas(canvas, frames[0], { width: 460, margin: 2, errorCorrectionLevel: 'M' });
  updateSpecterControls();
}

function startKeeperQrAnimation(frames: string[]) {
  if (qrFrameTimer !== undefined) window.clearInterval(qrFrameTimer);
  visibleKeeperFrameIndex = 0;
  void drawKeeperQr(frames);
  if (frames.length < 2) return;
  qrFrameTimer = window.setInterval(() => {
    visibleKeeperFrameIndex = (visibleKeeperFrameIndex + 1) % frames.length;
    void drawKeeperQrFrame(frames[visibleKeeperFrameIndex]);
  }, 620);
}

async function drawKeeperQrFrame(frame: string) {
  const canvas = app.querySelector<HTMLCanvasElement>('#keeper-qr');
  if (canvas) await QRCode.toCanvas(canvas, frame, { width: 460, margin: 2, errorCorrectionLevel: 'M' });
}

function updateSpecterControls() {
  const hasKeeperQr = state.screen === 'show-psbt' && Boolean(state.psbt?.frames.length);
  sendKeeperQrButton.disabled = !specterScannerActive || !hasKeeperQr;
  sendKeeperQrButton.title = !specterScannerActive
    ? 'Open the QR scanner on Specter DIY first.'
    : !hasKeeperQr ? 'Show a Keeper PSBT QR first.' : 'Send the visible Keeper QR frames into Specter DIY.';
  if (specterScannerActive) specterQrStatus.textContent = hasKeeperQr
    ? 'Specter scanner is active. Send the currently visible Keeper QR frames.'
    : 'Specter scanner is active. Prepare a Keeper PSBT to send QR frames.';
  else specterQrStatus.textContent = 'Open the Specter QR scanner to receive frames from Keeper.';
}

function frameGroup(frame: string) {
  const ur = frame.trim().match(/^ur:([^/]+)/i);
  if (ur) return `ur:${ur[1].toLowerCase()}`;
  if (frame.startsWith('B$')) return 'bbqr';
  if (/^p\d+of\d+\s/i.test(frame)) return 'p-of-n';
  return 'single';
}

function acceptSpecterFrame(frame: unknown) {
  if (typeof frame !== 'string' || !frame.trim()) return;
  const text = frame.trim();
  const now = Date.now();
  const group = frameGroup(text);
  if ((now - specterQrLastAt > 2200) || (specterQrGroup && group !== specterQrGroup)) specterQrFrames = [];
  if (group === 'single' && specterQrLast && specterQrLast !== text) specterQrFrames = [];
  const seqStart = text.match(/^ur:[^/]+\/(\d+)[-/]/i)?.[1];
  if (seqStart === '1' && specterQrFrames.length) specterQrFrames = [];
  const pStart = text.match(/^p(\d+)of/i)?.[1];
  if (pStart === '1' && specterQrFrames.length) specterQrFrames = [];
  specterQrGroup = group;
  specterQrLast = text;
  specterQrLastAt = now;
  if (specterQrFrames[specterQrFrames.length - 1] !== text) specterQrFrames.push(text);
  if (specterQrFrames.length > 220) specterQrFrames.splice(0, specterQrFrames.length - 220);
  if (directScanTimer !== undefined) consumeDirectSpecterFrames();
}

function receiveParentMessage(event: MessageEvent) {
  if (event.origin !== location.origin || event.source !== specterFrame.contentWindow) return;
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'child-awaiting-peripherals') {
    specterFrame.contentWindow?.postMessage({ type: 'peripherals-provide', files: [] }, location.origin);
  } else if (data.type === 'simulator-running') {
    specterBadge.textContent = 'Running';
    specterBadge.classList.add('online');
    specterStatus.textContent = 'Specter DIY firmware is running locally in the browser.';
  } else if (data.type === 'simulator-error') {
    specterBadge.textContent = 'Needs attention';
    specterBadge.classList.remove('online');
    specterStatus.textContent = `Specter failed to start: ${data.message}`;
  } else if (data.type === 'simulator-scanner-state') {
    specterScannerActive = Boolean(data.active);
    updateSpecterControls();
  } else if (data.type === 'simulator-qr-output') {
    acceptSpecterFrame(data.frame);
  } else if (data.type === 'simulator-qr-result') {
    specterQrStatus.textContent = data.ok ? 'QR frame reached Specter DIY’s normal scanner input.' : data.message;
    if (!data.ok) setScanStatus(data.message, true);
  }
}

window.addEventListener('message', receiveParentMessage);
specterFrame.addEventListener('load', () => {
  specterFrame.contentWindow?.postMessage({ type: 'gallery-parent-ready' }, location.origin);
});

class KeeperScannerAdapter {
  private ur = createKeeperUrDecoder();
  private bbqr: (string | null)[] = [];
  private psbtChunks: (string | null)[] = [];
  private lastFrame = '';

  reset() {
    this.ur = createKeeperUrDecoder();
    this.bbqr = [];
    this.psbtChunks = [];
    this.lastFrame = '';
  }

  feed(frame: string): { complete?: unknown; progress?: number } {
    const text = frame.trim();
    if (!text || text === this.lastFrame) return {};
    this.lastFrame = text;
    if (text.startsWith('UR:') || text.startsWith('ur:')) {
      const result = decodeKeeperUr(this.ur, text);
      return result.data === null || result.data === undefined
        ? { progress: result.percentage }
        : { complete: result.data, progress: result.percentage };
    }
    if (text.startsWith('B$')) {
      const { total, index } = extractBBQRIndex(text);
      if (total < 1 || total > 999 || index < 1 || index > total) throw new Error('Invalid BBQR frame number.');
      if (this.bbqr.length !== total) this.bbqr = Array(total).fill(null);
      this.bbqr[index - 1] = text;
      const count = this.bbqr.filter(Boolean).length;
      if (count !== total) return { progress: Math.floor((count / total) * 100) };
      const joined = joinQRs(this.bbqr as string[]);
      return { complete: normalizeRawQrBytes(joined.raw), progress: 100 };
    }
    const chunk = text.match(/^p(\d+)of(\d+)\s+(.+)$/i);
    if (chunk) {
      const index = Number(chunk[1]);
      const total = Number(chunk[2]);
      if (index < 1 || index > total || total > 999) throw new Error('Invalid animated QR frame number.');
      if (this.psbtChunks.length !== total) this.psbtChunks = Array(total).fill(null);
      this.psbtChunks[index - 1] = chunk[3];
      const count = this.psbtChunks.filter(Boolean).length;
      if (count !== total) return { progress: Math.floor((count / total) * 100) };
      return { complete: this.psbtChunks.join(''), progress: 100 };
    }
    if (/^[0-9a-f]+$/i.test(text) && text.length % 2 === 0) {
      const raw = Buffer.from(text, 'hex');
      try { return { complete: bitcoinJS.Psbt.fromBuffer(raw, { network: bitcoinJS.networks.testnet }).toBase64(), progress: 100 }; }
      catch { return { complete: text, progress: 100 }; }
    }
    return { complete: text, progress: 100 };
  }
}

const keeperScanner = new KeeperScannerAdapter();

function normalizeRawQrBytes(raw: Uint8Array) {
  const asText = Buffer.from(raw).toString('utf8');
  try { return JSON.parse(asText); } catch { /* a binary PSBT is tried next */ }
  try { return bitcoinJS.Psbt.fromBuffer(Buffer.from(raw), { network: bitcoinJS.networks.testnet }).toBase64(); }
  catch { return Buffer.from(raw).toString('base64'); }
}

async function processCompletedPayload(payload: unknown) {
  stopCamera();
  stopDirectScan();
  if (state.screen === 'scan-signer') {
    const vault = await createVaultFromSpecterQr(payload);
    state.vault = vault;
    state.signed = undefined;
    state.psbt = undefined;
    state.screen = 'home';
    persist();
    render();
    return;
  }
  if (state.screen === 'scan-psbt') {
    if (!state.vault || !state.psbt) throw new Error('Keeper no longer has the matching PSBT request.');
    let psbtText: string;
    if (typeof payload === 'string') psbtText = payload;
    else if (payload && typeof payload === 'object' && typeof (payload as any).psbt === 'string') psbtText = (payload as any).psbt;
    else throw new Error('Keeper received a QR payload that is not a signed PSBT.');
    const result = inspectKeeperPsbt(psbtText, state.vault, state.psbt.base64);
    state.signed = result;
    state.screen = 'home';
    persist();
    render();
    return;
  }
}

async function feedKeeperScanner(frame: string) {
  try {
    const result = keeperScanner.feed(frame);
    const percent = result.progress;
    if (percent !== undefined && percent < 100) setScanStatus(`Animated QR sequence: ${percent}% received.`);
    if (result.complete !== undefined) {
      setScanStatus('QR data received. Keeper is validating it…');
      await processCompletedPayload(result.complete);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setScanStatus(`QR could not be processed: ${message}`, true);
  }
}

function consumeDirectSpecterFrames() {
  if (directScanTimer === undefined) return;
  if (Date.now() - directScanStartedAt > 90_000) {
    stopDirectScan();
    setScanStatus('Timed out waiting for a complete QR sequence. Keep the Specter QR visible and try again.', true);
    return;
  }
  if (directScanFrameIndex >= specterQrFrames.length) return;
  const frame = specterQrFrames[directScanFrameIndex++];
  void feedKeeperScanner(frame);
}

function beginDirectSpecterScan() {
  if (!specterQrFrames.length || Date.now() - specterQrLastAt > 5000) {
    setScanStatus('No QR is currently visible on Specter DIY. Open a QR screen there, then scan again.', true);
    return;
  }
  keeperScanner.reset();
  directScanFrameIndex = 0;
  directScanStartedAt = Date.now();
  setScanStatus(`Reading ${specterQrFrames.length} visible Specter QR frame(s)…`);
  directScanTimer = window.setInterval(consumeDirectSpecterFrames, 250);
  consumeDirectSpecterFrames();
}

function beginSendToSpecter() {
  const frames = state.psbt?.frames;
  if (!frames?.length) {
    specterQrStatus.textContent = 'Prepare a Keeper testnet PSBT first.';
    return;
  }
  if (!specterScannerActive) {
    specterQrStatus.textContent = 'Open the QR scanner on Specter DIY before sending frames.';
    return;
  }
  stopSendingQr();
  let count = 0;
  sendQrTimer = window.setInterval(() => {
    if (!specterScannerActive || count >= frames.length * 3) {
      stopSendingQr();
      return;
    }
    const frame = frames[visibleKeeperFrameIndex % frames.length];
    specterFrame.contentWindow?.postMessage({ type: 'simulator-inject-qr', frame }, location.origin);
    count++;
  }, 500);
  const frame = frames[visibleKeeperFrameIndex % frames.length];
  specterFrame.contentWindow?.postMessage({ type: 'simulator-inject-qr', frame }, location.origin);
  count++;
  specterQrStatus.textContent = frames.length > 1
    ? `Sending animated Keeper UR frames to Specter DIY (${frames.length} unique frame(s)).`
    : 'Sending the Keeper QR frame to Specter DIY.';
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setScanStatus('Camera unavailable. Use direct simulator scanning or paste QR text.', true);
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
    const surface = app.querySelector<HTMLElement>('#camera-surface');
    const video = app.querySelector<HTMLVideoElement>('#camera-video');
    if (!surface || !video) { stopCamera(); return; }
    surface.removeAttribute('hidden');
    video.srcObject = cameraStream;
    await video.play();
    setScanStatus('Camera is active. Point it at a Keeper or Specter QR.');
    const request = ++cameraFrameRequest;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const scan = () => {
      if (request !== cameraFrameRequest || !cameraStream || !video.videoWidth || !context) return;
      const scale = Math.min(1, 800 / video.videoWidth);
      canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const qr = (window as any).jsQR?.(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
      if (qr?.data && qr.data !== lastCameraPayload) {
        lastCameraPayload = qr.data;
        void feedKeeperScanner(qr.data);
      }
      cameraFrameRequest = requestAnimationFrame(scan);
    };
    cameraFrameRequest = requestAnimationFrame(scan);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setScanStatus(`Camera could not start: ${message}. You can still use direct scanning.`, true);
  }
}

async function onAction(action: string, button: HTMLButtonElement) {
  try {
    switch (action) {
      case 'add-specter':
      case 'scan-signer':
        keeperScanner.reset();
        setScreen('scan-signer');
        break;
      case 'camera':
        lastCameraPayload = '';
        await startCamera();
        break;
      case 'stop-camera':
        stopCamera();
        setScanStatus('Camera stopped.');
        break;
      case 'scan-specter':
        beginDirectSpecterScan();
        break;
      case 'submit-manual': {
        const input = app.querySelector<HTMLTextAreaElement>('#qr-manual')?.value || '';
        if (!input.trim()) { setScanStatus('Paste a QR payload first.', true); break; }
        keeperScanner.reset();
        for (const frame of input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
          await feedKeeperScanner(frame);
          if (state.screen !== 'scan-signer' && state.screen !== 'scan-psbt') break;
        }
        break;
      }
      case 'receive':
        setScreen('receive');
        break;
      case 'prepare-psbt': {
        if (!state.vault) throw new Error('Add Specter DIY as an external signer first.');
        button.disabled = true;
        button.textContent = 'Building real Keeper PSBT…';
        const psbt = prepareKeeperPsbt(state.vault);
        state.psbt = psbt;
        state.signed = undefined;
        state.screen = 'show-psbt';
        persist();
        render();
        break;
      }
      case 'scan-psbt':
        if (!state.psbt) throw new Error('Prepare the Keeper PSBT first.');
        keeperScanner.reset();
        setScreen('scan-psbt');
        break;
      case 'back-home':
        setScreen(state.vault ? 'home' : 'welcome');
        break;
      case 'back':
        setScreen(state.screen === 'scan-psbt' ? 'show-psbt' : state.vault ? 'home' : 'welcome');
        break;
      case 'reset-keeper':
        stopCamera(); stopDirectScan(); stopSendingQr();
        sessionStorage.removeItem(STORAGE_KEY);
        state = { version: 1, screen: 'welcome' };
        keeperScanner.reset();
        render();
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setScanStatus(message, true);
  }
}

document.querySelector<HTMLButtonElement>('#specter-restart')?.addEventListener('click', () => {
  specterFrame.contentWindow?.postMessage({ type: 'runtime-restart' }, location.origin);
});
document.querySelector<HTMLButtonElement>('#specter-reset')?.addEventListener('click', () => {
  specterFrame.contentWindow?.postMessage({ type: 'simulator-factory-reset' }, location.origin);
  specterQrFrames = [];
  specterQrLast = '';
  specterQrLastAt = 0;
  specterStatus.textContent = 'Factory reset requested. Specter’s disposable simulator state is being cleared.';
});
sendKeeperQrButton.addEventListener('click', beginSendToSpecter);

const clock = document.querySelector<HTMLElement>('#clock');
if (clock) {
  const updateClock = () => { clock.textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date()); };
  updateClock();
  window.setInterval(updateClock, 30_000);
}

render();
if (state.screen === 'scan-signer' || state.screen === 'scan-psbt') {
  setScanStatus('Select “Scan from Specter DIY” when its QR is visible, or use the camera.');
}
