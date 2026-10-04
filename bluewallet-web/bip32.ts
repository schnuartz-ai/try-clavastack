import OriginalFactory from '../upstream/bluewallet/node_modules/bip32';
import { NETWORK } from './policy';
export * from '../upstream/bluewallet/node_modules/bip32';
export default function BIP32Factory(ecc: any) {
 const api = OriginalFactory(ecc);
 return {...api,
  fromSeed: (seed: Uint8Array) => api.fromSeed(seed, NETWORK),
  fromBase58: (key: string) => api.fromBase58(key, NETWORK),
  fromPrivateKey: (key: Uint8Array, chain: Uint8Array) => api.fromPrivateKey(key, chain, NETWORK),
  fromPublicKey: (key: Uint8Array, chain: Uint8Array) => api.fromPublicKey(key, chain, NETWORK)};
}
