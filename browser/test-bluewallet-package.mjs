import {chromium} from 'playwright';
import {mockBlockstreamTestnet3} from './mock-blockstream-testnet3.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8769';
const manifest=await (await fetch(`${base}/builds/bluewallet-web/build-info.json`)).json();
assert.equal(manifest.commit,'0a53056a636370073a58d6cdd6de5c0728e5926a');assert.equal(manifest.network,'testnet3');assert.equal(manifest.broadcast,true);assert.equal(manifest.backend,'Blockstream Esplora');assert.equal(manifest.endpoint,'https://blockstream.info/testnet/api');
assert(manifest.inputs.some(name=>name.endsWith('/App.tsx')));assert(manifest.inputs.some(name=>name.endsWith('/screen/wallets/ImportWallet.tsx')));assert(manifest.files['licenses.txt']);
for(const [name,sha] of Object.entries(manifest.files)){const response=await fetch(`${base}/builds/bluewallet-web/${name}`);assert(response.ok,name);assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),sha,name);}
for(const path of ['blue-wallet/LICENSE.txt','blue-wallet/THIRD-PARTY-NOTICES.txt','blue-wallet/bridge.js','browser/companion-media.js','browser/companion-file-dialog.js','browser/demo-import.js','assets/bluewallet-logo.png'])assert((await fetch(`${base}/${path}`)).ok,path);
const runtime=await (await fetch(`${base}/blue-wallet/runtime.html`)).text();assert(runtime.includes(`bluewallet-app.js?v=${manifest.browserVersion}`));
// The same strict upstream import/signing test must pass from the staged package.
execFileSync(process.execPath,['browser/test-bluewallet.mjs'],{stdio:'inherit',env:{...process.env,TEST_BASE_URL:base}});
const browser=await chromium.launch({...(process.env.CI?{}:{channel:'chrome'}),headless:true});
try{
 const page=await browser.newPage({viewport:{width:1512,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await mockBlockstreamTestnet3(page);await page.goto(`${base}/blue-wallet/`);await page.frameLocator('#blue-runtime').getByTestId('Wallets').waitFor({timeout:60000});await page.getByText('TESTNET3 · CONNECTED',{exact:true}).waitFor({timeout:15000});await page.locator('#specter-badge').getByText('Running',{exact:true}).waitFor({timeout:90000});await page.locator('#blue-status').getByText('BlueWallet is running in this browser.',{exact:true}).waitFor();
 assert.deepEqual(await page.locator('#demo-network option').evaluateAll(nodes=>nodes.map(n=>n.value)),['','testnet']);assert.equal(await page.locator('.media-group').count(),3);
 await mkdir('test-results/bluewallet',{recursive:true});await page.screenshot({path:'test-results/bluewallet/package-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/bluewallet/package-mobile.png',fullPage:true});assert(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 await writeFile('test-results/bluewallet/package.json',JSON.stringify({manifestVersion:manifest.browserVersion,filesVerified:Object.keys(manifest.files),errors},null,2));
 console.log('PASS packaged production URL: exact asset/license hashes, original app import/signing and desktop/mobile layout');
}finally{await browser.close();}
