import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';

const base=process.env.TEST_BASE_URL??'http://127.0.0.1:8778';
// Actual signed public fixture from the preceding full native QR test.
const result=JSON.parse(await readFile('test-results/bull-original-qr-roundtrip.json','utf8'));
const browser=await chromium.launch({...(process.env.CI?{}:{channel:'chrome'}),headless:true});
const page=await browser.newPage();
const requests=[];
let responseMode='ok';
// All broadcast POSTs are intercepted. Synthetic transactions never reach a
// public network; this tests the real HTTP boundary, paths, bytes and errors.
await page.route('https://blockstream.info/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()!=='POST')return route.continue();
  assert.equal(url.pathname.endsWith('/tx'),true);
  requests.push({path:url.pathname,body:request.postData()});
  await route.fulfill({status:responseMode==='reject'?400:200,headers:{'Access-Control-Allow-Origin':'*'},contentType:'text/plain',
    body:responseMode==='reject'?'Synthetic fixture rejected':responseMode==='mismatch'?'0'.repeat(64):result.txid});
});
try{
  await page.goto(`${base}/bull-bitcoin/`);
  const frame=page.frames().find(frame=>frame.url().includes('/bull-bitcoin/app/'));
  await frame.waitForFunction(()=>typeof window.bullBroadcast==='function',undefined,{timeout:90000});
  const call=values=>frame.evaluate(async values=>JSON.parse(await window.bullBroadcast(JSON.stringify(values))),values);
  const payload={hex:result.hex,txid:result.txid,isTestnet:true,isLiquid:false};
  assert.match(payload.hex,/^(?:[a-f0-9]{2})+$/);
  for(const [isTestnet,isLiquid,path] of [[true,false,'/testnet/api/tx'],[false,false,'/api/tx'],[true,true,'/liquidtestnet/api/tx'],[false,true,'/liquid/api/tx']]){
    assert.deepEqual(await call({...payload,isTestnet,isLiquid}),{txid:result.txid});
    assert.equal(requests.at(-1).path,path);assert.equal(requests.at(-1).body,result.hex);
  }
  responseMode='reject';assert.match((await call(payload)).error,/rejected \(400\)/);
  responseMode='mismatch';assert.match((await call(payload)).error,/different transaction identifier/);
  const before=requests.length;
  assert.match((await call({...payload,hex:'malformed'})).error,/Invalid native transaction/);
  assert.equal(requests.length,before);
  await writeFile('test-results/bull-transport.json',JSON.stringify({paths:requests.map(request=>request.path),unchangedBytes:true,rejectionVerified:true,txidMismatchVerified:true,invalidInputRejected:true,publicBroadcasts:0},null,2));
  console.log('PASS native HTTP transport: four distinct networks, exact bytes, server rejection, txid mismatch and malformed input; no public broadcast');
}finally{await browser.close();}
