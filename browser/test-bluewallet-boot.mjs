import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({...(process.env.CI?{}:{channel:'chrome'}),headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];
page.on('pageerror',error=>errors.push(error.stack||error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
try {
await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:8765'}/blue-wallet/runtime.html?test=1`);
await page.getByTestId('Wallets').waitFor({timeout:45000});await page.evaluate(()=>document.fonts.ready);await mkdir('test-results/bluewallet',{recursive:true});await page.screenshot({path:'test-results/bluewallet/boot.png',fullPage:true});
const text=await page.locator('body').innerText();
console.log(JSON.stringify({text,errors},null,2));
assert.equal(errors.length,0,'BlueWallet emitted runtime errors');
assert(text.trim().length>0,'BlueWallet rendered an empty body');
assert(!text.includes('could not start'),'BlueWallet error boundary was displayed');
assert(/Add Wallet|Create a Wallet|Create a wallet|Wallets|Import wallet/i.test(text),'Original BlueWallet wallet screen is missing');

}finally{await browser.close();}
