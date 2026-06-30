/**
 * Substrate — OverlayFS: union/copy-on-write backend.
 *
 *   lower  — read-only view (e.g. a freshly cloned, cached repo subtree)
 *   upper  — writable backend (MemFS or IDBFS) holding all modifications
 *   whiteouts — paths deleted in the overlay; hidden even if present in lower
 *
 * Reads prefer upper, fall through to lower. Writes always hit upper (whole-file,
 * so no byte-level copy-up needed). reset() wipes the upper layer and whiteouts,
 * snapping the view back to the pristine lower — the "discard my changes" button
 * every web IDE wants, for free.
 *
 * `lower` must implement the read half of the backend contract:
 *   stat, list, readFile, exists, exportTree.
 */
import { normalize, isUnder } from '../util/path.js';
import { MemFS } from './MemFS.js';
import { ENOENT, EISDIR } from '../core/errors.js';

export class OverlayFS {
  constructor({ lower, upper } = {}) {
    if (!lower) throw new Error('OverlayFS: lower layer required');
    this.readonly = false;
    this.lower = lower;
    this.upper = upper || new MemFS();
    this._whiteouts = new Set();   // normalized paths hidden from lower
  }

  _whitedOut(path) {
    path = normalize(path);
    for (const w of this._whiteouts) if (path === w || isUnder(w, path)) return true;
    return false;
  }

  _unwhiteoutChain(path) {
    // Writing at `path` resurrects it and its ancestors.
    path = normalize(path);
    for (const w of [...this._whiteouts]) if (w === path || isUnder(w, path) || isUnder(path, w)) this._whiteouts.delete(w);
  }

  async stat(rel) {
    rel = normalize(rel);
    if (this._whitedOut(rel)) throw ENOENT(rel);
    if (await this.upper.exists(rel)) return this.upper.stat(rel);
    return this.lower.stat(rel); // throws ENOENT if absent
  }

  async exists(rel) {
    rel = normalize(rel);
    if (this._whitedOut(rel)) return false;
    if (await this.upper.exists(rel)) return true;
    return this.lower.exists(rel);
  }

  async list(rel) {
    rel = normalize(rel);
    if (this._whitedOut(rel)) throw ENOENT(rel);
    const byName = new Map();
    let lowerExists = false;
    try { const le = await this.lower.list(rel); lowerExists = true; for (const e of le) byName.set(e.name, e); }
    catch { /* not in lower */ }
    let upperExists = false;
    try { const ue = await this.upper.list(rel); upperExists = true; for (const e of ue) byName.set(e.name, e); }
    catch { /* not in upper */ }
    if (!lowerExists && !upperExists) throw ENOENT(rel);
    // drop whited-out children
    const prefix = rel === '/' ? '/' : rel + '/';
    const out = [];
    for (const [name, entry] of byName) if (!this._whitedOut(prefix + name)) out.push(entry);
    out.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
    return out;
  }

  async readFile(rel) {
    rel = normalize(rel);
    if (this._whitedOut(rel)) throw ENOENT(rel);
    if (await this.upper.exists(rel)) return this.upper.readFile(rel);
    return this.lower.readFile(rel);
  }

  async writeFile(rel, bytes) {
    rel = normalize(rel);
    this._unwhiteoutChain(rel);
    return this.upper.writeFile(rel, bytes);
  }

  async mkdir(rel) {
    rel = normalize(rel);
    this._unwhiteoutChain(rel);
    return this.upper.mkdir(rel);
  }

  async remove(rel, opts = {}) {
    rel = normalize(rel);
    if (this._whitedOut(rel)) throw ENOENT(rel);
    const inUpper = await this.upper.exists(rel);
    const inLower = await this.lower.exists(rel);
    if (!inUpper && !inLower) throw ENOENT(rel);
    if (inUpper) { try { await this.upper.remove(rel, opts); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
    if (inLower) this._whiteouts.add(rel); // mask the lower copy
  }

  async rename(from, to) {
    from = normalize(from); to = normalize(to);
    const st = await this.stat(from); // throws if absent/whited
    if (st.type === 'dir') {
      // shallow dir rename: recreate tree via export/import then mask source
      const tree = await this._exportOverlay(from);
      await this.mkdir(to);
      await this.upper.importTree(to, tree);
    } else {
      const data = await this.readFile(from);
      await this.writeFile(to, data);
    }
    await this.remove(from, { recursive: true });
  }

  // export the merged (overlay) view of a subtree — used by rename + WASI
  async _exportOverlay(rel) {
    rel = normalize(rel);
    const dirs = new Set();
    const files = new Map();
    const walk = async (p) => {
      let entries;
      try { entries = await this.list(p); } catch { return; }
      const r = p === rel ? '' : p.slice((rel === '/' ? 1 : rel.length + 1));
      if (r) dirs.add(r);
      for (const e of entries) {
        const cp = p === '/' ? '/' + e.name : p + '/' + e.name;
        if (e.type === 'dir') await walk(cp);
        else files.set(cp.slice((rel === '/' ? 1 : rel.length + 1)), await this.readFile(cp));
      }
    };
    await walk(rel);
    return { dirs, files };
  }

  async exportTree(rel = '/') { return this._exportOverlay(rel); }
  async importTree(rel, tree) { this._unwhiteoutChain(rel); return this.upper.importTree(rel, tree); }

  /** Discard all overlay modifications, snapping back to the pristine lower. */
  async reset() {
    this._whiteouts.clear();
    this.upper = this.upper instanceof MemFS ? new MemFS() : this.upper;
    if (!(this.upper instanceof MemFS)) {
      // persistent upper: wipe its tree
      try { const t = await this.upper.list('/'); for (const e of t) await this.upper.remove('/' + e.name, { recursive: true }); } catch {}
    }
  }

  /** True if the overlay has any pending modifications over the lower layer. */
  async isDirty() {
    if (this._whiteouts.size) return true;
    try { return (await this.upper.list('/')).length > 0; } catch { return false; }
  }
}
