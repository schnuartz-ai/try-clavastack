import * as original from '../upstream/bluewallet/node_modules/bitcoinjs-lib';
import { NETWORK, assertTestnetPsbt } from './policy';
export * from '../upstream/bluewallet/node_modules/bitcoinjs-lib';
export const networks = { ...original.networks, bitcoin: NETWORK };
export const payments = Object.fromEntries(Object.entries(original.payments).map(([key, method]) => [key,
  typeof method === 'function' ? (options: any = {}, validate?: any) => method({...options, network: NETWORK}, validate) : method]));
export const address = {
 ...original.address,
 toOutputScript: (value: string) => original.address.toOutputScript(value, NETWORK),
 fromOutputScript: (script: Uint8Array) => original.address.fromOutputScript(script, NETWORK),
};
export class Psbt extends original.Psbt {
 constructor(options: any = {}) { super({...options, network: NETWORK}); }
 static fromBase64(data: string, options: any = {}) { return assertTestnetPsbt(original.Psbt.fromBase64(data, {...options, network: NETWORK})); }
 static fromHex(data: string, options: any = {}) { return assertTestnetPsbt(original.Psbt.fromHex(data, {...options, network: NETWORK})); }
 static fromBuffer(data: Uint8Array, options: any = {}) { return assertTestnetPsbt(original.Psbt.fromBuffer(data, {...options, network: NETWORK})); }
}
