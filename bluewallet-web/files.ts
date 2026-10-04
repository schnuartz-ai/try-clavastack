import {Buffer} from 'buffer';
const files=new Map<string,Uint8Array>();
let clientPromise:Promise<any>|undefined;
export async function fileClient(){return clientPromise??=(async()=>{
 const module=await import('/browser/companion-file-dialog.js');
 const client=module.createCompanionFileClient({label:'BlueWallet'});
 const ready=new Promise<void>((resolve,reject)=>{
  const handler=(event:MessageEvent)=>{if(event.source===parent&&event.origin===location.origin&&event.data?.type==='specter-media-state'){clearTimeout(timer);removeEventListener('message',handler);resolve();}};
  const timer=setTimeout(()=>{removeEventListener('message',handler);reject(new Error('Virtual media bridge did not respond. Try again.'));},15000);
  addEventListener('message',handler);
 });
 await ready;return client;
})();}

export function putFile(name:string,bytes:Uint8Array){const uri=`/blue-testnet/temp/${crypto.randomUUID()}/${name}`;files.set(uri,bytes);return uri;}
export async function readFile(path:string,encoding='utf8'){const bytes=files.get(decodeURI(path).replace(/^file:\/\//,''));if(!bytes)throw new Error('Browser file is unavailable. Select it again.');return Buffer.from(bytes).toString(encoding==='base64'?'base64':'utf8');}
export async function writeFile(path:string,value:string,encoding='utf8'){files.set(path,Buffer.from(value,encoding==='base64'?'base64':'utf8'));}
export default {readFile,writeFile,DocumentDirectoryPath:'/blue-testnet/documents',CachesDirectoryPath:'/blue-testnet/cache',TemporaryDirectoryPath:'/blue-testnet/temp',async exists(path:string){return files.has(path);},async readDir(){return [];},async mkdir(){},async unlink(path:string){files.delete(path);},async copyFile(source:string,target:string){files.set(target,files.get(source)!);},async stat(path:string){return {size:files.get(path)?.length||0,isFile:()=>true,isDirectory:()=>false};}};
