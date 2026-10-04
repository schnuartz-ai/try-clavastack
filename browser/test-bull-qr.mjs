import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Psbt, Transaction, script } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { createDemoFiles } from './demo-data.js';

const base=process.env.TEST_BASE_URL??'http://127.0.0.1:8778';
const demo=createDemoFiles('testnet');
const fixture=new TextDecoder().decode(demo.files.find(file=>file.name==='testnet-ghost-payment-low-fee.psbt').bytes).trim();
const browser=await chromium.launch({...(process.env.CI?{}:{channel:'chrome'}),headless:true});
const context=await browser.newContext({viewport:{width:1512,height:1100},serviceWorkers:'block'});
const page=await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));

// Test-only public seed setup. The complete frozen firmware, its GUI, wallet
// apps, normal QRHost parser and signing code remain the production versions.
// RAMKeyStore is upstream's native test keystore. No fixture enters production.
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
await context.route('**/browser/runtime-worker.js*',async route=>{
  const response=await route.fetch();
  const source=await response.text();
  const anchor='const usbWalletProbe = data.usbWalletProbe';
  assert.equal(source.includes(anchor),true);
  await route.fulfill({response,body:source.replace(anchor,'data.usbWalletProbe = true;\n    '+anchor)});
});
await context.route('**/browser/runtime/usb-wallet-probe.py',route=>route.fulfill({body:fixtureBoot,contentType:'text/plain'}));
await context.route('**/bull-bitcoin/',async route=>{
  const response=await route.fetch();
  const source=await response.text();
  assert.ok(source.includes('src="/bull-bitcoin/app/"'));
  await route.fulfill({response,body:source.replace('src="/bull-bitcoin/app/"','src="/.browser-work/bull-acceptance-app/"')});
});
await page.addInitScript(()=>{
  // Exercise a denied physical camera at the browser peripheral boundary.
  if(location.pathname.startsWith('/.browser-work/bull-acceptance-app/')){
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
      throw new DOMException('Camera permission denied for this test','NotAllowedError');
    }});
  }
  window.__bullQrTest={bull:[],diy:[],scanner:false,scannerChangedAt:0};
  addEventListener('message',event=>{
    if(event.origin!==location.origin)return;
    const data=event.data;
    if(data?.type==='bull-qr-output-frame')window.__bullQrTest.bull.push(data.frame);
    if(data?.type==='simulator-qr-output')window.__bullQrTest.diy.push(data.frame);
    if(data?.type==='simulator-scanner-state'){window.__bullQrTest.scanner=Boolean(data.active);window.__bullQrTest.scannerChangedAt=Date.now();}
  });
});
const app=page.frameLocator('#bull-runtime');
const canvas=page.frameLocator('#specter-simulator').locator('#screen');
async function tap(x,y){
  await canvas.scrollIntoViewIfNeeded();
  const bounds=await canvas.boundingBox();
  await page.mouse.click(bounds.x+x/480*bounds.width,bounds.y+y/800*bounds.height,{delay:80});
  await page.waitForTimeout(500);
}
try{
  await page.goto(`${base}/bull-bitcoin/`);
  await app.locator('flt-semantics-placeholder').waitFor({state:'attached',timeout:90000});
  await app.locator('flt-semantics-placeholder').evaluate(element=>element.click());
  for(let i=0;i<2;i++)await app.getByRole('button',{name:/^Next/}).click();
  await app.getByRole('button',{name:/^No/}).click();
  await app.getByRole('button',{name:/Get started/i}).click();
  await app.getByRole('button',{name:/Create New Wallet/}).click({timeout:90000});
  await app.getByRole('button',{name:/^Receive/}).waitFor({timeout:90000});
  await page.getByText('Running',{exact:true}).waitFor({timeout:90000});
  await page.waitForTimeout(3000);
  await app.locator('body').evaluate(()=>window.bullTestWatchOnly());
  await app.getByRole('button',{name:'Scan from Specter DIY'}).click();
  await app.getByText(/No QR is currently visible on Specter DIY/).waitFor();
  await app.getByRole('button',{name:'Use camera'}).click();
  await app.getByText('Camera unavailable. You can scan from Specter DIY.').waitFor();
  // Use the original scanner's close action. Imperative GoRouter overlays
  // intentionally retain the underlying /wallet URL in this application.
  await app.getByRole('button').evaluateAll(elements=>elements.find(element=>{
    const box=element.getBoundingClientRect();return !element.textContent.trim()&&box.y>600;
  }).click());
  await app.getByRole('button',{name:/^Receive/}).waitFor();
  console.log('PASS empty Specter QR and denied camera show recoverable scanner status');
  await app.locator('body').evaluate((element,psbt)=>window.bullTestShowPsbt(psbt),fixture);
  await app.getByText('Sign transaction',{exact:true}).waitFor();
  await page.waitForFunction(()=>new Set(window.__bullQrTest.bull.filter(frame=>frame.startsWith('ur:crypto-psbt/'))).size>=3,undefined,{timeout:20000});
  await page.getByText('Running',{exact:true}).waitFor({timeout:90000});
  await page.waitForTimeout(3000);
  await mkdir('test-results',{recursive:true});
  await canvas.screenshot({path:'test-results/bull-qr-native-home.png'});
  await tap(240,440);
  await page.waitForFunction(()=>window.__bullQrTest.scanner,undefined,{timeout:15000});
  await page.locator('#send-bull-qr').click();
  await page.waitForFunction(()=>!window.__bullQrTest.scanner&&Date.now()-window.__bullQrTest.scannerChangedAt>3000,undefined,{timeout:30000});
  await page.waitForTimeout(2000);
  await mkdir('test-results',{recursive:true});
  await canvas.screenshot({path:'test-results/bull-native-qr-review.png'});
  await tap(360,740);
  await page.waitForFunction(()=>window.__bullQrTest.diy.length>0,undefined,{timeout:30000});
  await app.getByRole('button',{name:/^I'm done/}).click({force:true});
  await app.getByRole('button',{name:/^Camera/}).click({force:true});
  await app.getByRole('button',{name:'Scan from Specter DIY'}).click();
  await app.locator('body').evaluate(()=>new Promise((resolve,reject)=>{
    const started=Date.now();
    const timer=setInterval(()=>{
      const state=JSON.parse(window.bullTestState());
      if(state.signed?.hex){clearInterval(timer);resolve(state);}
      else if(Date.now()-started>30000){clearInterval(timer);reject(new Error('Original Bull parser did not return a signed transaction'));}
    },100);
  }));
  const state=JSON.parse(await app.locator('body').evaluate(()=>window.bullTestState()));
  assert.equal(state.signed.failure,null);
  const signed=Transaction.fromHex(state.signed.hex), unsigned=Psbt.fromBase64(fixture);
  const [encodedSignature,pubkey]=signed.ins[0].witness;
  const decoded=script.signature.decode(encodedSignature);
  const prevout=unsigned.data.inputs[0].witnessUtxo;
  const scriptCode=script.compile([118,169,prevout.script.subarray(2),136,172]);
  assert.ok(ecc.verify(signed.hashForWitnessV0(0,scriptCode,prevout.value,decoded.hashType),pubkey,decoded.signature));
  assert.deepEqual(signed.outs,unsigned.txOutputs.map(output=>({script:output.script,value:output.value})));
  await page.waitForTimeout(2500);
  assert.ok(!(await app.locator('body').innerText()).includes('Oops!'));
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'test-results/bull-original-qr-roundtrip.png',fullPage:true});
  await writeFile('test-results/bull-original-qr-roundtrip.json',JSON.stringify({txid:signed.getId(),hex:state.signed.hex,signatureVerified:true,unchangedOutputs:true,originalBullParser:true,originalSpecterSigning:true,errors},null,2));
  console.log('PASS original Bull QR screen → actual Specter QRHost/signing GUI → original Bull parser; independent ECDSA verification');
  await tap(240,740);
  await tap(240,225);
  await tap(240,160);
  await app.locator('body').evaluate(()=>window.bullTestWatchOnly());
  await app.getByRole('button',{name:'Scan from Specter DIY'}).click();
  await app.getByRole('textbox').waitFor({timeout:20000});
  await app.getByRole('textbox').click({force:true});
  await page.keyboard.type('Specter Ghost',{delay:40});
  await app.getByRole('button',{name:/^Import/}).evaluate(element=>element.click());
  await app.locator('body').evaluate(()=>new Promise((resolve,reject)=>{
    const started=Date.now(),timer=setInterval(()=>{
      const state=JSON.parse(window.bullTestState()).import;
      if(state?.imported){clearInterval(timer);resolve();}
      else if(state?.failure||Date.now()-started>30000){clearInterval(timer);reject(new Error('Native watch-only import: '+JSON.stringify(state)));}
    },100);
  }));
  const imported=JSON.parse(await app.locator('body').evaluate(()=>window.bullTestState())).import;
  assert.equal(imported.network,'bitcoinTestnet');assert.equal(imported.failure,null);
  await page.screenshot({path:'test-results/bull-original-specter-import.png',fullPage:true});
  console.log('PASS actual Specter public-key QR → original Bull watch-only parser, label UI and native Testnet wallet import');
}catch(error){
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/bull-qr-failure.png',fullPage:true});
  console.error(await app.locator('body').innerText().catch(()=>''));
  console.error(errors);
  throw error;
}finally{await browser.close();}
