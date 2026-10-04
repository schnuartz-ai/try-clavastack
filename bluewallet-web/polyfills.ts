import { Buffer } from 'buffer';
import process from 'process';
(globalThis as any).Buffer = Buffer;
(globalThis as any).process = process;
(globalThis as any).global = globalThis;
// This demo has no network service. Upstream calls are denied before transport.
const staticFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input: any, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if ((!['data:','blob:'].includes(url.protocol) && url.origin !== location.origin) || !['GET','HEAD'].includes(init?.method || input?.method || 'GET'))
    return Promise.reject(new Error('Network access and broadcasts are disabled in the BlueWallet testnet simulator.'));
  return staticFetch(input, init);
};

const StaticXHR=globalThis.XMLHttpRequest;
globalThis.XMLHttpRequest=class extends StaticXHR {
 open(method:string,url:string|URL,...rest:any[]){const target=new URL(String(url),location.href);if(!['GET','HEAD'].includes(method.toUpperCase())||target.origin!==location.origin)throw new Error('Network access and broadcasts are disabled.');return (super.open as any)(method,url,...rest);}
} as any;
globalThis.WebSocket=class {constructor(){throw new Error('Network connections are disabled.');}} as any;
navigator.sendBeacon=()=>false;
