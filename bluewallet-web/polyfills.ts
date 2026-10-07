import { Buffer } from 'buffer';
import process from 'process';
(globalThis as any).Buffer = Buffer;
(globalThis as any).process = process;
(globalThis as any).global = globalThis;
// Keep the upstream wallet's browser port on Bitcoin Testnet3. Reads and the
// signed-transaction broadcast go to the fixed public Esplora endpoint only.
const staticFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input: any, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const method = String(init?.method || input?.method || 'GET').toUpperCase();
  const localAsset = ['data:', 'blob:'].includes(url.protocol);
  const sameOriginRead = url.origin === location.origin && ['GET', 'HEAD'].includes(method);
  const testnetApi = url.origin === 'https://blockstream.info' && url.pathname.startsWith('/testnet/api/');
  const testnetRead = testnetApi && ['GET', 'HEAD'].includes(method);
  const testnetBroadcast = testnetApi && url.pathname === '/testnet/api/tx' && method === 'POST';
  if (!localAsset && !sameOriginRead && !testnetRead && !testnetBroadcast)
    return Promise.reject(new Error('BlueWallet browser networking is limited to Bitcoin Testnet3.'));
  if (testnetApi) init = { ...init, credentials: 'omit' };
  return staticFetch(input, init);
};

const StaticXHR=globalThis.XMLHttpRequest;
globalThis.XMLHttpRequest=class extends StaticXHR {
 open(method:string,url:string|URL,...rest:any[]){const target=new URL(String(url),location.href);const verb=method.toUpperCase();const localAsset=['data:','blob:'].includes(target.protocol);const sameOriginRead=target.origin===location.origin&&['GET','HEAD'].includes(verb);const testnetApi=target.origin==='https://blockstream.info'&&target.pathname.startsWith('/testnet/api/');const testnetRead=testnetApi&&['GET','HEAD'].includes(verb);const testnetBroadcast=testnetApi&&target.pathname==='/testnet/api/tx'&&verb==='POST';if(!localAsset&&!sameOriginRead&&!testnetRead&&!testnetBroadcast)throw new Error('BlueWallet browser networking is limited to Bitcoin Testnet3.');return (super.open as any)(method,url,...rest);}
} as any;
globalThis.WebSocket=class {constructor(){throw new Error('Network connections are disabled.');}} as any;
navigator.sendBeacon=()=>false;
