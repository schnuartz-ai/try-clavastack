import * as realBitcoin from '../upstream/bluewallet/node_modules/bitcoinjs-lib';
import { Buffer } from 'buffer';
export const NETWORK = realBitcoin.networks.testnet;
export function assertTestnetImport(value: string) {
  if (/\b(?:[xyzXYZ]pub|[xyzXYZ]prv)[1-9A-HJ-NP-Za-km-z]{20,}/.test(value) || /\bbc1[a-z0-9]{12,}/i.test(value) || /\bmainnet\b/i.test(value))
    throw new Error('Mainnet imports are disabled. Use a public test seed or a Testnet tpub/upub/vpub.');
  for(const address of value.match(/\b[13][1-9A-HJ-NP-Za-km-z]{25,34}\b/g)||[]){let valid=false;try{realBitcoin.address.toOutputScript(address,realBitcoin.networks.bitcoin);valid=true;}catch{}if(valid)throw new Error('Mainnet addresses are disabled.');}
  if (/(?:m\/|\/)(?:44|49|48|84|86)['hH]\/0['hH](?:\/|$)/.test(value))
    throw new Error('This derivation uses the Mainnet coin type. Testnet requires coin type 1.');
}
export function assertTestnetPsbt(psbt: any) {
  for (const entry of psbt.data.globalMap.globalXpub || []) {
    const bytes = Buffer.from(entry.extendedPubkey);
    if (bytes.readUInt32BE(0) !== NETWORK.bip32.public) throw new Error('Mainnet PSBT extended keys are disabled.');
  }
  for (const entry of [...psbt.data.inputs, ...psbt.data.outputs]) {
    for (const derivation of [...(entry.bip32Derivation || []), ...(entry.tapBip32Derivation || [])]) {
      const path = derivation.path;
      if (/^m\/(44|49|48|84|86)'\//.test(path) && !/^m\/(44|49|48|84|86)'\/1'\//.test(path))
        throw new Error('Mainnet PSBT derivations are disabled.');
    }
  }
  return psbt;
}
export function noBroadcast(): never { throw new Error('Broadcasting is disabled. Demo transactions have fictional inputs and no coins.'); }
