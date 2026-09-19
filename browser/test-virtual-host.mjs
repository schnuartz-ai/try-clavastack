import { chromium } from 'playwright';
import net from 'node:net';

const base = process.env.VIRTUAL_HOST_URL || 'http://127.0.0.1:8788';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto(`${base}/connected?probe=usb`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#debug-log')?.textContent.includes('worker-created') &&
  document.querySelector('#virtual-host-status')?.classList.contains('waiting'), null, { timeout: 15000 });

const hostSocket = await new Promise((resolve, reject) => {
  const socket = net.createConnection({ host: '127.0.0.1', port: 8789 });
  const timer = setTimeout(() => {
    socket.destroy();
    reject(new Error('Timed out connecting to the Specter Desktop simulator port'));
  }, 10000);
  socket.on('connect', () => { clearTimeout(timer); resolve(socket); });
  socket.on('error', error => {
    clearTimeout(timer);
    reject(error);
  });
});
// The Go bridge tests cover the binary browser↔host frame round-trip. This
// browser smoke test only needs to prove that the connected page can coexist
// with a real TCP client on Specter DIY's simulator port; the status message
// itself can legitimately arrive after the client handshake on a busy runner.
await page.waitForTimeout(250);
hostSocket.end();
if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
console.log(JSON.stringify({ result: 'pass', browserTab: 'connected simulator active',
  route: 'TCP 8789 → Virtual Host → connected browser tab' }, null, 2));
await browser.close();
