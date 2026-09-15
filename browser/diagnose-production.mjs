import {chromium,firefox,webkit} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base='https://try.clavastack.com';
await mkdir('test-results/diagnosis',{recursive:true});
const result={time:new Date().toISOString(),files:[]};
for(const path of ['/browser/site.js','/browser/runtime-worker.js','/simulators/site.js','/simulators/index.html','/browser/current.json','/browser/variants/specter-playground.json','/browser/variants/specter-playground-schnuartz.json']){
 const r=await fetch(base+path,{cache:'no-store'});const b=Buffer.from(await r.arrayBuffer());
 const hash=x=>createHash('sha256').update(x).digest('hex');
 result.files.push({path,status:r.status,headers:Object.fromEntries(r.headers),sha256:hash(b),localEqual:hash(b)===hash(await readFile('.'+path))});
 if(path.endsWith('.json')) {const p=JSON.parse(b);const m=await(await fetch(base+p.build+'build-info.json',{cache:'no-store'})).json();
 for(const [name,meta] of Object.entries(m.artifacts)){const a=await fetch(base+p.build+name+'?v='+p.version);const ab=Buffer.from(await a.arrayBuffer());result.files.push({path:p.build+name,version:p.version,commit:m.commit,sha256:hash(ab),manifestEqual:hash(ab)===meta.sha256,localEqual:hash(ab)===hash(await readFile('.'+p.build+name))});}}
}
result.engines={};for(const [name,engine] of Object.entries({chromium,firefox,webkit})){try{const b=await engine.launch({headless:true});result.engines[name]=b.version();await b.close();}catch(e){result.engines[name]=e.message;}}
await writeFile('test-results/diagnosis/production.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
