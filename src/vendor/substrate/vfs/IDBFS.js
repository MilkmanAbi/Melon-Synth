/**
 * Substrate — IDBFS: persistent backend over a Store (IndexedDB).
 * Same contract as MemFS, so the VFS router treats them identically. Used for
 * /home and anywhere a frontend wants edits to survive reloads.
 *
 * Each node is stored under key  `node:<path>`  as {type, mtime, ctime, mode}
 * plus, for files, the bytes under `data:<path>`. Splitting metadata from data
 * keeps directory listings cheap (no need to load file bodies).
 */
import { Store } from '../cache/Store.js';
import { normalize } from '../util/path.js';
import { toBytes } from '../util/bytes.js';
import { ENOENT, ENOTDIR, EISDIR, EEXIST } from '../core/errors.js';

const NODE = 'node:';
const DATA = 'data:';

export class IDBFS {
  constructor(dbName = 'substrate-fs', storeName = 'fs') {
    this.readonly = false;
    this._store = new Store(dbName, storeName);
    this._ready = null;
  }

  async open() {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      await this._store.open();
      if (!(await this._store.has(NODE + '/')))
        await this._store.set(NODE + '/', { type: 'dir', mtime: Date.now(), ctime: Date.now(), mode: 0o755 });
      return this;
    })();
    return this._ready;
  }

  async _ensureParents(path) {
    const segs = normalize(path).split('/').filter(Boolean);
    let cur = '';
    for (let i = 0; i < segs.length - 1; i++) {
      cur += '/' + segs[i];
      const n = await this._store.get(NODE + cur);
      if (!n) await this._store.set(NODE + cur, { type: 'dir', mtime: Date.now(), ctime: Date.now(), mode: 0o755 });
      else if (n.type !== 'dir') throw ENOTDIR(cur);
    }
  }

  async stat(rel) {
    rel = normalize(rel);
    const n = await this._store.get(NODE + rel);
    if (!n) throw ENOENT(rel);
    let size = 0;
    if (n.type === 'file') { const d = await this._store.get(DATA + rel); size = d ? d.byteLength : 0; }
    return { type: n.type, size, mtime: n.mtime, ctime: n.ctime, mode: n.mode };
  }

  async exists(rel) { return this._store.has(NODE + normalize(rel)); }

  async list(rel) {
    rel = normalize(rel);
    const n = await this._store.get(NODE + rel);
    if (!n) throw ENOENT(rel);
    if (n.type !== 'dir') throw ENOTDIR(rel);
    const prefix = rel === '/' ? '/' : rel + '/';
    const keys = await this._store.keys(NODE + prefix);
    const seen = new Set();
    const out = [];
    for (const k of keys) {
      const p = k.slice(NODE.length);
      const rest = p.slice(prefix.length);
      const slash = rest.indexOf('/');
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const childPath = prefix === '/' ? '/' + name : prefix + name;
      const child = await this._store.get(NODE + childPath);
      let size = 0;
      if (child?.type === 'file') { const d = await this._store.get(DATA + childPath); size = d ? d.byteLength : 0; }
      out.push({ name, type: child?.type ?? 'dir', size, mtime: child?.mtime ?? 0 });
    }
    out.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
    return out;
  }

  async readFile(rel) {
    rel = normalize(rel);
    const n = await this._store.get(NODE + rel);
    if (!n) throw ENOENT(rel);
    if (n.type !== 'file') throw EISDIR(rel);
    const d = await this._store.get(DATA + rel);
    return d ? new Uint8Array(d) : new Uint8Array(0);
  }

  async writeFile(rel, bytes) {
    rel = normalize(rel);
    if (rel === '/') throw EISDIR(rel);
    const existing = await this._store.get(NODE + rel);
    if (existing && existing.type === 'dir') throw EISDIR(rel);
    await this._ensureParents(rel);
    const data = toBytes(bytes);
    const now = Date.now();
    await this._store.set(NODE + rel, { type: 'file', mtime: now, ctime: existing?.ctime ?? now, mode: existing?.mode ?? 0o644 });
    await this._store.set(DATA + rel, data);
    return data.byteLength;
  }

  async mkdir(rel) {
    rel = normalize(rel);
    const existing = await this._store.get(NODE + rel);
    if (existing) { if (existing.type !== 'dir') throw EEXIST(rel); return; }
    await this._ensureParents(rel);
    await this._store.set(NODE + rel, { type: 'dir', mtime: Date.now(), ctime: Date.now(), mode: 0o755 });
  }

  async remove(rel, { recursive = false } = {}) {
    rel = normalize(rel);
    if (rel === '/') throw EISDIR('/');
    const n = await this._store.get(NODE + rel);
    if (!n) throw ENOENT(rel);
    if (n.type === 'dir') {
      const prefix = rel + '/';
      const childKeys = await this._store.keys(NODE + prefix);
      if (childKeys.length && !recursive) throw new Error(`directory not empty: ${rel}`);
      for (const k of childKeys) { const p = k.slice(NODE.length); await this._store.delete(NODE + p); await this._store.delete(DATA + p); }
    }
    await this._store.delete(NODE + rel);
    await this._store.delete(DATA + rel);
  }

  async rename(from, to) {
    from = normalize(from); to = normalize(to);
    if (!(await this._store.has(NODE + from))) throw ENOENT(from);
    await this._ensureParents(to);
    const prefix = from + '/';
    const keys = await this._store.keys(NODE + prefix);
    const all = [from, ...keys.map(k => k.slice(NODE.length))];
    for (const p of all) {
      const np = to + p.slice(from.length);
      const node = await this._store.get(NODE + p);
      const data = await this._store.get(DATA + p);
      await this._store.set(NODE + np, node);
      if (data !== undefined) await this._store.set(DATA + np, data);
    }
    for (const p of all) { await this._store.delete(NODE + p); await this._store.delete(DATA + p); }
  }

  async exportTree(rel = '/') {
    rel = normalize(rel);
    const dirs = new Set();
    const files = new Map();
    const prefix = rel === '/' ? '/' : rel + '/';
    const keys = await this._store.keys(NODE);
    for (const k of keys) {
      const p = k.slice(NODE.length);
      if (p !== rel && !p.startsWith(prefix)) continue;
      const node = await this._store.get(k);
      const r = p === rel ? '' : p.slice(prefix.length);
      if (node.type === 'dir') dirs.add(r);
      else files.set(r, await this.readFile(p));
    }
    return { dirs, files };
  }

  async importTree(rel, tree) {
    rel = normalize(rel);
    for (const d of tree.dirs) await this.mkdir(d ? (rel === '/' ? '/' + d : rel + '/' + d) : rel);
    for (const [r, data] of tree.files) await this.writeFile(rel === '/' ? '/' + r : rel + '/' + r, data);
  }
}
