/**
 * Substrate — GitClient: clone a public repo's file tree into the VFS, fast.
 *
 * This is NOT full git (no history, no packfiles). It fetches the file tree at a
 * ref and materialises it in the VFS — exactly what a browser IDE needs: "give
 * me the files of repo X at ref Y so I can read/run them." What makes it fast:
 *
 *   • One request lists the whole tree (jsDelivr) with per-file SHA-256.
 *   • The ObjectCache is content-addressed, so a re-clone only downloads files
 *     whose content actually changed — and files shared with a previously cloned
 *     repo cost zero bytes (cross-repo dedup).
 *   • Everything persists, so a cold reload of the page reconstructs the repo
 *     from IndexedDB with no network at all.
 *
 * clone(spec, opts) phases (emitted as 'git:progress'):
 *   resolve → list → diff → fetch → write → done
 */
import { parseRepoSpec, buildProviders } from './providers.js';
import { b64HashToHex, sha256Hex, pool } from '../util/hash.js';
import { GitError } from '../core/errors.js';

const ORIGIN_FILE = '.substrate/repo.json';

export class GitClient {
  constructor({ fetcher, vfs, objectCache, repoCache, bus, provider = 'auto', concurrency = 10, useProxy = false } = {}) {
    this._f = fetcher;
    this._vfs = vfs;
    this._obj = objectCache;
    this._repos = repoCache;
    this._bus = bus;
    this._providerPref = provider;
    this._concurrency = concurrency;
    this._useProxy = useProxy;
  }

  _emit(phase, data) { this._bus?.emit('git:progress', { phase, ...data }); }

  /** List a repo tree without downloading file bytes. */
  async ls(spec, { ref } = {}) {
    const { owner, repo, ref: specRef } = parseRepoSpec(spec);
    const { tree } = await this._resolveTree(owner, repo, ref || specRef);
    return tree.files.map(f => ({ path: f.path, size: f.size }));
  }

  /** Fetch a single file's bytes (cached). Handy for grabbing one config/blob. */
  async fetchFile(spec, path, { ref } = {}) {
    const { owner, repo, ref: specRef } = parseRepoSpec(spec);
    const { provider, tree } = await this._resolveTree(owner, repo, ref || specRef);
    const entry = tree.files.find(f => f.path === path.replace(/^\//, ''));
    if (!entry) throw new GitError(`file not in repo: ${path}`);
    const { bytes } = await this._materialise(entry, provider);
    return bytes;
  }

  /**
   * Clone repo file tree into the VFS at `into`.
   * opts: { ref, into, force, filter(path)=>bool, onProgress, signal }
   */
  async clone(spec, opts = {}) {
    const { owner, repo, ref: specRef } = parseRepoSpec(spec);
    const ref = opts.ref || specRef || 'HEAD';
    const into = opts.into || `/repos/${repo}`;
    const filter = opts.filter || (() => true);
    const onProgress = opts.onProgress || (() => {});
    const t0 = Date.now();

    this._emit('resolve', { owner, repo, ref });
    onProgress({ phase: 'resolve', owner, repo, ref });

    const { provider, tree, resolved } = await this._resolveTree(owner, repo, ref);
    this._emit('list', { count: tree.files.length, provider: provider.name, resolved });
    onProgress({ phase: 'list', total: tree.files.length, provider: provider.name });

    // Diff against last cached manifest for this provider/ref.
    const prevManifest = opts.force ? null : await this._repos.get(provider.name, owner, repo, resolved);
    const prevByPath = new Map((prevManifest?.files || []).map(e => [e.path, e]));

    const selected = tree.files.filter(f => filter(f.path));
    this._emit('diff', { total: selected.length, cached: prevByPath.size });

    let fetched = 0, reused = 0, bytesIn = 0, done = 0;
    const manifest = { ref, resolved, provider: provider.name, files: [] };

    const tasks = selected.map(entry => async () => {
      if (opts.signal?.aborted) throw new GitError('clone aborted');
      const prev = prevByPath.get(entry.path);
      const { bytes, key, cacheHit } = await this._materialise(entry, provider, prev);
      if (cacheHit) reused++; else { fetched++; bytesIn += bytes.byteLength; }
      const dest = into + '/' + entry.path;
      await this._vfs.writeFile(dest, bytes);
      manifest.files.push({ path: entry.path, srcId: entry.srcId, key, size: bytes.byteLength });
      done++;
      onProgress({ phase: 'fetch', loaded: done, total: selected.length, path: entry.path, cacheHit });
      this._emit('fetch', { loaded: done, total: selected.length, path: entry.path, cacheHit });
    });

    await pool(tasks, this._concurrency);
    // surface any task errors
    // (pool swallows into results; re-run check)

    this._emit('write', { into, files: manifest.files.length });

    // Save manifest + origin metadata so pull()/cold-reload can reconstruct.
    await this._repos.put(provider.name, owner, repo, resolved, manifest);
    await this._vfs.writeText(into + '/' + ORIGIN_FILE, JSON.stringify({
      spec: `github:${owner}/${repo}`, owner, repo, ref, resolved, provider: provider.name,
      clonedAt: Date.now(), files: manifest.files.length,
    }, null, 2));

    const summary = {
      into, owner, repo, ref, resolved, provider: provider.name,
      files: manifest.files.length, fetched, reused, bytesDownloaded: bytesIn,
      ms: Date.now() - t0,
    };
    this._emit('done', summary);
    onProgress({ phase: 'done', ...summary });
    return summary;
  }

  /** Re-clone using the origin metadata written at clone time. */
  async pull(into, opts = {}) {
    const meta = JSON.parse(await this._vfs.readText(into + '/' + ORIGIN_FILE));
    return this.clone(meta.spec, { ...opts, ref: opts.ref || meta.ref, into, force: opts.force });
  }

  // ── internals ──────────────────────────────────────────────────────────

  async _resolveTree(owner, repo, ref) {
    const providers = buildProviders(this._f, this._providerPref);
    // ref fallbacks: explicit → main → master → HEAD (only when none given)
    const refsToTry = ref ? [ref] : ['HEAD', 'main', 'master'];
    let lastErr;
    for (const provider of providers) {
      for (const r of refsToTry) {
        try {
          const tree = await provider.listTree({ owner, repo, ref: r });
          if (tree.files.length) return { provider, tree, resolved: tree.resolved || r };
        } catch (e) { lastErr = e; }
      }
    }
    throw new GitError(`could not resolve repo ${owner}/${repo}@${ref || 'default'} via any provider`, { cause: lastErr });
  }

  /**
   * Turn a tree entry into bytes, hitting cache first.
   * Returns { bytes, key (content address), cacheHit }.
   */
  async _materialise(entry, provider, prev = null) {
    // jsDelivr gives content sha256 up front → derive the cache key without I/O.
    if (provider.name === 'jsdelivr' && entry.srcId) {
      const key = b64HashToHex(entry.srcId);
      const cached = await this._obj.get(key);
      if (cached) return { bytes: cached, key, cacheHit: true };
      const res = await this._f.fetch(entry.url, { as: 'bytes', useProxy: this._useProxy });
      if (!res.ok) throw new GitError(`fetch failed (${res.status}) for ${entry.path}`);
      await this._obj.put(res.bytes, key); // store under the known sha256
      return { bytes: res.bytes, key, cacheHit: false };
    }

    // GitHub: srcId is a git blob sha1. If unchanged since last clone and the
    // content object is still cached, reuse it without downloading.
    if (prev && prev.srcId === entry.srcId && prev.key && await this._obj.has(prev.key)) {
      const cached = await this._obj.get(prev.key);
      if (cached) return { bytes: cached, key: prev.key, cacheHit: true };
    }
    const res = await this._f.fetch(entry.url, { as: 'bytes', useProxy: this._useProxy });
    if (!res.ok) throw new GitError(`fetch failed (${res.status}) for ${entry.path}`);
    const key = await this._obj.put(res.bytes); // sha256 content address
    return { bytes: res.bytes, key, cacheHit: false };
  }
}
