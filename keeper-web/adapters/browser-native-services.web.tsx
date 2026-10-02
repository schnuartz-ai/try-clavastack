import React from 'react';
import { BROWSER_APP_VERSION } from './browser-device-info.web';

// Explicit browser ports for device services that are absent from a browser. Bitcoin,
// wallet, descriptor, PSBT and UR code stays in Keeper's upstream application modules.
export const APP_STAGE = { DEVELOPMENT: 'DEVELOPMENT', PRODUCTION: 'PRODUCTION' };
export const ACCESSIBLE = { WHEN_UNLOCKED: 'WHEN_UNLOCKED' };
export const NfcTech = { Ndef: 'Ndef', IsoDep: 'IsoDep', NfcA: 'NfcA', NfcB: 'NfcB', NfcV: 'NfcV', MifareClassic: 'MifareClassic', MifareUltralight: 'MifareUltralight' };
export const Ndef = { TNF_WELL_KNOWN: 1, RTD_TEXT: 'T', RTD_URI: 'U', encodeMessage: () => new Uint8Array(), decodeMessage: () => [] };
export const NFCTagType4NDEFContentType = { Text: 'text/plain', URI: 'text/uri-list' };
export const NFCTagType4 = class {};
export const HCESessionContext = React.createContext({ isConnected: false, startEmulating: async () => false, stopEmulating: async () => {} });
export function HCESessionProvider({ children }: React.PropsWithChildren) { return <>{children}</>; }
export class HCESession { async startEmulating() { return false; } async stopEmulating() {} async setApplication() {} }

const keychain = new Map<string, any>();
export async function getGenericPassword({ service = 'default' }: any = {}) { return keychain.get(service) || false; }
export async function setGenericPassword(username: string, password: string, { service = 'default' }: any = {}) { keychain.set(service, { username, password, service }); return true; }
export async function resetGenericPassword({ service = 'default' }: any = {}) { return keychain.delete(service); }
export async function hasGenericPassword({ service = 'default' }: any = {}) { return keychain.has(service); }

export class ReactNativeBiometrics {
  constructor() {}
  async isSensorAvailable() { return { available: false, biometryType: null }; }
  async biometricKeysExist() { return { keysExist: false }; }
  async simplePrompt() { return { success: false }; }
  async createKeys() { return { publicKey: '' }; }
  async deleteKeys() { return { keysDeleted: false }; }
  async createSignature() { return { success: false, signature: '' }; }
  async simplePrompt() { return { success: false }; }
}

export async function getApp() { return {}; }
export async function getMessaging() { return {}; }
export async function getToken() { return ''; }
export async function subscribeToTopic() {}
export async function unsubscribeFromTopic() {}
export function onMessage() { return () => {}; }
export function onNotificationOpenedApp() { return () => {}; }
export async function getInitialNotification() { return null; }
export function setBackgroundMessageHandler() {}

export async function initConnection() { return false; }
export async function endConnection() {}
export async function getSubscriptions() { return []; }
export async function requestPurchase() { throw new Error('In-app purchases are disabled in the browser simulator.'); }
export async function getAvailablePurchases() { return []; }
export function purchaseUpdatedListener() { return { remove() {} }; }
export function purchaseErrorListener() { return { remove() {} }; }
export function finishTransaction() {}

export const DeviceInfo = {
  getVersion: () => BROWSER_APP_VERSION, getUniqueId: async () => 'keeper-web-session',
  getDeviceName: async () => 'Bitcoin Keeper Web Simulator', getSystemName: () => 'Web',
  getSystemVersion: () => navigator.userAgent, isTablet: () => false,
  hasNotch: () => false, getBrand: () => 'Browser', getModel: () => 'Simulator',
};

const fileByUrl = new Map<string, File>();
export function launchImageLibrary(_options: any, callback: (result: any) => void) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) { callback({ didCancel: true }); return; }
    const uri = URL.createObjectURL(file); fileByUrl.set(uri, file);
    callback({ didCancel: false, assets: [{ uri, fileName: file.name, type: file.type, fileSize: file.size }] });
  };
  input.click();
}
export const launchCamera = launchImageLibrary;
export const ImagePicker = { launchImageLibrary, launchCamera, MediaType: { photo: 'photo' } };

export const RNQRGenerator = {
  async detect({ uri }: { uri: string }) {
    const file = fileByUrl.get(uri);
    if (!file) throw new Error('Image file is not available in this browser session.');
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || typeof (window as any).jsQR !== 'function') throw new Error('QR image decoder is unavailable.');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = (window as any).jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
    return { values: result ? [result.data] : [] };
  },
};

const noNativeFileSystem = new Proxy({}, { get: (_target, name) => {
  if (name === 'DocumentDirectoryPath' || name === 'CachesDirectoryPath' || name === 'TemporaryDirectoryPath') return '';
  if (name === 'exists') return async () => false;
  if (name === 'readDir' || name === 'readFile' || name === 'writeFile' || name === 'copyFile') return async () => { throw new Error('This device file-system operation is unavailable in the browser simulator.'); };
  return undefined;
} });
export const RNFS = noNativeFileSystem;

export const NfcManager = {
  isSupported: async () => false, start: async () => {}, isEnabled: async () => false,
  requestTechnology: async () => { throw new Error('NFC hardware is not available in the browser simulator.'); },
  cancelTechnologyRequest: async () => {}, getTag: async () => null,
  writeNdefMessage: async () => { throw new Error('NFC hardware is not available in the browser simulator.'); },
};

const defaultExport = {
  getGenericPassword, setGenericPassword, resetGenericPassword, hasGenericPassword, ACCESSIBLE,
  initConnection, endConnection, getSubscriptions, requestPurchase, getAvailablePurchases,
  purchaseUpdatedListener, purchaseErrorListener, finishTransaction,
  getApp, getMessaging, getToken, subscribeToTopic, unsubscribeFromTopic, onMessage,
  onNotificationOpenedApp, getInitialNotification, setBackgroundMessageHandler,
  launchImageLibrary, launchCamera, RNQRGenerator, RNFS, NfcManager, HCESession,
  ReactNativeBiometrics, ...DeviceInfo,
};
class BrowserNativePort {
  constructor() { Object.assign(this, defaultExport); }
}
Object.assign(BrowserNativePort, defaultExport);
export default BrowserNativePort;
