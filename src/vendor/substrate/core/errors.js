/**
 * Substrate — typed errors. Catchers can branch on `.code` instead of string
 * matching. Every Substrate-thrown error is a SubstrateError or subclass.
 */
export class SubstrateError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'SubstrateError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/** Filesystem errors carry a POSIX-style errno code where it helps. */
export class FSError extends SubstrateError {
  constructor(code, message, path) { super(code, message, { path }); this.name = 'FSError'; }
}
export const ENOENT  = (path) => new FSError('ENOENT', `no such file or directory: ${path}`, path);
export const ENOTDIR = (path) => new FSError('ENOTDIR', `not a directory: ${path}`, path);
export const EISDIR  = (path) => new FSError('EISDIR', `is a directory: ${path}`, path);
export const EEXIST  = (path) => new FSError('EEXIST', `file exists: ${path}`, path);
export const EPERM   = (path) => new FSError('EPERM', `operation not permitted: ${path}`, path);
export const EROFS   = (path) => new FSError('EROFS', `read-only file system: ${path}`, path);

export class NetError extends SubstrateError {
  constructor(message, extra) { super('ENET', message, extra); this.name = 'NetError'; }
}
export class GitError extends SubstrateError {
  constructor(message, extra) { super('EGIT', message, extra); this.name = 'GitError'; }
}
export class WasmError extends SubstrateError {
  constructor(message, extra) { super('EWASM', message, extra); this.name = 'WasmError'; }
}
export class ModuleError extends SubstrateError {
  constructor(message, extra) { super('EMODULE', message, extra); this.name = 'ModuleError'; }
}

/** Thrown by WASI proc_exit. Carries the program's exit code. Not a failure. */
export class WasmExit extends WasmError {
  constructor(code) { super(`process exited with code ${code}`, { exitCode: code }); this.name = 'WasmExit'; }
}
