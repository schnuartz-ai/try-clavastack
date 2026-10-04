import { ECPairFactory as original } from '../upstream/bluewallet/node_modules/ecpair';
import { NETWORK } from './policy';
export * from '../upstream/bluewallet/node_modules/ecpair';
export function ECPairFactory(ecc: any) {
 const api = original(ecc);
 return {...api,
  fromWIF: (key: string) => api.fromWIF(key, NETWORK),
  fromPrivateKey: (key: Uint8Array, options: any = {}) => api.fromPrivateKey(key, {...options, network: NETWORK}),
  fromPublicKey: (key: Uint8Array, options: any = {}) => api.fromPublicKey(key, {...options, network: NETWORK}),
  makeRandom: (options: any = {}) => api.makeRandom({...options, network: NETWORK})};
}
