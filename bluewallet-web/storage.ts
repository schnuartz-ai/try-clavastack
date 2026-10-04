const values = new Map<string,string>();
let group = 'blue-testnet';
export const storage = {
 async getItem(key: string) { return values.get(key) ?? null; },
 async setItem(key: string, value: string) { values.set(key, value); },
 async removeItem(key: string) { values.delete(key); },
 async clear(key?: string) { if (key) values.delete(`${group}:${key}`); else values.clear(); },
 async getAllKeys() { return [...values.keys()]; },
 async multiGet(keys: string[]) { return keys.map(key => [key, values.get(key) ?? null]); },
 async multiSet(entries: [string,string][]) { for (const [key,value] of entries) values.set(key,value); },
 async multiRemove(keys: string[]) { keys.forEach(key => values.delete(key)); },
 async setName(name: string) { group = name; },
 async get(key: string) { return values.get(`${group}:${key}`) ?? (key === 'donottrack' ? '1' : null); },
 async set(key: string,value: string) { values.set(`${group}:${key}`,value); },
 async getGenericPassword({service = 'default'} = {}) { const password=values.get(`keychain:${service}`); return password ? {username:service,password} : false; },
 async setGenericPassword(username: string,password: string,{service = 'default'} = {}) { values.set(`keychain:${service}`,password); return true; },
 async resetGenericPassword({service = 'default'} = {}) { values.delete(`keychain:${service}`); return true; },
 async isSensorAvailable() { return {available:false}; },
};
export default storage;
