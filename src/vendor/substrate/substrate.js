/**
 * Substrate — a browser-native backend kernel for static web apps.
 *
 * No server, no GUI. It gives a frontend the primitives a real IDE needs:
 *   - a mountable virtual filesystem (in-RAM, IndexedDB-persistent, copy-on-write
 *     overlays, zip, proc),
 *   - git clone over a CDN transport with content-addressed caching so a second
 *     clone of the same tree costs almost no network,
 *   - a WASM runtime that runs cloned wasm32-wasi binaries against the VFS
 *     (this is how a cloned language toolchain executes user code),
 *   - an in-memory ES module loader that imports cloned JS straight out of the
 *     VFS with its relative imports linked.
 *
 * The dev builds the UI; Substrate is the engine underneath it.
 *
 *   import { createSubstrate } from 'substrate';
 *   const sb = await createSubstrate({ persist: true });
 *   await sb.git.clone('github:owner/repo', { into: '/opt/repo' });
 *   const out = await sb.wasm.run('/opt/repo/bin/tool.wasm', {
 *     args: ['tool', '/work/main.src'],
 *     preopens: { '/': '/work' },
 *     stdout: chunk => term.write(chunk),
 *   });
 *   const driver = await sb.modules.import('/opt/repo/js/index.js');
 */
import { EventBus } from './core/EventBus.js';
import { VFS } from './vfs/VFS.js';
import { MemFS } from './vfs/MemFS.js';
import { IDBFS } from './vfs/IDBFS.js';
import { OverlayFS } from './vfs/OverlayFS.js';
import { Fetcher } from './net/Fetcher.js';
import { ObjectCache } from './cache/ObjectCache.js';
import { RepoCache } from './cache/RepoCache.js';
import { GitClient } from './git/GitClient.js';
import { WasmRuntime } from './wasm/WasmRuntime.js';
import { ModuleLoader } from './module/ModuleLoader.js';

/**
 * @param {object} [options]
 * @param {boolean} [options.persist=false]  back the root FS with IndexedDB
 * @param {string}  [options.root='/']        mountpoint for the root FS
 * @param {string[]}[options.dirs]            directories to ensure exist
 * @param {boolean|object} [options.cache=true]  object/repo cache config
 *        ({ enabled, maxBytes, dbName })
 * @param {object}  [options.net]             Fetcher config ({ corsProxy, retries, timeoutMs })
 * @param {object}  [options.git]             GitClient config ({ provider, concurrency, useProxy })
 * @param {object}  [options.wasm]            WasmRuntime config ({ cache })
 * @param {object}  [options.modules]         ModuleLoader config ({ externals })
 * @param {EventBus}[options.bus]             reuse an external event bus
 * @returns {Promise<Substrate>}
 */
export async function createSubstrate(options = {}) {
  const {
    persist = false,
    root = '/',
    dirs = ['/home', '/tmp', '/opt', '/repos'],
    cache = true,
    net = {},
    git = {},
    wasm = {},
    modules = {},
    bus = new EventBus(),
  } = options;

  const cacheCfg = cache === false ? { enabled: false } : { enabled: true, ...(cache === true ? {} : cache) };

  // ── filesystem ────────────────────────────────────────────────────────────
  const vfs = new VFS(bus);
  const rootBackend = persist
    ? new IDBFS(cacheCfg.dbName ? cacheCfg.dbName + '-fs' : 'substrate-fs')
    : new MemFS();
  await vfs.mount(root, rootBackend);
  for (const d of dirs) { try { await vfs.mkdir(d); } catch {} }

  // ── caches ──────────────────────────────────────────────────────────────--
  let objectCache = null, repoCache = null;
  if (cacheCfg.enabled) {
    objectCache = new ObjectCache({
      dbName: cacheCfg.dbName || 'substrate-cache',
      maxBytes: cacheCfg.maxBytes || 256 * 1024 * 1024,
      bus,
    });
    repoCache = new RepoCache({ dbName: cacheCfg.dbName || 'substrate-cache', bus });
    await objectCache.open();
    await repoCache.open();
  }

  // ── network ─────────────────────────────────────────────────────────────--
  const fetcher = new Fetcher({
    corsProxy: net.corsProxy || '',
    retries: net.retries ?? 2,
    retryDelayMs: net.retryDelayMs ?? 250,
    timeoutMs: net.timeoutMs ?? 30000,
    bus,
  });

  // ── git ─────────────────────────────────────────────────────────────────--
  const gitClient = new GitClient({
    fetcher, vfs, objectCache, repoCache, bus,
    provider: git.provider || 'auto',
    concurrency: git.concurrency ?? 10,
    useProxy: git.useProxy ?? false,
  });

  // ── wasm ────────────────────────────────────────────────────────────────--
  const wasmRuntime = new WasmRuntime({ vfs, bus, objectCache, cache: wasm.cache ?? true });

  // ── modules ─────────────────────────────────────────────────────────────--
  const moduleLoader = new ModuleLoader({ vfs, bus, externals: modules.externals || {} });

  return new Substrate({ bus, vfs, objectCache, repoCache, fetcher, gitClient, wasmRuntime, moduleLoader, persist });
}

/** The orchestrated handle returned by createSubstrate(). */
export class Substrate {
  constructor({ bus, vfs, objectCache, repoCache, fetcher, gitClient, wasmRuntime, moduleLoader, persist }) {
    this.bus = bus;
    this.fs = vfs;
    this.net = fetcher;
    this.cache = { objects: objectCache, repos: repoCache };
    this.persist = persist;

    // git facade (bind so callers can destructure)
    this._git = gitClient;
    this.git = {
      clone: (spec, opts) => gitClient.clone(spec, opts),
      pull: (into, opts) => gitClient.pull(into, opts),
      fetchFile: (spec, path, opts) => gitClient.fetchFile(spec, path, opts),
      ls: (spec, opts) => gitClient.ls(spec, opts),
    };

    // wasm facade
    this._wasm = wasmRuntime;
    this.wasm = {
      load: (path) => wasmRuntime.load(path),
      compile: (bytes, meta) => wasmRuntime.compile(bytes, meta),
      run: (mod, opts) => wasmRuntime.run(mod, opts),
      clearCache: () => wasmRuntime.clearCache(),
    };

    // module facade
    this._modules = moduleLoader;
    this.modules = {
      import: (path, opts) => moduleLoader.import(path, opts),
      link: (path, opts) => moduleLoader.link(path, opts),
      evaluate: (src, opts) => moduleLoader.evaluate(src, opts),
      invalidate: (path) => moduleLoader.invalidate(path),
    };
  }

  /** Subscribe to a kernel event ('git:progress', 'wasm:exit', 'fs:change', ...). */
  on(event, handler) { return this.bus.on(event, handler); }
  once(event, handler) { return this.bus.once(event, handler); }

  /** Mount an additional backend (e.g. a zip, a second IDB store). */
  mount(path, backend) { return this.fs.mount(path, backend); }

  /** Copy-on-write overlay: edits land on top, the lower tree stays pristine. */
  overlay(lowerPath, mountPath) { return this.fs.overlay(lowerPath, mountPath); }

  /**
   * Clone a repo and immediately mount a writable copy-on-write overlay over it,
   * so the original cloned tree stays clean and the IDE's edits are isolated and
   * resettable. Returns the clone summary plus the overlay mountpoint.
   */
  async cloneWorkspace(spec, { into, workdir, ...opts } = {}) {
    const summary = await this.git.clone(spec, { into, ...opts });
    const lower = summary.into;
    const mount = workdir || (lower + '-work');
    const overlay = this.overlay(lower, mount);
    if (overlay.ready) await overlay.ready;
    return { ...summary, lower, workdir: mount, overlay };
  }

  /** Release in-memory resources (object URLs, compiled-module cache). */
  dispose() {
    this._modules.dispose();
    this._wasm.clearCache();
  }
}

// Re-export the building blocks so consumers can compose their own stack.
export { EventBus } from './core/EventBus.js';
export { VFS } from './vfs/VFS.js';
export { MemFS } from './vfs/MemFS.js';
export { IDBFS } from './vfs/IDBFS.js';
export { OverlayFS } from './vfs/OverlayFS.js';
export { Fetcher } from './net/Fetcher.js';
export { ObjectCache } from './cache/ObjectCache.js';
export { RepoCache } from './cache/RepoCache.js';
export { Store } from './cache/Store.js';
export { GitClient } from './git/GitClient.js';
export { JsDelivrProvider, GitHubProvider, parseRepoSpec, buildProviders } from './git/providers.js';
export { WasmRuntime, WasmModule } from './wasm/WasmRuntime.js';
export { Wasi, WasiFS } from './wasm/Wasi.js';
export { ModuleLoader } from './module/ModuleLoader.js';
export * from './core/errors.js';

export default createSubstrate;
