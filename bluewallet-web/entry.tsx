import './polyfills';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../upstream/bluewallet/App';
import { BlueApp } from '../upstream/bluewallet/class/blue-app';
import { navigationRef } from '../upstream/bluewallet/NavigationService';
import { HDSegwitBech32Wallet } from '../upstream/bluewallet/class/wallets/hd-segwit-bech32-wallet';
import { WatchOnlyWallet } from '../upstream/bluewallet/class/wallets/watch-only-wallet';
import startImport from '../upstream/bluewallet/class/wallet-import';
import * as bitcoin from './bitcoin';
import { noBroadcast, assertTestnetImport } from './policy';
import * as files from './files';
import { MultisigHDWallet } from '../upstream/bluewallet/class/wallets/multisig-hd-wallet';
import { normalizeQr } from './qr-codec';
const post = (data: object) => parent.postMessage(data, location.origin);
let acknowledged=false;
const announce=()=>{post({type:'blue-runtime-ready'});if(document.querySelector('[data-testid="Wallets"]'))post({type:'blue-app-mounted'});};
const handshake=setInterval(()=>{if(!acknowledged)announce();},1000);
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== location.origin) return;
  if (event.data?.type === 'blue-parent-ready') {acknowledged=false;announce();}
  if (event.data?.type === 'blue-runtime-ready-ack') {acknowledged=true;if(document.querySelector('[data-testid="Wallets"]'))post({type:'blue-app-mounted'});}
  if (event.data?.type === 'blue-reset') location.reload();
  if (event.data?.type === 'blue-direct-qr-status') window.dispatchEvent(new CustomEvent('blue-qr-status',{detail:event.data.message}));
  if (event.data?.type === 'blue-direct-qr-frame') window.dispatchEvent(new CustomEvent('blue-qr-frame', { detail: event.data.frame }));
});
class Boundary extends React.Component<any, {error?: string}> {
  state = {error: undefined as string | undefined};
  static getDerivedStateFromError(error: Error) { return {error: error.message}; }
  componentDidCatch(error: Error) { post({type: 'blue-runtime-error', message: error.message}); }
  render() { return this.state.error ? <div role="alert">BlueWallet could not start: {this.state.error}</div> : this.props.children; }
}
const root = document.getElementById('root')!;
createRoot(root).render(<Boundary><App /></Boundary>);
const observer = new MutationObserver(() => {
  if (root.querySelector('[data-testid="Wallets"]')) { observer.disconnect(); post({type:'blue-app-mounted'}); }
});
observer.observe(root, {subtree:true, childList:true});
post({type:'blue-runtime-ready'});
if (new URLSearchParams(location.search).get('test') === '1' && ['127.0.0.1', 'localhost'].includes(location.hostname)) {
  (window as any).__blueTest = {BlueApp, navigationRef, HDSegwitBech32Wallet, WatchOnlyWallet, MultisigHDWallet, startImport, bitcoin, noBroadcast, assertTestnetImport, files, normalizeQr};
}
