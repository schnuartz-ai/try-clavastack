import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createDemoFiles} from './demo-data.js';
import QRCode from 'qrcode';
import * as bip39 from 'bip39';
import {Psbt,Transaction,script} from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8765';
const demo=createDemoFiles('testnet'),fixture=new TextDecoder().decode(demo.files.find(f=>f.name==='testnet-ghost-payment-low-fee.psbt').bytes).trim();
const browser=await chromium.launch({...(process.env.CI?{}:{channel:'chrome'}),headless:true});
const context=await browser.newContext({viewport:{width:1512,height:1100}}),page=await context.newPage();
const errors=[],checks=[];const pass=name=>{checks.push(name);console.log('PASS '+name);};
let publicBroadcastAttempts=0;
await context.route('https://blockstream.info/testnet/api/tx',async route=>{publicBroadcastAttempts++;await route.abort();});
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
// Public fixture at the native firmware test-keystore boundary. Original QRHost,
// confirmation GUI, signing and QR generation execute without substitution.
const boot=await readFile(new URL('runtime/boot.py',import.meta.url),'utf8');
const fixtureBoot=boot.replace('main.main()',`from keystore.ram import RAMKeyStore
class PublicFixtureKeyStore(RAMKeyStore):
    async def init(self, show_fn, show_loader):
        await super().init(show_fn, show_loader)
        self.set_mnemonic(${JSON.stringify(demo.roots.ghost.mnemonic)})
async def public_fixture_menu(self):
    self.init_apps()
    for host in self.hosts:
        if host.button:
            await host.enable()
    return self.mainmenu
main.Specter.initmenu = public_fixture_menu
main.main(network="test", keystore_cls=PublicFixtureKeyStore)`);
await context.route('**/browser/runtime-worker.js*',async route=>{const response=await route.fetch(),source=await response.text(),anchor='const usbWalletProbe = data.usbWalletProbe';assert(source.includes(anchor));await route.fulfill({response,body:source.replace(anchor,'data.usbWalletProbe = true;\n    '+anchor)});});
await context.route('**/browser/runtime/usb-wallet-probe.py',route=>route.fulfill({body:fixtureBoot,contentType:'text/plain'}));
await context.route('**/blue-wallet/',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('src="/blue-wallet/runtime.html"','src="/blue-wallet/runtime.html?test=1"')});});
await context.addInitScript(()=>{
 if(location.pathname==='/blue-wallet/runtime.html')Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{throw new DOMException('Denied in test','NotAllowedError');}});
 window.__qrAudit={blue:[],diy:[],scanner:false};addEventListener('message',event=>{if(event.origin!==location.origin)return;const data=event.data;if(data?.type==='blue-qr-output-frame')window.__qrAudit.blue.push(data.frame);if(data?.type==='simulator-qr-output')window.__qrAudit.diy.push(data.frame);if(data?.type==='simulator-scanner-state')window.__qrAudit.scanner=Boolean(data.active);});
});
const app=page.frameLocator('#blue-runtime'),canvas=page.frameLocator('#specter-simulator').locator('#screen');
const idle=async()=>{await page.locator('#sd-add:not(:disabled)').waitFor({timeout:30000});await page.waitForTimeout(150);};
const moveSd=async target=>{if((await page.locator('#sd-token').getAttribute('aria-label')).includes('Inserted in')){await page.locator('#sd-token').click();await idle();}await page.locator('#sd-token').click();await page.locator(`[data-media-target="${target}"]`).click();await idle();};
const media=()=>page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('clavastack-bluewallet-testnet3-removable-media-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const files=await new Promise(resolve=>{const r=db.transaction('files').objectStore('files').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return Object.fromEntries(files.map(f=>[f.path,Array.from(new Uint8Array(f.bytes))]));});
async function tap(x,y){await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();await page.mouse.click(box.x+x/480*box.width,box.y+y/800*box.height,{delay:80});await page.waitForTimeout(500);}
try{
 await mkdir('test-results/bluewallet',{recursive:true});await page.goto(`${base}/blue-wallet/`);
 await app.getByTestId('Wallets').waitFor({timeout:60000});await page.locator('#specter-badge').getByText('Running',{exact:true}).waitFor({timeout:90000});await idle();
 assert.equal(await page.locator('.media-grid > .media-group').count(),3);
 assert.deepEqual(await page.locator('#demo-network option').evaluateAll(options=>options.map(o=>o.value)),['','testnet']);
 await page.locator('#sd-picker').setInputFiles({name:'keep.bin',mimeType:'application/octet-stream',buffer:Buffer.from([0,255,42])});await idle();
 await page.locator('#demo-network').selectOption('testnet');await page.locator('#demo-network:not(:disabled)').waitFor({timeout:30000});await idle();
 let files=await media();for(const f of demo.files)assert.deepEqual(files['sd/'+f.name],[...f.bytes]);for(const c of demo.cards){assert.deepEqual(files[`cards/${c.slot}/secret.bin`],[...c.secret]);assert(files[`cards/${c.slot}/private.key`]?.length);}
 pass('Shared Testnet-only panel imports unchanged public files and real firmware cards');
 await moveSd('desktop');console.log('SD MOVED',await page.locator('#sd-token').getAttribute('aria-label'),await page.locator('#blue-status').innerText());await app.getByText('Add now',{exact:true}).click();await app.getByTestId('ImportWallet').click();
 await app.getByTestId('ScanImport').click({button:'right'});await app.getByRole('menuitem',{name:'Import File',exact:true}).click();
 assert((await page.locator('#sd-location').innerText()).includes('BlueWallet'));
 await app.getByRole('button',{name:'Open virtual SD card',exact:true}).click();await app.getByRole('button',{name:/01-ghost-PUBLIC-TEST-SEED.txt/}).click();
 await app.getByText('HD SegWit (BIP84 Bech32 Native)',{exact:true}).waitFor();await app.getByText('HD SegWit (BIP84 Bech32 Native)',{exact:true}).click();await app.getByRole('button',{name:'Import',exact:true}).click();await app.getByRole('button',{name:'OK',exact:true}).click();
 const native=page.frames().find(f=>f.url().includes('/blue-wallet/runtime.html'));
 const wallet=await native.evaluate(()=>{const w=window.__blueTest.BlueApp.getInstance().getWallets()[0];return {id:w.getID(),type:w.type,label:w.getLabel(),address:w._getExternalAddressByIndex(0)};});
 assert.equal(wallet.type,'HDsegwitBech32');assert(wallet.address.startsWith('tb1'));await app.getByText(wallet.label,{exact:true}).first().waitFor();
 pass('Original file menu imports Ghost through the shared SD picker and saves the wallet');
 // Real scan route and real image decode: only the camera permission is denied.
 await native.evaluate(()=>window.__blueTest.navigationRef.navigate('AddWalletRoot',{screen:'ImportWallet'}));await app.getByTestId('ScanImport').click();await app.getByRole('button',{name:'Use camera',exact:true}).click();await app.getByText('Camera access was denied. Use a QR image or Specter DIY.',{exact:true}).waitFor();
 const reference='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';const standard=reference.split(' ').map(w=>String(bip39.wordlists.english.indexOf(w)).padStart(4,'0')).join('');
 const chooserPromise=page.waitForEvent('filechooser');await app.getByRole('button',{name:'Choose QR image',exact:true}).click();const chooser=await chooserPromise;await chooser.setFiles({name:'public-standard-seedqr.png',mimeType:'image/png',buffer:await QRCode.toBuffer(standard,{width:512,margin:4})});
 await app.getByText('HD SegWit (BIP84 Bech32 Native)',{exact:true}).waitFor({timeout:30000});
 pass('Camera denial recovers via decoded Standard SeedQR image into the original discovery UI');
 // Open an original upstream hardware-PSBT route with the imported real wallet.
 await native.evaluate(({id,fixture})=>window.__blueTest.navigationRef.navigate('SendDetailsRoot',{screen:'PsbtWithHardwareWallet',params:{walletID:id,psbt:window.__blueTest.bitcoin.Psbt.fromBase64(fixture)}}),{id:wallet.id,fixture});
 await app.getByTestId('TextHelperForPSBT').waitFor();await page.waitForFunction(()=>new Set(window.__qrAudit.blue).size>=2,undefined,{timeout:20000});
 // Original SaveFileButton, original writeFileAndExport, shared dialog and SD.

 await app.getByText('Export to file',{exact:true}).click();await app.getByRole('menuitem',{name:/^Save(?:\.\.\.|…)?$/}).click();await app.getByRole('button',{name:'Save to virtual SD card in BlueWallet',exact:true}).click();await idle();
 files=await media();const exportPath=Object.keys(files).find(path=>/^sd\/\d+.*\.psbt$/.test(path));assert(exportPath);assert.equal(new TextDecoder().decode(Uint8Array.from(files[exportPath])).trim(),fixture);
 await moveSd('diy');await page.locator('#sd-refresh').click();await idle();assert.equal(new TextDecoder().decode(Uint8Array.from((await media())[exportPath])).trim(),fixture);
 pass('Original PSBT export preserves bytes across BlueWallet → shared SD → real Specter firmware');
 await tap(240,440);await page.waitForFunction(()=>window.__qrAudit.scanner,undefined,{timeout:15000});await page.locator('#send-blue-qr').click();await page.waitForFunction(()=>!window.__qrAudit.scanner,undefined,{timeout:30000});await page.waitForTimeout(2000);await canvas.screenshot({path:'test-results/bluewallet/specter-review.png'});
 await tap(360,740);await page.waitForFunction(()=>window.__qrAudit.diy.length>0,undefined,{timeout:30000});
 await app.getByTestId('PsbtTxScanButton').click();await app.getByRole('button',{name:'Scan from Specter DIY',exact:true}).click();
 await app.locator('textarea[readonly]').waitFor({timeout:30000});const hex=await app.locator('textarea[readonly]').inputValue();
 const tx=Transaction.fromHex(hex),unsigned=Psbt.fromBase64(fixture),[encoded,pubkey]=tx.ins[0].witness,decoded=script.signature.decode(encoded),prev=unsigned.data.inputs[0].witnessUtxo;
 assert(ecc.verify(tx.hashForWitnessV0(0,script.compile([118,169,prev.script.subarray(2),136,172]),prev.value,decoded.hashType),pubkey,decoded.signature));assert.deepEqual(tx.outs,unsigned.txOutputs.map(o=>({script:o.script,value:o.value})));
 assert(await app.getByTestId('PsbtWithHardwareWalletBroadcastTransactionButton').isEnabled());
 assert.equal(publicBroadcastAttempts,0,'the test must not send a transaction to public Testnet');
 pass('Original BlueWallet animated PSBT QR → original Specter QRHost/review/signing → original BlueWallet parser; independent signature verification and Testnet broadcast available without sending');
 await page.screenshot({path:'test-results/bluewallet/workbench-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/bluewallet/workbench-mobile.png',fullPage:true});assert(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);await writeFile('test-results/bluewallet/media.json',JSON.stringify({checks,errors,exportPath,txid:tx.getId(),hex,signatureVerified:true},null,2));
}catch(error){await page.screenshot({path:'test-results/bluewallet/media-failure.png',fullPage:true});throw error;}finally{await browser.close();}
