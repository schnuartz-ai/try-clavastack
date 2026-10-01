import * as bitcoinJS from 'bitcoinjs-lib';

// This is the only state surface used by Keeper's source wallet factories and
// derivation operations in the browser simulator. It cannot select mainnet.
export const store = {
  getState: () => ({
    settings: {
      bitcoinNetwork: bitcoinJS.networks.testnet,
      bitcoinNetworkType: 'TESTNET',
      torEnbled: false,
    },
  }),
};
