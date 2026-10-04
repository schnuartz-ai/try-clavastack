import { launchBullBrowser } from './bull/test-browser.mjs';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import { address, networks } from 'bitcoinjs-lib';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8778';
const browser = await launchBullBrowser();
const page = await browser.newPage({viewport:{width:1512,height:1100}});
const errors = [], checks = [];
page.on('pageerror',error=>errors.push(error.message));
page.on('crash',()=>console.error('BULL CHROMIUM PAGE CRASHED'));
await page.addInitScript(() => {
  window.__bullTestFrames=[];
  window.__bullMountedMessages=0;
  addEventListener('message',event=>{
    if(event.origin===location.origin && event.data?.type==='bull-qr-output-frame') window.__bullTestFrames.push(event.data.frame);
    if(event.origin===location.origin && event.data?.type==='bull-app-mounted') window.__bullMountedMessages++;
  });
});
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
async function semantics(app) {
  const placeholder = app.locator('flt-semantics-placeholder');
  await placeholder.waitFor({state:'attached',timeout:90000});
  await placeholder.evaluate(element=>element.click());
}
try {
  await page.goto(`${base}/bull-bitcoin/`);
  const app = page.frameLocator('#bull-runtime');
  await semantics(app);
  await app.getByRole('button',{name:/^Next/}).click();
  await app.getByRole('button',{name:/^Next/}).click();
  await app.getByRole('button',{name:/^No/}).click();
  await app.getByRole('button',{name:/Get started/i}).click();
  await app.getByRole('button',{name:/Create New Wallet/}).click({timeout:90000});
  await app.getByRole('button',{name:/^Receive/}).waitFor({timeout:90000});
  pass('Original Bull wizard and native Bitcoin/Liquid wallet creation');
  const mountedBefore=await page.evaluate(()=>window.__bullMountedMessages);
  await page.evaluate(()=>document.querySelector('#bull-runtime').contentWindow.postMessage({type:'bull-runtime-ready-ack'},location.origin));
  await page.waitForFunction(previous=>window.__bullMountedMessages>previous,mountedBefore);
  pass('A late workbench handshake reannounces the actually mounted native app');
  await app.getByRole('button',{name:/^Receive/}).click();
  await page.waitForTimeout(5000);
  const receive = await page.evaluate(()=>window.__bullTestFrames.at(-1));
  assert.match(receive, /^tb1q/);
  assert.equal(address.toOutputScript(receive,networks.testnet).length,22);
  pass('Native BDK Testnet3 receive address and original QR display bridge');
  await page.reload(); await semantics(app);
  await app.getByRole('button',{name:/^Receive/}).click({timeout:90000});
  await page.waitForFunction(value=>window.__bullTestFrames.includes(value),receive,{timeout:30000});
  pass('Normal reload preserves original native wallet and receive address');
  const label={type:'addr',ref:receive,label:'Clava public browser acceptance'};
  await page.locator('#sd-picker').setInputFiles({name:'public-labels.jsonl',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(label)+'\n')});
  await page.getByText('public-labels.jsonl',{exact:false}).first().waitFor();
  await page.locator('#sd-token').click();
  await page.locator('[data-media-target="desktop"]').click();
  await page.waitForTimeout(500);
  await app.locator('body').evaluate(()=>{location.hash='/labels';});
  await app.getByRole('button',{name:/^Import Labels/}).evaluate(element=>element.click());
  await app.getByRole('button',{name:'Open virtual SD card'}).click();
  await app.getByRole('button',{name:/^public-labels.jsonl/}).click();
  await page.waitForTimeout(1500);
  await app.getByRole('button',{name:/^Export Labels/}).evaluate(element=>element.click());
  await app.getByRole('button',{name:'Save to virtual SD card in Bull Bitcoin'}).click();
  await page.waitForTimeout(800);
  const exported=await app.locator('body').evaluate(()=>{
    const prefix='clava.bull-bitcoin.'+sessionStorage.getItem('clava.bull-bitcoin.session')+'.';
    return Object.entries(JSON.parse(sessionStorage.getItem(prefix+'files')??'{}'))
      .filter(([name])=>name.startsWith('/downloads/bull_labels_')).map(([name,file])=>({name,bytes:file.bytes}));
  });
  assert.equal(exported.length,1);
  const records=Buffer.from(exported[0].bytes,'base64').toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(records.some(record=>record.type===label.type&&record.ref===label.ref&&record.label===label.label));
  const sd=await page.evaluate(async name=>{
    const db=await new Promise(resolve=>{const request=indexedDB.open('clavastack-bull-bitcoin-removable-media-v1');request.onsuccess=()=>resolve(request.result);});
    const files=await new Promise(resolve=>{const request=db.transaction('files').objectStore('files').getAll();request.onsuccess=()=>resolve(request.result);});
    db.close();return [...new Uint8Array(files.find(file=>file.path.endsWith(name)).bytes)];
  },exported[0].name.split('/').pop());
  assert.deepEqual(sd,[...Buffer.from(exported[0].bytes,'base64')]);
  pass('Original BIP329 import/parser/export transfers unchanged label bytes through the shared SD dialogs');
  await app.locator('body').evaluate(()=>{location.hash='/wallet';});
  await app.getByRole('button',{name:/^Receive/}).waitFor();
  // Seven taps on the original Bull logo unlock its original developer menu.
  for(let tap=0;tap<7;tap++){
    await app.getByRole('button').evaluateAll(elements=>elements.find(element=>{
      const box=element.getBoundingClientRect();return box.x>150&&box.x<210&&box.y<20;
    }).click());
    await page.waitForTimeout(100);
  }
  await app.locator('body').evaluate(()=>{location.hash='/settings/app-settings';});
  await app.getByRole('group',{name:'Dev Mode',exact:true}).getByRole('switch').evaluate(element=>element.click());
  await app.getByRole('button',{name:/^I understand/}).evaluate(element=>element.click());
  const testnetSwitch=()=>app.getByRole('group',{name:'Testnet Mode',exact:true}).getByRole('switch');
  assert.equal(await testnetSwitch().getAttribute('aria-checked'),'true');
  await testnetSwitch().evaluate(element=>element.click());
  await app.getByText(/Switch to Mainnet\?/).waitFor();
  await app.getByRole('button',{name:/^I understand/}).evaluate(element=>element.click());
  await page.waitForTimeout(500);
  await page.reload();await semantics(app);
  // This fresh test has no Mainnet wallet. Wait for the original startup
  // redirect to onboarding before opening its settings route.
  await app.getByRole('button',{name:/Create New Wallet/}).waitFor({timeout:90000});
  await app.locator('body').evaluate(()=>{location.hash='/settings/app-settings';});
  await testnetSwitch().waitFor();
  assert.equal(await testnetSwitch().getAttribute('aria-checked'),'false');
  await testnetSwitch().evaluate(element=>element.click());
  await app.getByText(/Switch to Testnet\?/).waitFor();
  await app.getByRole('button',{name:/^I understand/}).evaluate(element=>element.click());
  await page.waitForTimeout(500);
  assert.equal(await testnetSwitch().getAttribute('aria-checked'),'true');
  pass('Original network switch persists an explicit Mainnet choice across reload and returns to Testnet');
  const retired=await app.locator('body').evaluate(async()=>{
    sessionStorage.setItem('keeper:bull-reset-audit','public sentinel');
    const db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('bull-reset-unrelated-audit');
      request.onupgradeneeded=()=>request.result.createObjectStore('public');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    db.close();
    return sessionStorage.getItem('clava.bull-bitcoin.session');
  });
  await page.locator('#bull-reset').click();
  await page.waitForTimeout(2000);await semantics(app);
  await app.getByRole('button',{name:/^Next/}).waitFor({timeout:90000});
  const reset=await app.locator('body').evaluate(async previous=>{
    const dbs=(await indexedDB.databases()).map(db=>db.name);
    const root=await navigator.storage.getDirectory();
    let entries=[];
    try{const drift=await root.getDirectoryHandle('drift_db');for await(const [name] of drift.entries())entries.push(name);}catch(error){if(error.name!=='NotFoundError')throw error;}
    return {session:sessionStorage.getItem('clava.bull-bitcoin.session'),
      oldKeys:Object.keys(sessionStorage).filter(key=>key.startsWith(`clava.bull-bitcoin.${previous}.`)),
      oldDatabases:dbs.filter(name=>name.includes(previous)),oldFiles:entries.filter(name=>name.includes(previous)),
      foreignDatabase:dbs.includes('bull-reset-unrelated-audit'),foreignSession:sessionStorage.getItem('keeper:bull-reset-audit'),
      pending:sessionStorage.getItem('clava.bull-bitcoin.reset-pending')};
  },retired);
  assert.notEqual(reset.session,retired);assert.deepEqual(reset.oldKeys,[]);
  assert.deepEqual(reset.oldDatabases,[]);assert.deepEqual(reset.oldFiles,[]);assert.equal(reset.pending,null);
  assert.equal(reset.foreignDatabase,true);assert.equal(reset.foreignSession,'public sentinel');
  pass('Reset removes only Bull session files/native databases and returns to the original wizard');
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/bull-app.png',fullPage:true});
  assert.deepEqual(errors,[]);
  await writeFile('test-results/bull-app.json',JSON.stringify({checks,errors},null,2));
} catch(error) {
  // Keep the original failure visible even if Chromium cannot take a crash
  // screenshot. Diagnostics must not replace the actual acceptance failure.
  console.error('BULL ACCEPTANCE FAILURE',error);
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/bull-app-failure.png',fullPage:true}).catch(screenshotError=>{
    console.error('BULL FAILURE SCREENSHOT',screenshotError.message);
  });
  console.error('BULL UI',await page.frameLocator('#bull-runtime').locator('body').innerText().catch(()=>''));
  console.error('BROWSER ERRORS',errors);
  console.error('STARTUP DIAGNOSTIC', await page.frameLocator('#bull-runtime').locator('body').evaluate(() => {
    const prefix = 'clava.bull-bitcoin.' + sessionStorage.getItem('clava.bull-bitcoin.session') + '.';
    const files = JSON.parse(sessionStorage.getItem(prefix+'files') ?? '{}');
    return Object.entries(files).flatMap(([path,file]) => path.includes('log') ? atob(file.bytes).split('\n').filter(line=>line.includes('App Init Error')||line.includes('App startup failed')).map(line=>line.split('\t')[3]?.slice(0,400)) : []);
  }).catch(()=>[]));
  throw error;
} finally { await browser.close(); }
