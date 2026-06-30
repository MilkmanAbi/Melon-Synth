/**
 * Substrate — WASM runtime.
 *
 * Loads a `.wasm` module out of the VFS, compiles it (caching the compiled
 * WebAssembly.Module by the content hash of its bytes so a re-run never
 * recompiles), and executes it under the WASI preview1 shim with directories
 * mounted straight from the VFS.
 *
 * The interpreter-in-the-browser pattern this exists for:
 *   await sb.git.clone('github:owner/lang', { into: '/opt/lang' });
 *   const mod = await sb.wasm.load('/opt/lang/bin/lang.wasm');
 *   const { exitCode } = await sb.wasm.run(mod, {
 *     args: ['lang', '/src/main.lang'],
 *     preopens: { '/': '/home/project' },   // guest dir  ->  VFS path
 *     stdout: chunk => term.write(chunk),
 *   });
 *
 * Because WASI calls are synchronous, the runtime snapshots each preopen's VFS
 * subtree into an in-memory WasiFS before the run and writes changed files back
 * afterwards. The working set of a clone-and-run easily fits in RAM, so this is
 * both simple and correct for standard wasm32-wasi binaries.
 */
import { Wasi, WasiFS } from './Wasi.js';
import { WasmExit, WasmError } from '../core/errors.js';
import { sha256Hex } from '../util/hash.js';
import { normalize } from '../util/path.js';
import { toBytes, toText, concatBytes } from '../util/bytes.js';

/** Handle returned by load() — wraps a compiled module + its provenance. */
class WasmModule {
  constructor(hash, module, { path = null, imports = [], exports = [] } = {}) {
    this.hash = hash;            // hex content hash of the wasm bytes
    this.module = module;        // WebAssembly.Module
    this.path = path;            // VFS path it was loaded from (if any)
    this.imports = imports;      // [{module,name,kind}]
    this.exports = exports;      // [{name,kind}]
  }
  /** True if the module imports the WASI preview1 namespace. */
  get isWasi() {
    return this.imports.some(i => i.module === 'wasi_snapshot_preview1' || i.module === 'wasi_unstable');
  }
}

export class WasmRuntime {
  /** @param {{ vfs, bus?, objectCache?, cache?:boolean }} opts */
  constructor({ vfs, bus = null, objectCache = null, cache = true } = {}) {
    if (!vfs) throw new WasmError('WasmRuntime requires a vfs');
    this.vfs = vfs;
    this.bus = bus;
    this.objectCache = objectCache;
    this._cache = cache;
    this._compiled = new Map();   // hex hash -> WebAssembly.Module
  }

  _emit(type, detail) { this.bus?.emit(type, detail); }

  /**
   * Compile a module from raw bytes. Cached by content hash.
   * @param {Uint8Array} bytes
   * @param {{ path?:string }} meta
   * @returns {Promise<WasmModule>}
   */
  async compile(bytes, { path = null } = {}) {
    bytes = toBytes(bytes);
    const hash = await sha256Hex(bytes);
    let module = this._cache ? this._compiled.get(hash) : null;
    if (module) {
      this._emit('wasm:compile', { hash, path, cached: true });
    } else {
      try {
        module = await WebAssembly.compile(bytes);
      } catch (e) {
        throw new WasmError(`failed to compile wasm${path ? ' ' + path : ''}: ${e.message}`);
      }
      if (this._cache) this._compiled.set(hash, module);
      // optionally stash the *bytes* in the object cache for offline recompiles
      if (this.objectCache) { try { await this.objectCache.put(bytes, { hashHex: hash, kind: 'wasm', path }); } catch {} }
      this._emit('wasm:compile', { hash, path, cached: false, bytes: bytes.length });
    }
    return new WasmModule(hash, module, {
      path,
      imports: WebAssembly.Module.imports(module),
      exports: WebAssembly.Module.exports(module),
    });
  }

  /**
   * Read a `.wasm` file from the VFS and compile it.
   * @param {string} path
   * @returns {Promise<WasmModule>}
   */
  async load(path) {
    path = normalize(path);
    const bytes = await this.vfs.readFile(path);
    return this.compile(bytes, { path });
  }

  /**
   * Run a module (or a VFS path to one) under WASI.
   *
   * opts:
   *   args      : string[]  argv (argv[0] defaults to the module name)
   *   env       : object    environment variables
   *   preopens  : { guestDir: vfsPath }   dirs visible to the guest
   *   stdin     : Uint8Array | string | () => bytes
   *   stdout    : (chunk:Uint8Array) => void   live sink (optional)
   *   stderr    : (chunk:Uint8Array) => void   live sink (optional)
   *   writeback : boolean   persist guest file changes to the VFS (default true)
   *   start     : string    export to invoke (default '_start', falls back to
   *                         calling nothing if a reactor with '_initialize')
   *   imports   : object    extra host imports merged alongside WASI
   *
   * @returns {Promise<{ exitCode:number, stdout:Uint8Array, stderr:Uint8Array,
   *                      stdoutText:string, stderrText:string }>}
   */
  async run(moduleOrPath, opts = {}) {
    const mod = (moduleOrPath instanceof WasmModule)
      ? moduleOrPath
      : await this.load(String(moduleOrPath));

    const {
      args, env = {}, preopens = {}, stdin = null,
      stdout = null, stderr = null, writeback = true,
      start = '_start', imports: extraImports = {},
    } = opts;

    const argv = args && args.length ? args.slice()
      : [mod.path ? mod.path.split('/').pop() : 'main.wasm'];

    // --- snapshot preopen subtrees from the VFS into a synchronous WasiFS ---
    const fs = new WasiFS();
    const preopenMap = {};       // guestName -> base path inside WasiFS
    const origin = [];           // { name, base, vfsPath, original: Map<rel,bytes> }
    for (const [guestDir, vfsPath] of Object.entries(preopens)) {
      const base = (guestDir === '.' || guestDir === '') ? '/' : normalize(guestDir);
      let tree = { dirs: new Set(), files: new Map() };
      if (await this.vfs.exists(vfsPath)) tree = await this.vfs.exportTree(vfsPath);
      fs.merge(base, tree);
      fs.mkdir(base);
      preopenMap[guestDir] = base;
      origin.push({ name: guestDir, base, vfsPath, original: tree.files });
    }

    // --- output sinks: buffer everything, forward live chunks if asked ---
    const outChunks = [], errChunks = [];
    const onOut = (b) => { outChunks.push(b); if (stdout) stdout(b); this._emit('wasm:stdout', { hash: mod.hash, chunk: b }); };
    const onErr = (b) => { errChunks.push(b); if (stderr) stderr(b); this._emit('wasm:stderr', { hash: mod.hash, chunk: b }); };

    let stdinBytes = null;
    const stdinFn = () => {
      if (stdinBytes == null) {
        const v = typeof stdin === 'function' ? stdin() : stdin;
        stdinBytes = v == null ? new Uint8Array(0) : toBytes(v);
      }
      return stdinBytes;
    };

    const wasi = new Wasi({ args: argv, env, fs, preopens: preopenMap, stdin: stdinFn, stdout: onOut, stderr: onErr });

    // --- instantiate (WASI namespace + any extra host imports) ---
    const importObject = {
      wasi_snapshot_preview1: wasi.imports(),
      wasi_unstable: wasi.imports(),
      ...extraImports,
    };
    let instance;
    try {
      instance = await WebAssembly.instantiate(mod.module, importObject);
    } catch (e) {
      throw new WasmError(`failed to instantiate${mod.path ? ' ' + mod.path : ''}: ${e.message}`);
    }
    if (!instance.exports.memory) {
      throw new WasmError('module does not export "memory" (required for WASI)');
    }
    wasi.bind(instance);

    this._emit('wasm:start', { hash: mod.hash, path: mod.path, args: argv });

    // --- invoke ---
    let exitCode = 0;
    try {
      if (typeof instance.exports._initialize === 'function' && typeof instance.exports[start] !== 'function') {
        instance.exports._initialize();           // reactor module
      } else if (typeof instance.exports[start] === 'function') {
        instance.exports[start]();                // command module
      } else {
        throw new WasmError(`module exports no "${start}" or "_initialize" entrypoint`);
      }
      exitCode = wasi.exitCode == null ? 0 : wasi.exitCode;
    } catch (e) {
      if (e instanceof WasmExit) {
        exitCode = e.exitCode != null ? e.exitCode : (wasi.exitCode || 0);
      } else {
        this._emit('wasm:error', { hash: mod.hash, error: e.message });
        throw e instanceof WasmError ? e : new WasmError(`trap during execution: ${e.message}`);
      }
    }

    // --- write changed guest files back to the VFS ---
    if (writeback) {
      for (const o of origin) {
        await this._writeback(fs, o);
      }
    }

    const stdoutBytes = concatBytes(outChunks);
    const stderrBytes = concatBytes(errChunks);
    this._emit('wasm:exit', { hash: mod.hash, path: mod.path, exitCode });

    return {
      exitCode,
      stdout: stdoutBytes,
      stderr: stderrBytes,
      get stdoutText() { return toText(stdoutBytes); },
      get stderrText() { return toText(stderrBytes); },
    };
  }

  /** Diff a preopen's post-run state against its snapshot and persist deltas. */
  async _writeback(fs, { base, vfsPath, original }) {
    const after = fs.exportRel(base);              // { dirs, files } relative to base
    const join = (rel) => vfsPath === '/' ? '/' + rel : (rel ? vfsPath + '/' + rel : vfsPath);

    // new + modified files
    for (const [rel, bytes] of after.files) {
      const prev = original.get(rel);
      if (!prev || !sameBytes(prev, bytes)) {
        await this.vfs.writeFile(join(rel), bytes);
      }
    }
    // files the guest deleted
    for (const rel of original.keys()) {
      if (!after.files.has(rel)) {
        try { await this.vfs.remove(join(rel)); } catch {}
      }
    }
  }

  /** Drop the in-memory compiled-module cache. */
  clearCache() { this._compiled.clear(); }
}

function sameBytes(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export { WasmModule };
