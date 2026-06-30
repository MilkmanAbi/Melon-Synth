/**
 * Substrate — MemFS: fast, ephemeral, in-RAM backend.
 * Path-keyed (absolute paths within this backend's own namespace; '/' = its root).
 * Implements the Substrate backend contract consumed by VFS.js.
 *
 * Backend contract (all async unless noted):
 *   stat(rel)                  → {type,size,mtime,ctime,mode}  | throws ENOENT
 *   list(rel)                  → [{name,type,size,mtime}]
 *   readFile(rel)              → Uint8Array
 *   writeFile(rel,bytes)       → number (bytes written); creates parent dirs
 *   mkdir(rel)                 → void; idempotent; creates parents
 *   remove(rel,{recursive})    → void
 *   rename(from,to)            → void
 *   exists(rel)                → boolean
 *   exportTree(rel)            → {dirs:Set<string>, files:Map<string,Uint8Array>} (sync snapshot)
 *   importTree(rel,tree)       → void (writeback)
 *   readonly                   → boolean
 */
import { normalize, dirname, basename, isUnder, relative } from '../util/path.js';
import { toBytes } from '../util/bytes.js';
import { ENOENT, ENOTDIR, EISDIR, EEXIST } from '../core/errors.js';

export class MemFS {
  constructor() {
    this.readonly = false;
    this._nodes = new Map(); // path -> {type, data?, mtime, ctime, mode}
    this._nodes.set('/', { type: 'dir', mtime: Date.now(), ctime: Date.now(), mode: 0o755 });
  }

  _ensureParents(path) {
    const segs = normalize(path).split('/').filter(Boolean);
    let cur = '';
    for (let i = 0; i < segs.length - 1; i++) {
      cur += '/' + segs[i];
      const n = this._nodes.get(cur);
      if (!n) this._nodes.set(cur, { type: 'dir', mtime: Date.now(), ctime: Date.now(), mode: 0o755 });
      else if (n.type !== 'dir') throw ENOTDIR(cur);
    }
  }

  async stat(rel) {
    rel = normalize(rel);
    const n = this._nodes.get(rel);
    if (!n) throw ENOENT(rel);
    return {
      type: n.type,
      size: n.type === 'file' ? n.data.byteLength : 0,
      mtime: n.mtime, ctime: n.ctime, mode: n.mode,
    };
  }

  async exists(rel) { return this._nodes.has(normalize(rel)); }

  async list(rel) {
    rel = normalize(rel);
    const n = this._nodes.get(rel);
    if (!n) throw ENOENT(rel);
    if (n.type !== 'dir') throw ENOTDIR(rel);
    const prefix = rel === '/' ? '/' : rel + '/';
    const seen = new Set();
    const out = [];
    for (const [p, node] of this._nodes) {
      if (p === rel || !p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const slash = rest.indexOf('/');
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const childPath = prefix === '/' ? '/' + name : prefix + name;
      const child = this._nodes.get(childPath);
      out.push({
        name, type: child ? child.type : 'dir',
        size: child && child.type === 'file' ? child.data.byteLength : 0,
        mtime: child ? child.mtime : 0,
      });
    }
    out.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
    return out;
  }

  async readFile(rel) {
    rel = normalize(rel);
    const n = this._nodes.get(rel);
    if (!n) throw ENOENT(rel);
    if (n.type !== 'file') throw EISDIR(rel);
    return n.data;
  }

  async writeFile(rel, bytes) {
    rel = normalize(rel);
    if (rel === '/') throw EISDIR(rel);
    const existing = this._nodes.get(rel);
    if (existing && existing.type === 'dir') throw EISDIR(rel);
    this._ensureParents(rel);
    const data = toBytes(bytes);
    const now = Date.now();
    this._nodes.set(rel, { type: 'file', data, mtime: now, ctime: existing?.ctime ?? now, mode: existing?.mode ?? 0o644 });
    return data.byteLength;
  }

  async mkdir(rel) {
    rel = normalize(rel);
    const existing = this._nodes.get(rel);
    if (existing) { if (existing.type !== 'dir') throw EEXIST(rel); return; }
    this._ensureParents(rel);
    this._nodes.set(rel, { type: 'dir', mtime: Date.now(), ctime: Date.now(), mode: 0o755 });
  }

  async remove(rel, { recursive = false } = {}) {
    rel = normalize(rel);
    if (rel === '/') throw EISDIR('/');
    const n = this._nodes.get(rel);
    if (!n) throw ENOENT(rel);
    if (n.type === 'dir') {
      const prefix = rel + '/';
      const children = [...this._nodes.keys()].filter(p => p.startsWith(prefix));
      if (children.length && !recursive) throw new Error(`directory not empty: ${rel}`);
      for (const c of children) this._nodes.delete(c);
    }
    this._nodes.delete(rel);
  }

  async rename(from, to) {
    from = normalize(from); to = normalize(to);
    if (!this._nodes.has(from)) throw ENOENT(from);
    this._ensureParents(to);
    const prefix = from + '/';
    const moves = [];
    for (const [p, node] of this._nodes) {
      if (p === from) moves.push([to, node]);
      else if (p.startsWith(prefix)) moves.push([to + p.slice(from.length), node]);
    }
    for (const [, ] of moves) {} // no-op
    // delete originals
    this._nodes.delete(from);
    for (const p of [...this._nodes.keys()]) if (p.startsWith(prefix)) this._nodes.delete(p);
    for (const [p, node] of moves) this._nodes.set(p, node);
  }

  // ── synchronous snapshot (for WASI) ──────────────────────────────────────
  exportTree(rel = '/') {
    rel = normalize(rel);
    const dirs = new Set();
    const files = new Map();
    const prefix = rel === '/' ? '/' : rel + '/';
    for (const [p, node] of this._nodes) {
      if (p !== rel && !p.startsWith(prefix)) continue;
      const r = p === rel ? '' : p.slice(prefix.length);
      if (node.type === 'dir') dirs.add(r);
      else files.set(r, node.data);
    }
    return { dirs, files };
  }

  importTree(rel, tree) {
    rel = normalize(rel);
    for (const d of tree.dirs) {
      const p = d ? (rel === '/' ? '/' + d : rel + '/' + d) : rel;
      if (!this._nodes.has(p)) { this._ensureParents(p); this._nodes.set(p, { type: 'dir', mtime: Date.now(), ctime: Date.now(), mode: 0o755 }); }
    }
    for (const [r, data] of tree.files) {
      const p = rel === '/' ? '/' + r : rel + '/' + r;
      this._ensureParents(p);
      this._nodes.set(p, { type: 'file', data, mtime: Date.now(), ctime: Date.now(), mode: 0o644 });
    }
  }
}
