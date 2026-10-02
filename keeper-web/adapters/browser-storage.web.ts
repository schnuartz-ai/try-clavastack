import { BROWSER_APP_VERSION } from './browser-device-info.web';

const PREFIX = 'keeper-web:';
const memory = new Map<string, string>();

function read(key: string) {
  try { return window.sessionStorage.getItem(`${PREFIX}${key}`) ?? memory.get(key) ?? null; }
  catch { return memory.get(key) ?? null; }
}

function write(key: string, value: string) {
  memory.set(key, value);
  try { window.sessionStorage.setItem(`${PREFIX}${key}`, value); } catch { /* private browsing */ }
}

function remove(key: string) {
  memory.delete(key);
  try { window.sessionStorage.removeItem(`${PREFIX}${key}`); } catch { /* private browsing */ }
}

export const webSessionStore = {
  set(key: string, value: string | number | boolean) { write(key, String(value)); },
  getString(key: string) { return read(key) ?? undefined; },
  getNumber(key: string) { const value = read(key); return value == null ? undefined : Number(value); },
  getBoolean(key: string) { const value = read(key); return value == null ? undefined : value === 'true'; },
  getAllKeys() {
    const keys = new Set(memory.keys());
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(PREFIX)) keys.add(key.slice(PREFIX.length));
      }
    } catch { /* private browsing */ }
    return [...keys];
  },
  contains(key: string) { return read(key) !== null; },
  remove(key: string) { const existed = read(key) !== null; remove(key); return existed; },
  clearAll() { for (const key of this.getAllKeys()) remove(key); },
};

export const reduxStorage = {
  async setItem(key: string, value: string) { webSessionStore.set(`redux:${key}`, value); return true; },
  async getItem(key: string) {
    const value = webSessionStore.getString(`redux:${key}`) ?? null;
    if (!value || key !== 'persist:root') return value;
    try {
      const persistedState = JSON.parse(value);
      const storageState = JSON.parse(persistedState.storage ?? '{}');
      // Earlier browser builds persisted a display label as the app version.
      // Keeper compares this field with semver during login, so migrate only
      // that known simulator sentinel to the pinned upstream release version.
      if (storageState.appVersion === 'Browser simulator') {
        storageState.appVersion = BROWSER_APP_VERSION;
        persistedState.storage = JSON.stringify(storageState);
        return JSON.stringify(persistedState);
      }
    } catch { /* preserve unrelated or malformed persisted state */ }
    return value;
  },
  async removeItem(key: string) { webSessionStore.remove(`redux:${key}`); },
};

export const setItem = (key: string, value: string | number | boolean) => webSessionStore.set(key, value);
export const getString = (key: string) => webSessionStore.getString(key);
export const getNumber = (key: string) => webSessionStore.getNumber(key) ?? 0;
export const getBoolean = (key: string) => webSessionStore.getBoolean(key) ?? false;
export const getEverything = () => webSessionStore.getAllKeys();
export const hasItem = (key: string) => webSessionStore.contains(key);
export const deleteItem = (key: string) => { webSessionStore.remove(key); };
export const clearStorage = () => webSessionStore.clearAll();
export default webSessionStore;
