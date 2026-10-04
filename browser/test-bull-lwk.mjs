import {strict as assert} from 'node:assert';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8778';
await writeFile('.browser-work/lwk-probe.html',`<!doctype html><meta charset="utf-8"><script type="module">
import init,{lwk_call} from '/.browser-work/lwk-web-pkg/bull_lwk.js';
import {createDemoFiles} from '/browser/demo-data.js';
await init();
window.bullLwkCall=(name,args)=>lwk_call(name,args);
window.bullProbeInput=JSON.stringify({mnemonic:createDemoFiles('testnet').roots.ghost.mnemonic});
window.bullProbeDone=value=>window.bullProbeResult=JSON.parse(value);
const entry=document.createElement('script');entry.src='/.browser-work/lwk-probe.js';document.body.append(entry);
</script>`);
const browser=await chromium.launch({...(!process.env.CI?{channel:'chrome'}:{}),headless:true});
try {
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/.browser-work/lwk-probe.html');
  await page.waitForFunction(()=>window.bullProbeResult,{timeout:30000});
  const result=await page.evaluate(()=>window.bullProbeResult);
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.match(result.address,/^tlq1/);assert.equal(result.reopened,true);
  assert.equal(result.balance,'0');assert.equal(result.invalidRejected,true);assert.deepEqual(errors,[]);
  await mkdir('test-results',{recursive:true});
  await writeFile('test-results/bull-lwk.json',JSON.stringify({result,errors},null,2));
  console.log('PASS original LWK descriptor, Liquid Testnet address, canonical reopen and native invalid-transaction rejection');
} finally {await browser.close();}
