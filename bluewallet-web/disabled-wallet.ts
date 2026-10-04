import { AbstractWallet } from '../upstream/bluewallet/class/wallets/abstract-wallet';
class DisabledWallet extends AbstractWallet {
 static type = 'lightningCustodianWallet'; static typeReadable = 'Lightning unavailable in the Testnet simulator';
 type=DisabledWallet.type;
 static isValidNodeAddress() { return false; }
 valid() { return false; }
 async generate() { throw new Error('Lightning and Ark are disabled in this Bitcoin Testnet simulator.'); }
 async init() { throw new Error('Lightning and Ark are disabled in this Bitcoin Testnet simulator.'); }
 allowSend() { return false; }
 onDelete() { return Promise.resolve(); }
}
export class LightningCustodianWallet extends DisabledWallet {}
export class LightningArkWallet extends DisabledWallet { static type='lightningArk'; type=LightningArkWallet.type; }
