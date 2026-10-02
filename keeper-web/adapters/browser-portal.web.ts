const unsupported = () => Promise.reject(
  new Error('Portal NFC hardware is unavailable in the browser simulator.'),
);

export class PortalSdk {
  destroy() {}
  poll = unsupported;
  newTag = unsupported;
  incomingData = unsupported;
  getStatus = unsupported;
  generateMnemonic = unsupported;
  restoreMnemonic = unsupported;
  unlock = unsupported;
  resume = unsupported;
  displayAddress = unsupported;
  signPsbt = unsupported;
  publicDescriptors = unsupported;
  getXpub = unsupported;
  setDescriptor = unsupported;
  updateFirmware = unsupported;
  debugWipeDevice = unsupported;
}

export const Network = {
  Bitcoin: 'bitcoin',
  Testnet: 'testnet',
  Regtest: 'regtest',
  Signet: 'signet',
};

export const MnemonicWords = {
  Words12: 0,
  Words24: 1,
  0: 'Words12',
  1: 'Words24',
};
