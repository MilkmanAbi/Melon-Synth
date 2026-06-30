/**
 * Substrate — VFS: the mount table + path router + high-level facade.
 *
 * Backends are mounted at absolute mountpoints. A path is routed to the
 * longest-matching mount, then handed to the backend with a mount-relative
 * path (mountpoint stripped). Device nodes (e.g. /dev/random, /dev/net) are
 * handled at this layer: a driver with read(len)/write(bytes).
 *
 * This is the surface a frontend touches for file I/O. It is deliberately
 * small and async; everything heavier (git, wasm) builds on top of it.
 */
import { normalize, dirname, basename, isUnder, relative } from '../util/path.js';
import { toBytes, toText } from '../util/bytes.js';
import { OverlayFS } from './OverlayFS.js';
import { MemFS } from './MemFS.js';
import { IDBFS } from './IDBFS.js';
import { ENOENT, ENOTDIR } from '../core/errors.js';

/** Read-only adapter exposing a VFS subtree as a backend `lower` for overlays. */
class SubtreeView {
  constructor(vfs, base) { this._vfs = vfs; this._base = normalize(base); }
  _abs(rel) { rel = normalize(rel); return this._base === '/' ? rel : (rel === '/' ? this._base : this._base + rel); }
  stat(rel)     { return this._vfs.stat(this._abs(rel)); }
  list(rel)     { return this._vfs.list(this._abs(rel)); }
  readFile(rel) { return this._vfs.readFile(this._abs(rel)); }
  exists(rel)   { return this._vfs.exists(this._abs(rel)); }
  async exportTree(rel = '/') { return this._vfs.exportTree(this._abs(rel)); }
}

export class VFS {
  constructor(bus) {
    this._bus = bus;
    this._mounts = [];           // [{mountpoint, backend, fstype}] longest-first
    this._devices = new Map();   // path -> driver
  }

  // ── mount management ─────────────────────────────────────────────────────
  mount(mountpoint, backend, fstype = 'backend') {
    mountpoint = normalize(mountpoint);
    this._mounts = this._mounts.filter(m => m.mountpoint !== mountpoint);
    this._mounts.push({ mountpoint, backend, fstype });
    this._mounts.sort((a, b) => b.mountpoint.length - a.mountpoint.length);
    this._bus?.emit('fs:mount', { mountpoint, fstype });
    return mountpoint;
  }

  unmount(mountpoint) {
    mountpoint = normalize(mountpoint);
    this._mounts = this._mounts.filter(m => m.mountpoint !== mountpoint);
    this._bus?.emit('fs:unmount', { mountpoint });
  }

  mounts() { return this._mounts.map(m => ({ mountpoint: m.mountpoint, fstype: m.fstype, readonly: !!m.backend.readonly })); }

  _route(path) {
    path = normalize(path);
    for (const m of this._mounts) {
      if (path === m.mountpoint || m.mountpoint === '/' || path.startsWith(m.mountpoint + '/')) {
        const rel = m.mountpoint === '/' ? path : (path === m.mountpoint ? '/' : path.slice(m.mountpoint.length));
        return { backend: m.backend, rel: rel || '/', mount: m };
      }
    }
    throw new Error(`VFS: no mount for ${path}`);
  }

  // ── device nodes ─────────────────────────────────────────────────────────
  registerDevice(path, driver) { this._devices.set(normalize(path), driver); }
  isDevice(path) { return this._devices.has(normalize(path)); }

  // ── core ops ───────────────────────────────────────────────────────────────
  async stat(path) {
    path = normalize(path);
    if (this._devices.has(path)) return { type: 'device', size: 0, mtime: Date.now(), ctime: Date.now(), mode: 0o666 };
    const { backend, rel } = this._route(path);
    return backend.stat(rel);
  }

  async exists(path) {
    path = normalize(path);
    if (this._devices.has(path)) return true;
    try { const { backend, rel } = this._route(path); return await backend.exists(rel); }
    catch { return false; }
  }

  async list(path) {
    const { backend, rel } = this._route(normalize(path));
    const entries = await backend.list(rel);
    // surface device nodes that live directly under this dir
    const prefix = normalize(path) === '/' ? '/' : normalize(path) + '/';
    for (const [dpath] of this._devices) {
      if (dirname(dpath) === normalize(path) && !entries.find(e => e.name === basename(dpath)))
        entries.push({ name: basename(dpath), type: 'device', size: 0, mtime: 0 });
    }
    return entries;
  }
  readdir(path) { return this.list(path); }

  async readFile(path) {
    path = normalize(path);
    const dev = this._devices.get(path);
    if (dev) return toBytes(await dev.read(65536));
    const { backend, rel } = this._route(path);
    return backend.readFile(rel);
  }

  /** Convenience: read a byte slice (offset/length) without loading device semantics. */
  async read(path, offset = 0, length = Infinity) {
    const all = await this.readFile(path);
    if (offset === 0 && length === Infinity) return all;
    return all.slice(offset, length === Infinity ? undefined : offset + length);
  }

  async readText(path) { return toText(await this.readFile(path)); }

  async writeFile(path, data) {
    path = normalize(path);
    const dev = this._devices.get(path);
    if (dev) return dev.write(toBytes(data));
    const { backend, rel } = this._route(path);
    if (backend.readonly) throw new (await import('../core/errors.js')).FSError('EROFS', `read-only: ${path}`, path);
    const n = await backend.writeFile(rel, toBytes(data));
    this._bus?.emit('fs:change', { path, op: 'write' });
    return n;
  }
  writeText(path, text) { return this.writeFile(path, toBytes(text)); }

  async mkdir(path, { recursive = true } = {}) {
    const { backend, rel } = this._route(normalize(path));
    await backend.mkdir(rel); // backends create parents already
    this._bus?.emit('fs:change', { path: normalize(path), op: 'mkdir' });
  }

  async remove(path, { recursive = false } = {}) {
    const { backend, rel } = this._route(normalize(path));
    await backend.remove(rel, { recursive });
    this._bus?.emit('fs:change', { path: normalize(path), op: 'remove' });
  }
  unlink(path) { return this.remove(path); }
  rmrf(path) { return this.remove(path, { recursive: true }); }

  async rename(from, to) {
    from = normalize(from); to = normalize(to);
    const a = this._route(from), b = this._route(to);
    if (a.backend === b.backend) { await a.backend.rename(a.rel, b.rel); }
    else { await this.cp(from, to, { recursive: true }); await this.remove(from, { recursive: true }); }
    this._bus?.emit('fs:change', { path: to, op: 'rename', from });
  }

  /** Recursive copy across (or within) mounts. */
  async cp(from, to, { recursive = true } = {}) {
    from = normalize(from); to = normalize(to);
    const st = await this.stat(from);
    if (st.type === 'dir') {
      if (!recursive) throw new Error(`cp: ${from} is a directory (use recursive)`);
      await this.mkdir(to);
      for (const e of await this.list(from)) await this.cp(from + '/' + e.name, to + '/' + e.name, { recursive });
    } else {
      await this.writeFile(to, await this.readFile(from));
    }
  }

  /** Depth-first walk yielding {path, type}. Skips device nodes. */
  async *walk(root = '/') {
    root = normalize(root);
    const stack = [root];
    while (stack.length) {
      const p = stack.pop();
      let entries;
      try { entries = await this.list(p); } catch { continue; }
      for (const e of entries) {
        if (e.type === 'device') continue;
        const cp = p === '/' ? '/' + e.name : p + '/' + e.name;
        yield { path: cp, type: e.type, size: e.size };
        if (e.type === 'dir') stack.push(cp);
      }
    }
  }

  // ── overlay (copy-on-write) ─────────────────────────────────────────────
  /**
   * Mount a copy-on-write overlay at `mountPath` whose pristine lower layer is
   * the existing VFS subtree at `srcPath`. Edits go to an in-RAM (or persistent)
   * upper layer; .reset() on the returned handle discards them.
   */
  overlay(srcPath, mountPath, { persist = false, upperDbName = 'substrate-overlay' } = {}) {
    const lower = new SubtreeView(this, srcPath);
    const upper = persist ? new IDBFS(upperDbName) : new MemFS();
    const ofs = new OverlayFS({ lower, upper });
    const ready = upper.open ? upper.open() : Promise.resolve();
    this.mount(mountPath, ofs, 'overlayfs');
    return { fs: ofs, mountpoint: normalize(mountPath), ready, reset: () => ofs.reset(), isDirty: () => ofs.isDirty() };
  }

  // ── tree export/import (sync snapshot used by WASI) ──────────────────────
  /** Flat snapshot of a subtree: {dirs:Set<relpath>, files:Map<relpath,bytes>}. */
  async exportTree(path) {
    path = normalize(path);
    const { backend, rel } = this._route(path);
    if (backend.exportTree) return backend.exportTree(rel);
    // generic fallback via walk
    const dirs = new Set(); const files = new Map();
    for await (const e of this.walk(path)) {
      const r = relative(path, e.path);
      if (e.type === 'dir') dirs.add(r);
      else files.set(r, await this.readFile(e.path));
    }
    return { dirs, files };
  }

  async importTree(path, tree) {
    path = normalize(path);
    const { backend, rel } = this._route(path);
    if (backend.importTree) return backend.importTree(rel, tree);
    for (const d of tree.dirs) await this.mkdir(path === '/' ? '/' + d : path + '/' + d);
    for (const [r, data] of tree.files) await this.writeFile(path === '/' ? '/' + r : path + '/' + r, data);
  }
}

export { SubtreeView };
