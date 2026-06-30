/**
 * Substrate — ObjectCache: content-addressed blob store.
 *
 * Files are keyed by their SHA-256 (hex). Identical content across repos/refs
 * is stored once — clone the same interpreter at two refs and the unchanged
 * files cost nothing the second time. Metadata (size, last-access) is kept
 * separate from the bytes so LRU eviction never has to load file bodies.
 *
 *   obj:<hex>  → Uint8Array
 *   om:<hex>   → { size, atime }
 */
import { Store } from './Store.js';
import { sha256Hex, b64HashToHex } from '../util/hash.js';
import { toBytes } from '../util/bytes.js';

const OBJ = 'obj:';
const OM = 'om:';

export class ObjectCache {
  constructor({ dbName = 'substrate-cache', maxBytes = 256 * 1024 * 1024, bus = null } = {}) {
    this._store = new Store(dbName, 'objects');
    this.maxBytes = maxBytes;
    this._bus = bus;
    this._total = 0;
    this._ready = null;
  }

  async open() {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      await this._store.open();
      // recompute total once from metadata
      const metas = await this._store.entries(OM);
      this._total = metas.reduce((s, [, m]) => s + (m?.size || 0), 0);
      return this;
    })();
    return this._ready;
  }

  async has(hex) { await this.open(); return this._store.has(OBJ + hex); }

  async get(hex) {
    await this.open();
    const bytes = await this._store.get(OBJ + hex);
    if (bytes === undefined) return undefined;
    // touch atime (cheap; metadata only)
    const m = (await this._store.get(OM + hex)) || { size: bytes.byteLength };
    m.atime = Date.now();
    await this._store.set(OM + hex, m);
    return new Uint8Array(bytes);
  }

  /** Store bytes; returns the hex hash. Dedups; updates LRU + eviction. */
  async put(bytes, knownHex = null) {
    await this.open();
    bytes = toBytes(bytes);
    const hex = knownHex || await sha256Hex(bytes);
    if (await this._store.has(OBJ + hex)) { await this._touch(hex); return hex; }
    await this._store.set(OBJ + hex, bytes);
    await this._store.set(OM + hex, { size: bytes.byteLength, atime: Date.now() });
    this._total += bytes.byteLength;
    this._bus?.emit('cache:put', { hex, size: bytes.byteLength, total: this._total });
    if (this._total > this.maxBytes) await this._evict();
    return hex;
  }

  /** Store using a jsDelivr-style base64 sha256, returning the hex key. */
  async putWithBase64Hash(bytes, b64) {
    const hex = b64HashToHex(b64);
    return this.put(bytes, hex);
  }

  async _touch(hex) {
    const m = await this._store.get(OM + hex);
    if (m) { m.atime = Date.now(); await this._store.set(OM + hex, m); }
  }

  async _evict() {
    const metas = await this._store.entries(OM);
    metas.sort((a, b) => (a[1]?.atime || 0) - (b[1]?.atime || 0)); // oldest first
    let i = 0;
    while (this._total > this.maxBytes * 0.9 && i < metas.length) {
      const [key, m] = metas[i++];
      const hex = key.slice(OM.length);
      await this._store.delete(OBJ + hex);
      await this._store.delete(key);
      this._total -= (m?.size || 0);
      this._bus?.emit('cache:evict', { hex, size: m?.size || 0 });
    }
  }

  async stats() {
    await this.open();
    const count = await this._store.count(OBJ);
    return { count, totalBytes: this._total, maxBytes: this.maxBytes };
  }

  async clear() { await this.open(); await this._store.clear(); this._total = 0; }
}
