import {createCompanionWorkbench} from '/browser/companion-workbench.js';
const runtime = document.getElementById('blue-runtime');
const networkStatus = document.getElementById('blue-network-status');
const applyNetworkStatus = (message) => {
  if (message?.type !== 'blue-network-status' || message.network !== 'testnet3') return;
  const state = ['connecting', 'connected', 'disconnected', 'disabled'].includes(message.state) ? message.state : 'disconnected';
  const labels = { connecting: 'CONNECTING', connected: 'CONNECTED', disconnected: 'OFFLINE', disabled: 'DISABLED' };
  networkStatus.dataset.state = state;
  networkStatus.textContent = 'TESTNET3 · ' + labels[state];
};
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== runtime.contentWindow) return;
  applyNetworkStatus(event.data);
});
runtime.addEventListener('load', () => {
  try { applyNetworkStatus(runtime.contentWindow.__blueNetworkState); } catch {}
});
createCompanionWorkbench({id:'blue',label:'BlueWallet',storageKey:'clavastack-bluewallet-testnet3-removable-media-v1',allowedDemoNetworks:['testnet']});
