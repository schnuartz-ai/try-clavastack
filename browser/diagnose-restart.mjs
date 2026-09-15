import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const server=createServer(async(req,res)=>{try{let p=new URL(req.url,'http://localhost').pathname;if(p.endsWith('/'))p+='index.html';let b=await readFile(resolve('.'+p));res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json'})[extname(p)]||'application/octet-stream');res.end(b);}catch(e){res.statusCode=404;res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const b=await chromium.launch();const results=[];
try{for(const restart of [false,true,"ready"]){const p=await b.newPage();await p.clock.install();await p.clock.pauseAt(new Date());
await p.addInitScript(()=>{window.workers=[];window.Worker=class{constructor(){this.id=workers.length;workers.push(this);this.terminated=false;}postMessage(d){if(d.type==='snapshot')this.onmessage({data:{type:'snapshot',requestId:d.requestId,files:[]}});}terminate(){this.terminated=true;}};});
await p.goto(`http://127.0.0.1:${server.address().port}/`);await p.waitForFunction(()=>workers.length===1);
await p.clock.runFor(8000);if(restart){await p.locator('#restart-btn').click();await p.waitForFunction(()=>workers.length===2);}
if(restart==='ready'){await p.clock.runFor(2000);await p.evaluate(()=>workers[1].onmessage({data:{type:'running'}}));await p.clock.runFor(80000);}else await p.clock.runFor(82000);results.push({restart,loading:await p.locator('#loading').innerText(),workers:await p.evaluate(()=>workers.map(w=>({id:w.id,terminated:w.terminated})))});await p.close();}}finally{await b.close();server.close();}
await writeFile('test-results/diagnosis/restart-timer.json',JSON.stringify(results,null,2));console.log(results);
