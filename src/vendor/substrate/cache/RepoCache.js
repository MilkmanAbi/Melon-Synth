/**
 * Substrate — RepoCache: remembers the file manifest of a cloned repo.
 *
 * A manifest maps repo paths → object hashes (+ sizes). On re-clone we diff the
 * fresh remote manifest against the cached one: unchanged files (same hash) are
 * pulled straight from the ObjectCache, only changed/new files hit the network.
 * That is the incremental-clone fast path.
 *
 *   man:<provider>:<owner>/<repo>@<ref>  →  { ref, resolved, files:[{path,hex,size}], fetchedAt }
 */
import { Store } from './Store.js';

export class RepoCache {
  constructor({ dbName = 'substrate-cache', bus = null } = {}) {
    this._store = new Store(dbName, 'repos');
    this._bus = bus;
  }
  async open() { await this._store.open(); return this; }

  _key(provider, owner, repo, ref) { return `man:${provider}:${owner}/${repo}@${ref}`; }

  async get(provider, owner, repo, ref) {
    await this.open();
    return this._store.get(this._key(provider, owner, repo, ref));
  }

  async put(provider, owner, repo, ref, manifest) {
    await this.open();
    const rec = { ...manifest, fetchedAt: Date.now() };
    await this._store.set(this._key(provider, owner, repo, ref), rec);
    this._bus?.emit('cache:manifest', { provider, owner, repo, ref, files: manifest.files?.length || 0 });
    return rec;
  }

  /** List every cached repo (for a "cached repos" UI). */
  async list() {
    await this.open();
    const entries = await this._store.entries('man:');
    return entries.map(([k, v]) => ({ key: k.slice(4), ref: v.ref, files: v.files?.length || 0, fetchedAt: v.fetchedAt }));
  }

  async forget(provider, owner, repo, ref) {
    await this.open();
    await this._store.delete(this._key(provider, owner, repo, ref));
  }

  async clear() { await this.open(); await this._store.clear(); }
}
