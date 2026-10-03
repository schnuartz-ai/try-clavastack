import React, { useMemo, useSyncExternalStore } from 'react';

const DB_KEY = 'keeper:realm-session-v1';
const tables = new Map<string, any[]>();
const subscriptions = new Set<() => void>();
const revisions = new Map<string, number>();
const proxies = new WeakMap<object, any>();
const proxySchemas = new WeakMap<object, string>();
let initialized = false;

// Realm serializes `date` properties back to Date instances when it reads a
// row. sessionStorage only stores JSON, so restore the small set of Date fields
// declared in Keeper's Realm schemas when reopening the browser session.
const dateFields: Record<string, string[]> = {
  Signer: ['lastHealthCheck', 'addedOn'],
  UAI: ['lastActioned', 'createdAt', 'seenAt'],
};

function restoreRealmDates(schema: string, row: any) {
  if (!row || typeof row !== 'object') return row;
  // Upgrade the original simulator's disposable default TCP node in place.
  // Retain custom nodes so unsupported transports get an explicit error.
  if (['NodeConnect', 'DefaultNodeConnect'].includes(schema) && row.id === 336 && row.host === 'blackie.c3-soft.com') {
    row.host = 'mempool.space/testnet4/api';
    row.port = '443';
  }
  for (const field of dateFields[schema] || []) {
    const value = row[field];
    if (value !== null && value !== undefined && !(value instanceof Date)) {
      row[field] = new Date(value);
    }
  }
  if (schema === 'Signer' && Array.isArray(row.healthCheckDetails)) {
    for (const detail of row.healthCheckDetails) {
      if (detail?.actionDate !== null && detail?.actionDate !== undefined && !(detail.actionDate instanceof Date)) {
        detail.actionDate = new Date(detail.actionDate);
      }
    }
  }
  return row;
}

function recordDebug(event: Record<string, unknown>) {
  if (typeof window === 'undefined' || !(window as any).__KEEPER_SIMULATOR_DEBUG__) return;
  const events = ((window as any).__keeperBrowserDebug ||= []);
  events.push({ at: Date.now(), ...event });
  if (events.length > 100) events.splice(0, events.length - 100);
}

function load() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DB_KEY) || '{}');
    for (const [name, rows] of Object.entries(saved)) {
      if (Array.isArray(rows)) tables.set(name, rows.map((row) => restoreRealmDates(name, row)) as any[]);
    }
  } catch { /* discarded browser-session database */ }
}
load();

function persist() {
  const record = Object.fromEntries(tables.entries());
  try { sessionStorage.setItem(DB_KEY, JSON.stringify(record)); }
  catch { window.dispatchEvent(new CustomEvent('keeper-storage-error', { detail: { message: 'Keeper session storage is full.' } })); }
}

function changed(schema: string) {
  revisions.set(schema, (revisions.get(schema) || 0) + 1);
  persist();
  for (const listener of [...subscriptions]) listener();
}

function table(schema: string) {
  let rows = tables.get(schema);
  if (!rows) tables.set(schema, (rows = []));
  return rows;
}

function wrap(row: any, schema: string) {
  if (!row || typeof row !== 'object') return row;
  const cached = proxies.get(row);
  if (cached) return cached;
  const proxy = new Proxy(row, {
    get(target, key, receiver) {
      if (key === 'toJSON') return () => structuredClone(target);
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      const result = Reflect.set(target, key, value, receiver);
      changed(schema);
      return result;
    },
  });
  proxies.set(row, proxy);
  proxySchemas.set(proxy, schema);
  return proxy;
}

function matches(row: any, query: string, args: any[]) {
  const match = query.match(/^\s*([\w.]+)\s*(==|!=|>=|<=|>|<)\s*\$?(\d+)\s*$/);
  if (!match) return true;
  const [, field, operator, index] = match;
  const left = field.split('.').reduce((value, part) => value?.[part], row);
  const right = args[Number(index)];
  switch (operator) {
    case '==': return left === right;
    case '!=': return left !== right;
    case '>': return left > right;
    case '<': return left < right;
    case '>=': return left >= right;
    case '<=': return left <= right;
    default: return true;
  }
}

class Results<T = any> extends Array<T> {
  static get [Symbol.species]() { return Array; }
  filtered(query: string, ...args: any[]) { return new Results(...this.filter((row: any) => matches(row, query, args))); }
  sorted(property: string, reverse = false) {
    const rows = [...this].sort((a: any, b: any) => String(a?.[property] ?? '').localeCompare(String(b?.[property] ?? ''), undefined, { numeric: true }));
    return new Results(...(reverse ? rows.reverse() : rows));
  }
  toJSON() { return [...this].map((row: any) => row?.toJSON?.() ?? structuredClone(row)); }
}

export function get(schema: string) { return new Results(...table(schema).map((row) => wrap(row, schema))); }

/**
 * The browser build uses the same short-lived table store for Keeper's
 * dbManager helpers, Realm hooks, and the RealmDatabase singleton. Keeping the
 * boundary here avoids upstream relative imports accidentally opening native
 * Realm in a browser bundle.
 */
export function initializeBrowserRealm() {
  initialized = true;
  return { success: true as const };
}

export function isBrowserRealmInitialized() { return initialized; }

const dbManager = {
  async initializeRealm() { return initializeBrowserRealm(); },
  async deleteRealm() {
    tables.clear();
    revisions.clear();
    persist();
    return { success: true };
  },
  createObject(schema: string, object: any) {
    const rows = table(schema);
    const idField = object?.id !== undefined ? 'id' : undefined;
    const existing = idField ? rows.findIndex((item) => item[idField] === object[idField]) : -1;
    if (existing < 0) rows.push(structuredClone(object)); else rows[existing] = structuredClone(object);
    changed(schema);
    return true;
  },
  createObjectBulk(schema: string, objects: any[]) {
    recordDebug({ op: 'createObjectBulk', schema, count: objects?.length || 0, ids: (objects || []).map((object) => object?.id) });
    try {
      for (const object of objects || []) {
        const rows = table(schema);
        const existing = object?.id === undefined ? -1 : rows.findIndex((item) => item.id === object.id);
        if (existing < 0) rows.push(structuredClone(object)); else rows[existing] = structuredClone(object);
      }
      changed(schema);
      return true;
    } catch (error) {
      recordDebug({ op: 'createObjectBulkError', schema, message: String(error), stack: (error as Error)?.stack });
      throw error;
    }
  },
  getObjectByIndex(schema: string, index = 0, all = false) { const rows = get(schema); return all ? rows : rows[index]; },
  getObjectById(schema: string, id: any) { return get(schema).filtered('id == $0', id)[0]; },
  getObjectByPrimaryId(schema: string, key: string, id: any) { return get(schema).filtered(`${key} == $0`, id)[0]; },
  updateObjectById(schema: string, id: any, values: any) { const row = get(schema).filtered('id == $0', id)[0]; if (!row) return false; Object.assign(row, values); return true; },
  updateObjectByPrimaryId(schema: string, key: string, id: any, values: any) { const row = get(schema).filtered(`${key} == $0`, id)[0]; if (!row) return false; Object.assign(row, values); return true; },
  getCollection(schema: string) { return get(schema).toJSON(); },
  getObjectByField(schema: string, value: any, field: string) { return get(schema).filtered(`${field} == $0`, value); },
  updateObjectByQuery(schema: string, query: (row: any) => boolean, values: any) { const row = get(schema).find(query); if (!row) return false; Object.assign(row, values); return true; },
  getObjectByQuery(schema: string, query: (row: any) => boolean, all = false) { const rows = get(schema).filter(query); return all ? rows : rows[0] ?? null; },
  deleteObjectById(schema: string, id: any) { const rows = table(schema); const index = rows.findIndex((row) => row.id === id); if (index < 0) return false; rows.splice(index, 1); changed(schema); return true; },
  deleteObjectByPrimaryKey(schema: string, key: string, value: any) { const rows = table(schema); const index = rows.findIndex((row) => row[key] === value); if (index < 0) return false; rows.splice(index, 1); changed(schema); return true; },
  // Realm-compatible surface used by upstream code which imports realm.ts
  // directly rather than going through dbManager.
  initializeDatabase: async (_key?: any, _path?: string) => initializeBrowserRealm(),
  getDatabase() {
    if (!initialized) throw new Error('database not initialized');
    return realmFacade;
  },
  create(schema: string, object: any) {
    dbManager.createObject(schema, object);
    const rows = get(schema);
    return object?.id === undefined ? rows[rows.length - 1] : rows.filtered('id == $0', object.id)[0];
  },
  createBulk(schema: string, objects: any[]) {
    dbManager.createObjectBulk(schema, objects);
    return get(schema);
  },
  get(schema: string) { return get(schema); },
  write(callback: () => any) { return callback(); },
  delete(object: any) {
    if (!object) return;
    const schema = proxySchemas.get(object);
    if (schema) return dbManager.deleteObjectById(schema, object.id);
    for (const [name, rows] of tables) {
      const index = rows.findIndex((row) => row === object || (object.id !== undefined && row.id === object.id));
      if (index >= 0) { rows.splice(index, 1); changed(name); return; }
    }
  },
  close() { initialized = false; },
};

const realmFacade = {
  schemaVersion: 109,
  objects(schema: string) { return get(schema); },
  create(schema: string, object: any, updateMode?: any) { return dbManager.create(schema, object, updateMode); },
  write(callback: () => any) { return dbManager.write(callback); },
  delete(object: any) { return dbManager.delete(object); },
  close() { initialized = false; },
};

export class RealmDatabase {
  static file = 'keeper.realm';
  static schemaVersion = 109;
  initializeDatabase = async (key?: any, path?: string) => dbManager.initializeDatabase(key, path);
  getDatabase = () => dbManager.getDatabase();
  deleteDatabase = (_key?: any) => { dbManager.deleteRealm(); return true; };
  writeTransaction = (_realm: any, callback: () => any) => callback();
  create = (schema: string, object: any) => dbManager.create(schema, object);
  createBulk = (schema: string, objects: any[]) => dbManager.createBulk(schema, objects);
  get = (schema: string) => get(schema);
  write = (callback: () => any) => callback();
  delete = (object: any) => dbManager.delete(object);
  closeDatabase = () => { initialized = false; };
}

const realmDatabase = new RealmDatabase();
Object.assign(dbManager, {
  initializeDatabase: realmDatabase.initializeDatabase,
  getDatabase: realmDatabase.getDatabase,
  deleteDatabase: realmDatabase.deleteDatabase,
  writeTransaction: realmDatabase.writeTransaction,
  closeDatabase: realmDatabase.closeDatabase,
});

export default dbManager;

export function useQuery(schema: string, query?: (rows: any[]) => any) {
  const revision = useSyncExternalStore((listener) => { subscriptions.add(listener); return () => subscriptions.delete(listener); }, () => revisions.get(schema) || 0);
  return useMemo(() => {
    const rows = get(schema);
    return query ? query(rows) : rows;
  }, [schema, query, revision]);
}

export function useObject(schema: string, primaryKey: any) {
  return useQuery(schema).find((row: any) => row.id === primaryKey);
}

export function RealmProvider({ children }: React.PropsWithChildren) {
  // Open synchronously before rendering AppStack. Upstream Realm hooks read
  // during the first render, so a useEffect-based initialization is too late.
  initializeBrowserRealm();
  return React.createElement(React.Fragment, null, children);
}
export const RealmContext = React.createContext<any>(null);
export const Realm = { UpdateMode: { Never: 'never', Modified: 'modified', All: 'all' } };
// Native Realm exposes its API globally, and upstream saga workers use
// `Realm.UpdateMode.Modified` without importing the module. Preserve that
// contract in the browser adapter.
if (typeof globalThis !== 'undefined' && !(globalThis as any).Realm) {
  (globalThis as any).Realm = Realm;
}
