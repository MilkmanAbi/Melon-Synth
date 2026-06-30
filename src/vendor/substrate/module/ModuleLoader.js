/**
 * Substrate — in-memory ES module loader.
 *
 * Imports JavaScript that lives in the VFS without a server and without ever
 * touching disk: each module's source is read, its relative/VFS imports are
 * rewritten to point at the blob: URLs of the modules they depend on, and the
 * graph is linked bottom-up so the browser's native `import()` can pull the
 * whole thing into memory.
 *
 * This is the JS half of the interpreter story: clone a repo, run its native
 * bits as WASM, and load its JS glue/driver straight from the cloned tree —
 *   const mod = await sb.modules.import('/opt/lang/js/index.js');
 *   mod.run(source);
 *
 * Resolution:
 *   - relative ('./x', '../y/z') and absolute ('/a/b') specifiers resolve
 *     against the VFS, trying as-is, then +'.js', then '/index.js'.
 *   - bare specifiers ('lodash') resolve only if `externals` maps them
 *     (typically to a CDN URL) or a same-named file exists in the VFS;
 *     otherwise they are left untouched for the host page to resolve.
 *
 * Limitations: the dependency graph must be acyclic (cycles throw a clear
 * error — wrap the offending modules or load them individually). Dynamic
 * `import()` with a non-literal specifier inside loaded code is not rewritten.
 */
import { ModuleError } from '../core/errors.js';
import { sha256Hex } from '../util/hash.js';
import { normalize, dirname, join } from '../util/path.js';

export class ModuleLoader {
  /** @param {{ vfs, bus?, externals?:object }} opts */
  constructor({ vfs, bus = null, externals = {} } = {}) {
    if (!vfs) throw new ModuleError('ModuleLoader requires a vfs');
    this.vfs = vfs;
    this.bus = bus;
    this.externals = externals;          // bare specifier -> URL
    this._blobs = new Map();             // vfsPath -> { hash, url }
    this._urls = new Set();              // all created object URLs (for revoke)
  }

  _emit(t, d) { this.bus?.emit(t, d); }

  /** Map an import specifier (from `fromPath`) to a VFS path, or null if external. */
  async _resolveSpec(spec, fromPath) {
    // bare specifier with an external mapping wins immediately
    if (!spec.startsWith('.') && !spec.startsWith('/')) {
      if (this.externals[spec]) return { external: this.externals[spec] };
      // allow bare names that happen to exist as VFS files (rare); else leave alone
      const guess = normalize('/' + spec);
      if (await this._exists(guess)) return { vfs: guess };
      return { external: spec };        // leave untouched
    }
    const baseDir = dirname(fromPath);
    const raw = spec.startsWith('/') ? normalize(spec) : join(baseDir, spec);
    for (const cand of [raw, raw + '.js', raw + '.mjs', join(raw, 'index.js')]) {
      if (await this._isFile(cand)) return { vfs: cand };
    }
    throw new ModuleError(`cannot resolve "${spec}" from ${fromPath}`);
  }

  async _exists(p) { try { return await this.vfs.exists(p); } catch { return false; } }
  async _isFile(p) {
    try { const s = await this.vfs.stat(p); return s && s.type === 'file'; } catch { return false; }
  }

  /**
   * Recursively link a module and its dependencies into blob: URLs.
   * @returns {Promise<string>} the entry module's blob URL
   */
  async link(entryPath, { force = false } = {}) {
    entryPath = normalize(entryPath);
    const visiting = new Set();
    const linked = new Map();   // vfsPath -> blob url (this link pass)

    const linkOne = async (path) => {
      if (linked.has(path)) return linked.get(path);
      if (visiting.has(path)) {
        throw new ModuleError(`import cycle detected at ${path} — load these modules individually`);
      }
      visiting.add(path);

      const src = await this.vfs.readText(path);
      const hash = await sha256Hex(src);

      // reuse a previously created blob if the content is unchanged
      const cached = this._blobs.get(path);
      if (!force && cached && cached.hash === hash && cached.linkedDeps) {
        // still must ensure deps are linked in this pass (they're content-stable too)
        for (const dep of cached.depPaths) await linkOne(dep);
        visiting.delete(path);
        linked.set(path, cached.url);
        return cached.url;
      }

      // scan + resolve this module's imports
      const specs = scanSpecifiers(src);
      const depPaths = [];
      const rewrites = [];   // { start, end, url }
      for (const s of specs) {
        const res = await this._resolveSpec(s.value, path);
        if (res.external) {
          if (res.external !== s.value) rewrites.push({ start: s.start, end: s.end, url: res.external });
          continue;
        }
        const depUrl = await linkOne(res.vfs);
        depPaths.push(res.vfs);
        rewrites.push({ start: s.start, end: s.end, url: depUrl });
      }

      const out = applyRewrites(src, rewrites);
      const url = makeModuleUrl(out);
      this._urls.add(url);
      this._blobs.set(path, { hash, url, depPaths, linkedDeps: true });
      visiting.delete(path);
      linked.set(path, url);
      this._emit('module:link', { path, hash, deps: depPaths.length });
      return url;
    };

    return linkOne(entryPath);
  }

  /**
   * Link and import a module from the VFS, returning its live namespace object.
   * @param {string} path
   * @param {{ force?:boolean }} opts  force=true relinks even if content cached
   */
  async import(path, opts = {}) {
    const url = await this.link(path, opts);
    this._emit('module:import', { path });
    try {
      return await import(/* @vite-ignore */ url);
    } catch (e) {
      throw new ModuleError(`failed to import ${path}: ${e.message}`);
    }
  }

  /** Evaluate a standalone source string as a module (no VFS deps). */
  async evaluate(source, { externals } = {}) {
    const specs = scanSpecifiers(source);
    const ext = externals || this.externals;
    const rewrites = [];
    for (const s of specs) {
      if (!s.value.startsWith('.') && !s.value.startsWith('/') && ext[s.value]) {
        rewrites.push({ start: s.start, end: s.end, url: ext[s.value] });
      }
    }
    const url = makeModuleUrl(applyRewrites(source, rewrites));
    this._urls.add(url);
    return import(/* @vite-ignore */ url);
  }

  /** Forget the cached blob for a path (next import relinks it). */
  invalidate(path) {
    path = normalize(path);
    const e = this._blobs.get(path);
    if (e) { revokeUrl(e.url); this._urls.delete(e.url); this._blobs.delete(path); }
  }

  /** Revoke every object URL this loader created. */
  dispose() {
    for (const u of this._urls) revokeUrl(u);
    this._urls.clear();
    this._blobs.clear();
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Find the quoted specifier of every static import/export-from and
 * literal dynamic import in `src`. Comments and the contents of string/template
 * literals are skipped so specifier-shaped text inside them is never matched.
 * Returns [{ value, start, end }] where start..end spans the quotes inclusive.
 */
function scanSpecifiers(src) {
  const out = [];
  const code = blankNonCode(src);     // same length, comments/strings blanked
  // import ... from "x" | export ... from "x"
  const reFrom = /\b(?:import|export)\b[\s\S]*?\bfrom\s*(['"])/g;
  // bare side-effect import:  import "x"
  const reSide = /\bimport\s*(['"])/g;
  // dynamic import("x")
  const reDyn = /\bimport\s*\(\s*(['"])/g;

  const collect = (re, isFrom) => {
    let m;
    while ((m = re.exec(code))) {
      const quote = m[1];
      const open = re.lastIndex - 1;            // index of opening quote
      const close = code.indexOf(quote, open + 1);
      if (close === -1) continue;
      // pull the real value from the ORIGINAL source (blanked copy lost it)
      const value = src.slice(open + 1, close);
      out.push({ value, start: open, end: close });
    }
  };
  collect(reFrom, true);
  // reSide also matches the "import" part of `import x from` etc.; filter those
  // by only keeping matches whose specifier isn't immediately part of a from-clause.
  let m;
  while ((m = reSide.exec(code))) {
    const quote = m[1];
    const open = reSide.lastIndex - 1;
    // skip if this looks like `import x from "..."` (there is a from-handled one)
    const between = code.slice(m.index, open);
    if (/\bfrom\b/.test(between) || /[a-zA-Z0-9_$}\*]/.test(between.replace(/^\s*import\s*/, '').trim()[0] || '')) {
      // it's `import something ... "x"` — handled by reFrom or it's not a bare import
      if (/\bfrom\b/.test(between)) continue;
    }
    // accept only true side-effect form: import "x"  (between is just whitespace)
    if (between.replace(/^\s*import\s*/, '').trim() === '') {
      const close = code.indexOf(quote, open + 1);
      if (close !== -1) out.push({ value: src.slice(open + 1, close), start: open, end: close });
    }
  }
  collect(reDyn, false);

  // de-dupe by start offset, keep earliest
  const byStart = new Map();
  for (const s of out) if (!byStart.has(s.start)) byStart.set(s.start, s);
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

/** Replace string and comment regions with spaces, preserving length+offsets. */
function blankNonCode(src) {
  const a = src.split('');
  let i = 0; const n = src.length;
  const blank = (from, to) => { for (let k = from; k < to && k < n; k++) if (a[k] !== '\n') a[k] = ' '; };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let j = i + 2; while (j < n && src[j] !== '\n') j++; blank(i, j); i = j; continue; }
    if (c === '/' && d === '*') { let j = i + 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++; j += 2; blank(i, j); i = j; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === c) break; j++; }
      blank(i + 1, j);     // keep the quotes, blank the inside
      i = j + 1; continue;
    }
    i++;
  }
  return a.join('');
}

/** Apply [{start,end,url}] specifier rewrites (end = closing-quote index). */
function applyRewrites(src, rewrites) {
  if (!rewrites.length) return src;
  rewrites.sort((a, b) => a.start - b.start);
  let out = '', cursor = 0;
  for (const r of rewrites) {
    out += src.slice(cursor, r.start + 1);    // up to and including opening quote
    out += r.url;
    cursor = r.end;                           // closing quote kept by next slice
  }
  out += src.slice(cursor);
  return out;
}

function makeModuleUrl(source) {
  // Browsers (main thread or worker) can import blob: URLs and that's the
  // canonical in-memory ESM mechanism. Node exposes URL.createObjectURL but its
  // ESM loader rejects blob:, so fall back to data: there.
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
  if (!isNode && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
    return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  }
  const b64 = (typeof Buffer !== 'undefined')
    ? Buffer.from(source, 'utf8').toString('base64')
    : btoa(unescape(encodeURIComponent(source)));
  return 'data:text/javascript;base64,' + b64;
}

function revokeUrl(url) {
  if (url.startsWith('blob:') && typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(url);
}
