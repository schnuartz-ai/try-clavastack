import { chromium } from 'playwright';
import net from 'node:net';

const base = process.env.VIRTUAL_HOST_URL || 'http://127.0.0.1:8788';
const browser = await chromium.launch({ headless: true });
const stalePage = await browser.newPage({ viewport: { width: 900, height: 1000 } });
await stalePage.goto(`${base}/connected?probe=usb`, { waitUntil: 'domcontentloaded' });
await stalePage.waitForFunction(() => document.querySelector('#virtual-host-status')?.classList.contains('waiting'),
  null, { timeout: 15000 });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto(`${base}/connected?probe=usb`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#debug-log')?.textContent.includes('worker-created') &&
  document.querySelector('#virtual-host-status')?.classList.contains('waiting'), null, { timeout: 15000 });
await stalePage.locator('#virtual-host').evaluate(element => { element.open = true; });
await stalePage.locator('#virtual-host-status-text')
  .getByText('Inactive — another connected simulator tab is open').waitFor({ timeout: 5000 });

const response = await new Promise((resolve, reject) => {
  const socket = net.createConnection({ host: '127.0.0.1', port: 8789 });
  const chunks = [];
  const expected = Buffer.from('ACK\r\n\r\n\r\nvirtual-host-e2e\r\n\r\n');
  const timer = setTimeout(() => {
    socket.destroy();
    reject(new Error('Timed out waiting for the browser USB response'));
  }, 10000);
  socket.on('connect', () => socket.write('\r\n\r\nvirtual-host-e2e\r\n'));
  socket.on('data', chunk => {
    chunks.push(chunk);
    const data = Buffer.concat(chunks);
    if (data.length >= expected.length) {
      clearTimeout(timer);
      socket.end();
      resolve(data.toString('utf8'));
    }
  });
  socket.on('error', error => {
    clearTimeout(timer);
    reject(error);
  });
});

if (response !== 'ACK\r\n\r\n\r\nvirtual-host-e2e\r\n\r\n') {
  throw new Error(`Unexpected Virtual Host response: ${JSON.stringify(response)}`);
}
await page.locator('#st').getByText('Running locally').waitFor({ timeout: 10000 });
if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
console.log(JSON.stringify({ result: 'pass', staleTab: 'superseded without reconnecting',
  route: 'TCP 8789 → Virtual Host → browser Worker → USB_VCP → TCP 8789' }, null, 2));
await browser.close();
