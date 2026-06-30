/**
 * Substrate — WASI preview1 shim.
 *
 * WASM calls its imports SYNCHRONOUSLY, but Substrate's VFS is async. The bridge:
 * before a module runs, the runtime snapshots the relevant VFS subtree(s) into
 * the synchronous in-memory FS below; WASI operates on that; afterwards changed
 * files are written back to the VFS. For an IDE — clone an interpreter, run it
 * over the user's source, capture stdout — the working set easily fits in RAM,
 * so this is both simple and correct for standard wasm32-wasi binaries.
 *
 * Implements the calls a typical clang/rust wasm32-wasi program needs (args,
 * environ, fd read/write/seek/stat, path_open and friends, clock, random,
 * proc_exit). Rare calls return ENOSYS rather than trapping.
 */
import { normalize, dirname, basename } from '../util/path.js';
import { toBytes } from '../util/bytes.js';
import { WasmExit } from '../core/errors.js';

// errno
const E = { SUCCESS:0, BADF:8, EXIST:20, INVAL:28, ISDIR:31, NOENT:44, NOSYS:52, NOTDIR:54, ACCES:2, NOTEMPTY:55 };
// filetype
const FT = { UNKNOWN:0, BLOCK:1, CHAR:2, DIR:3, REG:4, SYMLINK:7 };
// oflags
const O = { CREAT:1, DIRECTORY:2, EXCL:4, TRUNC:8 };
// fdflags
const FDF = { APPEND:1 };
// whence
const WH = { SET:0, CUR:1, END:2 };

/** Synchronous in-RAM filesystem used only during a WASI run. */
class WasiFS {
  constructor() {
    this.dirs = new Set(['/']);
    this.files = new Map();        // guestPath -> Uint8Array
  }
  static fromSnapshot(base, tree) {
    const fs = new WasiFS();
    base = normalize(base);
    fs.dirs.add(base);
    const abs = (r) => r ? (base === '/' ? '/' + r : base + '/' + r) : base;
    for (const d of tree.dirs) fs.dirs.add(normalize(abs(d)));
    for (const [r, data] of tree.files) {
      const p = normalize(abs(r));
      fs.files.set(p, data instanceof Uint8Array ? data : toBytes(data));
      fs.dirs.add(dirname(p));
    }
    return fs;
  }
  merge(base, tree) {
    base = normalize(base);
    const abs = (r) => r ? (base === '/' ? '/' + r : base + '/' + r) : base;
    this.dirs.add(base);
    for (const d of tree.dirs) this.dirs.add(normalize(abs(d)));
    for (const [r, data] of tree.files) { const p = normalize(abs(r)); this.files.set(p, toBytes(data)); this.dirs.add(dirname(p)); }
  }
  exists(p) { p = normalize(p); return this.files.has(p) || this.dirs.has(p); }
  isDir(p) { return this.dirs.has(normalize(p)); }
  isFile(p) { return this.files.has(normalize(p)); }
  read(p) { return this.files.get(normalize(p)); }
  write(p, bytes) { p = normalize(p); this.files.set(p, toBytes(bytes)); this.dirs.add(dirname(p)); }
  mkdir(p) { p = normalize(p); this.dirs.add(p); let d = dirname(p); while (d !== '/' && !this.dirs.has(d)) { this.dirs.add(d); d = dirname(d); } }
  unlink(p) { p = normalize(p); return this.files.delete(p); }
  rmdir(p) { p = normalize(p); return this.dirs.delete(p); }
  list(p) {
    p = normalize(p);
    const prefix = p === '/' ? '/' : p + '/';
    const seen = new Map();
    for (const f of this.files.keys()) if (f.startsWith(prefix)) { const name = f.slice(prefix.length).split('/')[0]; if (name) seen.set(name, this.files.has(prefix + name) ? FT.REG : FT.DIR); }
    for (const d of this.dirs) if (d !== p && d.startsWith(prefix)) { const name = d.slice(prefix.length).split('/')[0]; if (name) seen.set(name, FT.DIR); }
    return [...seen.entries()].map(([name, ft]) => ({ name, filetype: ft }));
  }
  /** Subtree relative to `base`, for writeback. */
  exportRel(base) {
    base = normalize(base);
    const prefix = base === '/' ? '/' : base + '/';
    const dirs = new Set(), files = new Map();
    for (const d of this.dirs) { if (d === base) continue; if (d.startsWith(prefix)) dirs.add(d.slice(prefix.length)); }
    for (const [f, data] of this.files) { if (f.startsWith(prefix)) files.set(f.slice(prefix.length), data); }
    return { dirs, files };
  }
}

export class Wasi {
  /**
   * opts: { args:[], env:{}, preopens:{guestPath:hostSnapshotBase}, stdin, stdout(fn|null), stderr(fn|null) }
   * The runtime builds `preopens` by snapshotting VFS dirs; here they are just
   * names → guest base path (already populated into the WasiFS).
   */
  constructor(opts = {}) {
    this.args = opts.args || ['main.wasm'];
    this.env = opts.env || {};
    this.fs = opts.fs || new WasiFS();
    this.preopens = opts.preopens || {};   // guestName -> guestPath
    this._stdout = opts.stdout || ((b) => {});
    this._stderr = opts.stderr || ((b) => {});
    this._stdin = opts.stdin || (() => new Uint8Array(0));
    this.exitCode = null;
    this._view = null;
    this._mem = null;
    this._fds = new Map();
    this._nextFd = 3;

    // fd 0/1/2
    this._fds.set(0, { kind: 'stdin' });
    this._fds.set(1, { kind: 'stdout' });
    this._fds.set(2, { kind: 'stderr' });
    // preopened dirs
    for (const [name, guestPath] of Object.entries(this.preopens)) {
      this._fds.set(this._nextFd++, { kind: 'dir', guestPath: normalize(guestPath), preopenName: name });
    }
  }

  bind(instance) {
    this._mem = instance.exports.memory;
  }

  _dv() {
    if (!this._view || this._view.buffer !== this._mem.buffer) this._view = new DataView(this._mem.buffer);
    return this._view;
  }
  _u8() { return new Uint8Array(this._mem.buffer); }
  _wU32(p, v) { this._dv().setUint32(p, v, true); }
  _rU32(p) { return this._dv().getUint32(p, true); }
  _wU64(p, v) { this._dv().setBigUint64(p, BigInt(v), true); }
  _rStr(p, len) { return new TextDecoder().decode(this._u8().subarray(p, p + len)); }
  _wBytes(p, bytes) { this._u8().set(bytes, p); }

  // resolve a path argument against a dir fd
  _resolve(dirfd, path) {
    const f = this._fds.get(dirfd);
    if (!f || f.kind !== 'dir') return null;
    if (path.startsWith('/')) return normalize(path);
    return normalize((f.guestPath === '/' ? '' : f.guestPath) + '/' + path);
  }

  // ── the import object ─────────────────────────────────────────────────────
  imports() {
    const w = this;
    const ok = () => E.SUCCESS;
    return {
      proc_exit: (code) => { w.exitCode = code; throw new WasmExit(code); },

      args_sizes_get: (argcPtr, bufPtr) => {
        w._wU32(argcPtr, w.args.length);
        w._wU32(bufPtr, w.args.reduce((s, a) => s + new TextEncoder().encode(a).length + 1, 0));
        return ok();
      },
      args_get: (argvPtr, argvBuf) => {
        let buf = argvBuf;
        for (const a of w.args) {
          w._wU32(argvPtr, buf); argvPtr += 4;
          const bytes = new TextEncoder().encode(a + '\0');
          w._wBytes(buf, bytes); buf += bytes.length;
        }
        return ok();
      },
      environ_sizes_get: (cntPtr, bufPtr) => {
        const entries = Object.entries(w.env);
        w._wU32(cntPtr, entries.length);
        w._wU32(bufPtr, entries.reduce((s, [k, v]) => s + new TextEncoder().encode(`${k}=${v}`).length + 1, 0));
        return ok();
      },
      environ_get: (envPtr, envBuf) => {
        let buf = envBuf;
        for (const [k, v] of Object.entries(w.env)) {
          w._wU32(envPtr, buf); envPtr += 4;
          const bytes = new TextEncoder().encode(`${k}=${v}\0`);
          w._wBytes(buf, bytes); buf += bytes.length;
        }
        return ok();
      },

      clock_time_get: (id, precision, outPtr) => { w._wU64(outPtr, BigInt(Date.now()) * 1000000n); return ok(); },
      clock_res_get: (id, outPtr) => { w._wU64(outPtr, 1000000n); return ok(); },
      random_get: (ptr, len) => { const b = new Uint8Array(len); crypto.getRandomValues(b); w._wBytes(ptr, b); return ok(); },
      sched_yield: () => ok(),

      fd_write: (fd, iovsPtr, iovsLen, nwrittenPtr) => {
        const chunks = []; let total = 0;
        for (let i = 0; i < iovsLen; i++) {
          const base = w._rU32(iovsPtr + i * 8);
          const len = w._rU32(iovsPtr + i * 8 + 4);
          chunks.push(w._u8().slice(base, base + len)); total += len;
        }
        const data = chunks.length === 1 ? chunks[0] : (() => { const o = new Uint8Array(total); let off = 0; for (const c of chunks) { o.set(c, off); off += c.length; } return o; })();
        const f = w._fds.get(fd);
        if (!f) return E.BADF;
        if (f.kind === 'stdout') w._stdout(data);
        else if (f.kind === 'stderr') w._stderr(data);
        else if (f.kind === 'file') {
          const cur = w.fs.read(f.guestPath) || new Uint8Array(0);
          const off = f.append ? cur.length : f.offset;
          const grown = new Uint8Array(Math.max(cur.length, off + data.length));
          grown.set(cur); grown.set(data, off);
          w.fs.write(f.guestPath, grown); f.offset = off + data.length;
        } else return E.BADF;
        w._wU32(nwrittenPtr, total);
        return ok();
      },

      fd_read: (fd, iovsPtr, iovsLen, nreadPtr) => {
        const f = w._fds.get(fd);
        if (!f) return E.BADF;
        let source, startOff = 0;
        if (f.kind === 'stdin') { source = toBytes(w._stdin()); startOff = 0; }
        else if (f.kind === 'file') { source = w.fs.read(f.guestPath) || new Uint8Array(0); startOff = f.offset; }
        else return E.BADF;
        let read = 0, off = startOff;
        for (let i = 0; i < iovsLen; i++) {
          const base = w._rU32(iovsPtr + i * 8);
          const len = w._rU32(iovsPtr + i * 8 + 4);
          const slice = source.subarray(off, off + len);
          w._wBytes(base, slice); read += slice.length; off += slice.length;
          if (slice.length < len) break;
        }
        if (f.kind === 'file') f.offset = off;
        w._wU32(nreadPtr, read);
        return ok();
      },

      fd_seek: (fd, offset, whence, newOffPtr) => {
        const f = w._fds.get(fd);
        if (!f || f.kind !== 'file') return E.BADF;
        const size = (w.fs.read(f.guestPath) || new Uint8Array(0)).length;
        const o = Number(offset);
        if (whence === WH.SET) f.offset = o;
        else if (whence === WH.CUR) f.offset += o;
        else if (whence === WH.END) f.offset = size + o;
        w._wU64(newOffPtr, f.offset);
        return ok();
      },
      fd_tell: (fd, outPtr) => { const f = w._fds.get(fd); if (!f) return E.BADF; w._wU64(outPtr, f.offset || 0); return ok(); },

      fd_close: (fd) => { return w._fds.delete(fd) ? ok() : E.BADF; },

      fd_fdstat_get: (fd, buf) => {
        const f = w._fds.get(fd);
        if (!f) return E.BADF;
        let ft = FT.CHAR;
        if (f.kind === 'dir') ft = FT.DIR;
        else if (f.kind === 'file') ft = FT.REG;
        w._dv().setUint8(buf, ft);
        w._dv().setUint16(buf + 2, f.append ? FDF.APPEND : 0, true);
        w._wU64(buf + 8, 0xFFFFFFFFFFFFFFFFn);   // rights_base: everything
        w._wU64(buf + 16, 0xFFFFFFFFFFFFFFFFn);  // rights_inheriting
        return ok();
      },
      fd_fdstat_set_flags: () => ok(),

      fd_prestat_get: (fd, buf) => {
        const f = w._fds.get(fd);
        if (!f || f.kind !== 'dir' || !f.preopenName) return E.BADF;
        w._dv().setUint8(buf, 0); // prestat tag = dir
        w._wU32(buf + 4, new TextEncoder().encode(f.preopenName).length);
        return ok();
      },
      fd_prestat_dir_name: (fd, pathPtr, pathLen) => {
        const f = w._fds.get(fd);
        if (!f || f.kind !== 'dir' || !f.preopenName) return E.BADF;
        w._wBytes(pathPtr, new TextEncoder().encode(f.preopenName).subarray(0, pathLen));
        return ok();
      },

      fd_filestat_get: (fd, buf) => {
        const f = w._fds.get(fd);
        if (!f) return E.BADF;
        const isDir = f.kind === 'dir';
        const size = f.kind === 'file' ? (w.fs.read(f.guestPath) || new Uint8Array(0)).length : 0;
        return w._writeFilestat(buf, isDir ? FT.DIR : (f.kind === 'file' ? FT.REG : FT.CHAR), size);
      },

      path_open: (dirfd, dirflags, pathPtr, pathLen, oflags, rightsBase, rightsInh, fdflags, openedFdPtr) => {
        const rel = w._rStr(pathPtr, pathLen);
        const guest = w._resolve(dirfd, rel);
        if (guest == null) return E.BADF;
        const wantDir = (oflags & O.DIRECTORY) !== 0;
        const create = (oflags & O.CREAT) !== 0;
        const trunc = (oflags & O.TRUNC) !== 0;
        const append = (Number(fdflags) & FDF.APPEND) !== 0;
        if (w.fs.isDir(guest) || wantDir) {
          if (!w.fs.isDir(guest)) { if (create) w.fs.mkdir(guest); else return E.NOENT; }
          const fd = w._nextFd++;
          w._fds.set(fd, { kind: 'dir', guestPath: guest });
          w._wU32(openedFdPtr, fd);
          return ok();
        }
        if (!w.fs.isFile(guest)) {
          if (!create) return E.NOENT;
          w.fs.write(guest, new Uint8Array(0));
        } else if (trunc) w.fs.write(guest, new Uint8Array(0));
        const fd = w._nextFd++;
        w._fds.set(fd, { kind: 'file', guestPath: guest, offset: 0, append });
        w._wU32(openedFdPtr, fd);
        return ok();
      },

      path_filestat_get: (dirfd, flags, pathPtr, pathLen, buf) => {
        const rel = w._rStr(pathPtr, pathLen);
        const guest = w._resolve(dirfd, rel);
        if (guest == null) return E.BADF;
        if (w.fs.isDir(guest)) return w._writeFilestat(buf, FT.DIR, 0);
        if (w.fs.isFile(guest)) return w._writeFilestat(buf, FT.REG, w.fs.read(guest).length);
        return E.NOENT;
      },
      path_create_directory: (dirfd, pathPtr, pathLen) => { const g = w._resolve(dirfd, w._rStr(pathPtr, pathLen)); if (g == null) return E.BADF; w.fs.mkdir(g); return ok(); },
      path_remove_directory: (dirfd, pathPtr, pathLen) => { const g = w._resolve(dirfd, w._rStr(pathPtr, pathLen)); if (g == null) return E.BADF; return w.fs.rmdir(g) ? ok() : E.NOENT; },
      path_unlink_file: (dirfd, pathPtr, pathLen) => { const g = w._resolve(dirfd, w._rStr(pathPtr, pathLen)); if (g == null) return E.BADF; return w.fs.unlink(g) ? ok() : E.NOENT; },
      path_rename: (oldFd, oldPtr, oldLen, newFd, newPtr, newLen) => {
        const a = w._resolve(oldFd, w._rStr(oldPtr, oldLen));
        const b = w._resolve(newFd, w._rStr(newPtr, newLen));
        if (a == null || b == null) return E.BADF;
        if (w.fs.isFile(a)) { w.fs.write(b, w.fs.read(a)); w.fs.unlink(a); return ok(); }
        return E.NOENT;
      },
      path_readlink: () => E.NOSYS,
      path_filestat_set_times: () => ok(),

      fd_readdir: (fd, buf, bufLen, cookie, usedPtr) => {
        const f = w._fds.get(fd);
        if (!f || f.kind !== 'dir') return E.BADF;
        const entries = w.fs.list(f.guestPath);
        let offset = 0; let idx = Number(cookie);
        const dv = w._dv();
        for (; idx < entries.length; idx++) {
          const e = entries[idx];
          const nameBytes = new TextEncoder().encode(e.name);
          const entrySize = 24 + nameBytes.length;
          if (offset + entrySize > bufLen) break;
          dv.setBigUint64(buf + offset, BigInt(idx + 1), true);   // d_next
          dv.setBigUint64(buf + offset + 8, BigInt(idx + 1), true); // d_ino
          dv.setUint32(buf + offset + 16, nameBytes.length, true);  // d_namlen
          dv.setUint8(buf + offset + 20, e.filetype);               // d_type
          w._wBytes(buf + offset + 24, nameBytes);
          offset += entrySize;
        }
        w._wU32(usedPtr, offset);
        return ok();
      },

      // rarely-needed: succeed or no-op so programs don't trap
      fd_sync: () => ok(), fd_datasync: () => ok(), fd_advise: () => ok(),
      fd_allocate: () => ok(), fd_fdstat_set_rights: () => ok(), fd_renumber: () => ok(),
      poll_oneoff: () => E.NOSYS, fd_pread: () => E.NOSYS, fd_pwrite: () => E.NOSYS,
    };
  }

  _writeFilestat(buf, filetype, size) {
    const dv = this._dv();
    dv.setBigUint64(buf, 0n, true);            // dev
    dv.setBigUint64(buf + 8, 0n, true);        // ino
    dv.setUint8(buf + 16, filetype);           // filetype
    dv.setBigUint64(buf + 24, 1n, true);       // nlink
    dv.setBigUint64(buf + 32, BigInt(size), true); // size
    const t = BigInt(Date.now()) * 1000000n;
    dv.setBigUint64(buf + 40, t, true);        // atim
    dv.setBigUint64(buf + 48, t, true);        // mtim
    dv.setBigUint64(buf + 56, t, true);        // ctim
    return E.SUCCESS;
  }
}

export { WasiFS };
