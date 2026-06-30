/**
 * Substrate — Store: a small promise-based key/value store.
 * Backed by IndexedDB in the browser; falls back to an in-memory Map when IDB
 * is unavailable (Node, private browsing, hostile embeds). Supports ordered
 * prefix scans, which IDBFS and the caches lean on for directory/manifest reads.
 *
 * Values may be any structured-cloneable thing (Uint8Array, plain objects...).
 */
const HI = '\uffff';

export class Store {
  constructor(dbName = 'substrate', storeName = 'kv') {
    this._dbName = dbName;
    this._storeName = storeName;
    this._db = null;
    this._mem = null;       // Map fallback
    this._ready = null;
  }

  open() {
    if (this._ready) return this._ready;
    this._ready = this._openImpl();
    return this._ready;
  }

  async _openImpl() {
    const idb = typeof indexedDB !== 'undefined' ? indexedDB : null;
    if (!idb) { this._mem = new Map(); return this; }
    try {
      this._db = await new Promise((resolve, reject) => {
        const req = idb.open(this._dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this._storeName)) db.createObjectStore(this._storeName);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch {
      this._mem = new Map(); // IDB blocked — degrade to RAM
    }
    return this;
  }

  _tx(mode) {
    const tx = this._db.transaction(this._storeName, mode);
    return tx.objectStore(this._storeName);
  }

  async get(key) {
    await this.open();
    if (this._mem) return this._mem.has(key) ? this._mem.get(key) : undefined;
    return new Promise((resolve, reject) => {
      const r = this._tx('readonly').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async set(key, value) {
    await this.open();
    if (this._mem) { this._mem.set(key, value); return; }
    return new Promise((resolve, reject) => {
      const r = this._tx('readwrite').put(value, key);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }

  async delete(key) {
    await this.open();
    if (this._mem) { this._mem.delete(key); return; }
    return new Promise((resolve, reject) => {
      const r = this._tx('readwrite').delete(key);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }

  async has(key) {
    return (await this.get(key)) !== undefined;
  }

  /** All keys, optionally filtered to those starting with `prefix`, sorted. */
  async keys(prefix = '') {
    await this.open();
    if (this._mem) return [...this._mem.keys()].filter(k => k.startsWith(prefix)).sort();
    return new Promise((resolve, reject) => {
      const range = prefix ? IDBKeyRange.bound(prefix, prefix + HI) : null;
      const r = this._tx('readonly').getAllKeys(range);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  /** [key, value] pairs for a prefix. */
  async entries(prefix = '') {
    await this.open();
    if (this._mem) return [...this._mem.entries()].filter(([k]) => k.startsWith(prefix)).sort((a, b) => a[0] < b[0] ? -1 : 1);
    const ks = await this.keys(prefix);
    const out = [];
    for (const k of ks) out.push([k, await this.get(k)]);
    return out;
  }

  async count(prefix = '') {
    return (await this.keys(prefix)).length;
  }

  async clear(prefix = '') {
    await this.open();
    if (!prefix) {
      if (this._mem) { this._mem.clear(); return; }
      return new Promise((resolve, reject) => {
        const r = this._tx('readwrite').clear();
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
      });
    }
    for (const k of await this.keys(prefix)) await this.delete(k);
  }
}
